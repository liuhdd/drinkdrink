import { restoreLedger } from '../dist/persistence.mjs';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function readLedger(db, userId) {
  const row = await db.prepare('SELECT data, revision FROM ledgers WHERE user_id = ?').bind(userId).first();
  return row ? { ledger: restoreLedger(JSON.parse(row.data)), revision: row.revision } : { ledger: null, revision: 0 };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/ledger') return env.ASSETS.fetch(request);
    const userId = request.headers.get('oai-authenticated-user-id');
    if (!userId) return json({ error: '请登录后读取和保存酒局' }, 401);
    if (!['GET', 'PUT'].includes(request.method)) return json({ error: '不支持此操作' }, 405);
    if (request.method === 'PUT' && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) return json({ error: '请在本站保存记录' }, 403);
    try {
      if (request.method === 'GET') return json(await readLedger(env.DB, userId));
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '记录格式无效' }, 400);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 2_000_000) return json({ error: '记录超过保存容量，请保留当前页面并联系维护者' }, 413);
      let data;
      let ledger;
      try {
        data = JSON.parse(raw);
        if (!Number.isSafeInteger(data.revision) || data.revision < 0 || data.ledger?.version !== 2) throw new Error('invalid revision');
        ledger = restoreLedger(data.ledger);
      } catch { return json({ error: '记录格式无效，未修改已保存数据' }, 400); }
      const encoded = JSON.stringify(ledger);
      const result = data.revision === 0
        ? await env.DB.prepare('INSERT INTO ledgers (user_id, data, revision) VALUES (?, ?, 1) ON CONFLICT(user_id) DO NOTHING').bind(userId, encoded).run()
        : await env.DB.prepare('UPDATE ledgers SET data = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?').bind(encoded, userId, data.revision).run();
      if (!result.meta.changes) return json({ ...await readLedger(env.DB, userId), error: '另一页面已更新记录，请同步后重试' }, 409);
      return json({ revision: data.revision + 1 });
    } catch (error) {
      console.error('Ledger storage unavailable', error);
      return json({ error: '记录服务暂时不可用，请稍后重试' }, 503);
    }
  },
};
