import { restoreLedger } from '../dist/persistence.mjs';
import { RETENTION_MS, retainLedger, prepareLedger } from './retention.mjs';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'X-Device-ID' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const empty = () => ({ ledger: null, revision: 0, generation: null });

async function readRow(db, deviceId) {
  return db.prepare('SELECT device_id, data, revision, generation, updated_at, cleanup_at FROM device_ledgers WHERE device_id = ?').bind(deviceId).first();
}

async function pruneRow(db, row, now) {
  if (row.cleanup_at >= now) return;
  const stored = JSON.parse(row.data);
  const kept = retainLedger(stored.ledger, stored.memberSeen, now);
  // Only a semantic change invalidates open pages. Cleanup never extends device lifetime.
  const changed = JSON.stringify({ ledger: kept.ledger, memberSeen: kept.memberSeen }) !== row.data;
  await db.prepare('UPDATE device_ledgers SET data = ?, revision = revision + ?, cleanup_at = ? WHERE device_id = ? AND revision = ? AND generation = ?')
    .bind(JSON.stringify({ ledger: kept.ledger, memberSeen: kept.memberSeen }), changed ? 1 : 0, kept.cleanupAt, row.device_id, row.revision, row.generation).run();
}

async function readCurrent(db, deviceId, now) {
  await db.prepare('DELETE FROM device_ledgers WHERE device_id = ? AND updated_at < ?').bind(deviceId, now - RETENTION_MS).run();
  let row = await readRow(db, deviceId);
  if (row) {
    await pruneRow(db, row, now);
    row = await readRow(db, deviceId);
  }
  return row;
}

const responseData = row => row ? { ledger: restoreLedger(JSON.parse(row.data).ledger), revision: row.revision, generation: row.generation } : empty();

export async function cleanupExpired(db, now = Date.now()) {
  await db.prepare('DELETE FROM device_ledgers WHERE updated_at < ?').bind(now - RETENTION_MS).run();
  // Indexed, bounded batches keep scheduled work within Worker limits.
  for (let batch = 0; batch < 10; batch++) {
    const { results } = await db.prepare('SELECT device_id, data, revision, generation, updated_at, cleanup_at FROM device_ledgers WHERE cleanup_at < ? LIMIT 100').bind(now).all();
    if (!results.length) break;
    for (const row of results) await pruneRow(db, row, now);
  }
}

export default {
  async scheduled(event, env) { await cleanupExpired(env.DB, event.scheduledTime); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname !== '/api/ledger') return json({ error: '接口不存在' }, 404);
    if (!['GET', 'PUT'].includes(request.method)) return json({ error: '不支持此操作' }, 405);
    const deviceId = request.headers.get('x-device-id');
    if (!uuid.test(deviceId ?? '')) return json({ error: '设备标识无效，请重新打开页面' }, 400);
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.method === 'PUT' && request.headers.get('origin') !== url.origin)) return json({ error: '请在本站访问记录' }, 403);
    try {
      const now = Date.now();
      if (request.method === 'GET') return json(responseData(await readCurrent(env.DB, deviceId, now)));
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '记录格式无效' }, 400);
      if (Number(request.headers.get('content-length')) > 2_000_000) return json({ error: '记录超过保存容量' }, 413);
      const chunks = [];
      let size = 0;
      if (request.body) {
        const reader = request.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) { await reader.cancel(); return json({ error: '记录超过保存容量' }, 413); }
          chunks.push(value);
        }
      }
      let data, ledger;
      try {
        const raw = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
        data = JSON.parse(new TextDecoder().decode(raw));
        if (!Number.isSafeInteger(data.revision) || data.revision < 0 || data.ledger?.version !== 2 || (data.revision > 0 && !uuid.test(data.generation ?? ''))) throw new Error();
        ledger = restoreLedger(data.ledger);
        const dates = [ledger.session.startedAt, ...(ledger.session.endedAt === undefined ? [] : [ledger.session.endedAt]), ...ledger.session.events.map(event => event.at),
          ...ledger.history.flatMap(entry => [entry.endedAt, entry.session.startedAt, ...entry.session.events.map(event => event.at)])];
        if (dates.some(at => at > now + 5 * 60 * 1000)) throw new Error();
      } catch { return json({ error: '记录格式无效，未修改已保存数据' }, 400); }
      const current = await readCurrent(env.DB, deviceId, now);
      if ((current?.revision ?? 0) !== data.revision || (current && current.generation !== data.generation)) return json({ ...responseData(current), error: '另一页面已更新记录或旧数据已清理，已同步，请重试' }, 409);
      const previous = current ? JSON.parse(current.data) : null;
      const finished = previous?.ledger.session;
      if (finished?.endedAt !== undefined && ledger.session.startedAt === finished.startedAt && ledger.session.round === finished.round
        && JSON.stringify(ledger.session) !== JSON.stringify(restoreLedger(previous.ledger).session)) return json({ error: '本局已结束，请新开一局，最终记录未修改' }, 400);
      const kept = prepareLedger(ledger, previous, now);
      const encoded = JSON.stringify({ ledger: kept.ledger, memberSeen: kept.memberSeen });
      const generation = current?.generation ?? crypto.randomUUID();
      const result = current
        ? await env.DB.prepare('UPDATE device_ledgers SET data = ?, revision = revision + 1, updated_at = ?, cleanup_at = ? WHERE device_id = ? AND revision = ? AND generation = ?')
          .bind(encoded, now, kept.cleanupAt, deviceId, data.revision, generation).run()
        : await env.DB.prepare('INSERT INTO device_ledgers (device_id, data, revision, generation, updated_at, cleanup_at) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT(device_id) DO NOTHING')
          .bind(deviceId, encoded, generation, now, kept.cleanupAt).run();
      if (!result.meta.changes) return json({ ...responseData(await readCurrent(env.DB, deviceId, now)), error: '另一页面已更新记录，已同步，请重试' }, 409);
      return json({ ledger: kept.ledger, revision: data.revision + 1, generation });
    } catch (error) {
      console.error('Ledger storage unavailable', error);
      return json({ error: '记录服务暂时不可用，请稍后重试' }, 503);
    }
  },
};
