import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { cleanupExpired } from '../server/worker.mjs';
import { RETENTION_MS, retainLedger } from '../server/retention.mjs';
import { createSession, addMembers } from '../dist/domain.mjs';
import { emptyLedger, finishSession, startNextSession } from '../dist/persistence.mjs';
import { createDeviceClient, DEVICE_KEY, MIGRATION_KEY } from '../dist/server-storage.mjs';
import { STORAGE_KEY, LEGACY_STORAGE_KEY } from '../dist/device-storage.mjs';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url)));
  for (const entry of journal.entries) db.exec(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8'));
  const env = {
    DB: { prepare(sql) { return { bind(...params) { return {
      async first() { return db.prepare(sql).get(...params) ?? null; },
      async all() { return { results: db.prepare(sql).all(...params) }; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...params).changes) } }; },
    }; } }; } }, ASSETS: { fetch: () => new Response('asset') },
  };
  const fetch = (path, options = {}) => worker.fetch(new Request(`https://ledger.test${path}`, {
    ...options, headers: { ...options.headers, ...(options.method === 'PUT' ? { Origin: 'https://ledger.test' } : {}) },
  }), env);
  const request = (id, method = 'GET', data) => fetch('/api/ledger', { method, headers: { 'X-Device-ID': id, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { db, env, fetch, request };
}

const ledgerWithMember = () => ({ ...emptyLedger(), session: addMembers(createSession(), [{ name: '酒友甲', pending: 4 }]) });
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('结束本局通过服务端保存，重新加载保持最终结果，下一局不重复归档', async t => {
  const { fetch } = setup(t);
  const storage = memoryStorage();
  const client = createDeviceClient({ storage, fetch });
  const initial = await client.initialize();
  const active = await client.save(ledgerWithMember(), initial.revision, initial.generation);
  const finished = finishSession(active.ledger);
  await client.save(finished, active.revision, active.generation);
  const refreshed = await createDeviceClient({ storage, fetch }).initialize();
  assert.deepEqual(refreshed.ledger, finished);
  const edited = structuredClone(finished);
  edited.session.members[0].pending++;
  await assert.rejects(() => client.save(edited, refreshed.revision, refreshed.generation), /已结束/);
  assert.deepEqual(await client.load(), refreshed);
  const next = startNextSession(refreshed.ledger, { title: '下次小聚', cupSize: 2, keepMembers: true });
  const saved = await client.save(next, refreshed.revision, refreshed.generation);
  assert.equal(saved.ledger.history.length, 1);
  assert.equal(saved.ledger.history[0].endedAt, finished.session.endedAt);
  assert.equal(saved.ledger.session.endedAt, undefined);
  const future = structuredClone(saved);
  future.ledger.session.endedAt = Date.now() + 60 * 60 * 1000;
  await assert.rejects(() => client.save(future.ledger, future.revision, future.generation), /格式无效/);
  assert.deepEqual(await client.load(), saved);
});

test('已结束酒局按结束时间保留30天，到期后当前结果和归档一起清理', () => {
  const now = Date.now();
  const ledger = ledgerWithMember();
  ledger.session.startedAt = now - RETENTION_MS - 1000;
  ledger.session.events = [];
  const finished = finishSession(ledger, now - 1000);
  assert.deepEqual(retainLedger(finished, {}, now).ledger.session, finished.session);
  const boundary = retainLedger(finished, {}, finished.session.endedAt + RETENTION_MS).ledger;
  assert.equal(boundary.session.endedAt, finished.session.endedAt);
  assert.equal(boundary.history.length, 1);
  const expired = retainLedger(finished, {}, finished.session.endedAt + RETENTION_MS + 1).ledger;
  assert.equal(expired.session.endedAt, undefined);
  assert.equal(expired.session.members.length, 0);
  assert.equal(expired.history.length, 0);
});

test('无需登录，设备隔离；读写冲突不会覆盖账本，代际标识阻止已删除账本的旧页面写回', async t => {
  const { request, db } = setup(t);
  const id = crypto.randomUUID(), other = crypto.randomUUID();
  assert.equal((await request('missing')).status, 400);
  const saved = await (await request(id, 'PUT', { ledger: ledgerWithMember(), revision: 0, generation: null })).json();
  assert.equal(saved.revision, 1);
  assert.equal(saved.ledger.session.members[0].pending, 4);
  assert.deepEqual(await (await request(other)).json(), { ledger: null, revision: 0, generation: null });
  const writes = await Promise.all([request(id, 'PUT', { ...saved, ledger: { ...saved.ledger, step: 2 } }), request(id, 'PUT', { ...saved, ledger: { ...saved.ledger, step: 3 } })]);
  assert.deepEqual(writes.map(response => response.status).sort(), [200, 409]);
  assert.equal((await (await request(id)).json()).revision, 2);
  db.prepare('UPDATE device_ledgers SET updated_at = ? WHERE device_id = ?').run(Date.now() - RETENTION_MS - 1000, id);
  assert.equal((await (await request(id)).json()).revision, 0);
  const replacement = await (await request(id, 'PUT', { ledger: emptyLedger(), revision: 0, generation: null })).json();
  assert.notEqual(replacement.generation, saved.generation);
  assert.equal((await request(id, 'PUT', saved)).status, 409);
  assert.equal((await (await request(id)).json()).ledger.session.members[0].id, 'demo-1');
});

test('定时清理真实删除闲置设备；活跃设备也清理过期酒局、操作与未使用酒友，边界保留', async t => {
  const { request, db, env } = setup(t);
  const now = Date.now(), cutoff = now - RETENTION_MS;
  t.mock.method(Date, 'now', () => now);
  const id = crypto.randomUUID(), inactive = crypto.randomUUID();
  let ledger = ledgerWithMember();
  const recent = { ...ledger.session, startedAt: cutoff, events: [] };
  const old = { ...ledger.session, startedAt: cutoff - 1000, events: [] };
  ledger = { ...ledger, history: [{ id: 'old', endedAt: cutoff - 1, session: old }, { id: 'boundary', endedAt: cutoff, session: recent }], knownMembers: [{ id: 'old-friend', name: '旧酒友', color: 1 }, { id: 'recent-friend', name: '最近酒友', color: 0 }] };
  const saved = await (await request(id, 'PUT', { ledger, revision: 0, generation: null })).json();
  assert.equal(saved.ledger.history.length, 1);
  const stored = JSON.parse(db.prepare('SELECT data FROM device_ledgers WHERE device_id = ?').get(id).data);
  stored.ledger.history = ledger.history;
  stored.ledger.session.startedAt = cutoff - 1;
  stored.ledger.session.events[0].at = cutoff - 1;
  stored.memberSeen['old-friend'] = cutoff - 1;
  stored.memberSeen['recent-friend'] = cutoff;
  db.prepare('UPDATE device_ledgers SET data = ?, cleanup_at = ? WHERE device_id = ?').run(JSON.stringify(stored), cutoff, id);
  await request(inactive, 'PUT', { ledger: emptyLedger(), revision: 0, generation: null });
  db.prepare('UPDATE device_ledgers SET updated_at = ? WHERE device_id = ?').run(cutoff - 1, inactive);
  await worker.scheduled({ scheduledTime: now }, env);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM device_ledgers WHERE device_id = ?').get(inactive).count, 0);
  const row = db.prepare('SELECT * FROM device_ledgers WHERE device_id = ?').get(id);
  const cleaned = JSON.parse(row.data);
  assert.deepEqual(cleaned.ledger.history.map(entry => entry.id), ['boundary']);
  assert.deepEqual(cleaned.ledger.knownMembers.map(member => member.id), ['recent-friend']);
  assert.equal(cleaned.ledger.session.members.length, 0);
  assert.equal(cleaned.ledger.session.events.length, 0);
  assert.equal(row.revision, saved.revision + 1);
  const updatedAt = row.updated_at;
  await cleanupExpired(env.DB, now);
  assert.equal(db.prepare('SELECT updated_at FROM device_ledgers WHERE device_id = ?').get(id).updated_at, updatedAt);
});

test('读写也执行过期清理，修改其他酒友不会无限续期被移除的成员', async t => {
  const { request, db } = setup(t);
  const id = crypto.randomUUID();
  const ledger = ledgerWithMember();
  ledger.knownMembers = [{ id: 'removed', name: '已移除', color: 0 }];
  const saved = await (await request(id, 'PUT', { ledger, revision: 0, generation: null })).json();
  const row = db.prepare('SELECT * FROM device_ledgers WHERE device_id = ?').get(id);
  const stored = JSON.parse(row.data);
  stored.memberSeen.removed = Date.now() - RETENTION_MS - 10;
  db.prepare('UPDATE device_ledgers SET data = ?, cleanup_at = 0 WHERE device_id = ?').run(JSON.stringify(stored), id);
  const conflict = await request(id, 'PUT', { ...saved, ledger: { ...saved.ledger, step: 2 } });
  assert.equal(conflict.status, 409);
  const latest = await conflict.json();
  assert.deepEqual(latest.ledger.knownMembers, []);
  assert.equal(latest.ledger.session.members[0].name, '酒友甲');
});

test('服务端拒绝跨站请求、损坏/超大/未来数据；存储失败保留原记录', async t => {
  const { fetch, request, env } = setup(t);
  const id = crypto.randomUUID();
  const saved = await (await request(id, 'PUT', { ledger: ledgerWithMember(), revision: 0, generation: null })).json();
  assert.equal((await fetch('/api/ledger', { headers: { 'X-Device-ID': id, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request(id, 'POST')).status, 405);
  assert.equal((await request(id, 'PUT', { ...saved, ledger: {} })).status, 400);
  const future = structuredClone(saved);
  future.ledger.session.startedAt = Date.now() + 60 * 60 * 1000;
  assert.equal((await request(id, 'PUT', future)).status, 400);
  assert.equal((await fetch('/api/ledger', { method: 'PUT', headers: { 'X-Device-ID': id, 'Content-Type': 'application/json' }, body: ' '.repeat(2_000_001) })).status, 413);
  assert.deepEqual(await (await request(id)).json(), saved);
  const prepare = env.DB.prepare;
  env.DB.prepare = () => { throw new Error('test database unavailable'); };
  t.mock.method(console, 'error', () => {});
  assert.equal((await request(id)).status, 503);
  env.DB.prepare = prepare;
  assert.deepEqual(await (await request(id)).json(), saved);
});

test('体验局中用户添加的真实成员和计数也会在 30 天后清理', () => {
  const now = Date.now();
  const ledger = emptyLedger();
  ledger.session = addMembers(ledger.session, [{ name: '真实用户', pending: 8 }]);
  ledger.session.startedAt = now - RETENTION_MS - 1;
  const kept = retainLedger(ledger, {}, now);
  assert.equal(kept.ledger.session.demo, true);
  assert.equal(kept.ledger.session.members.some(member => member.name === '真实用户'), false);
  assert.equal(kept.ledger.session.events.length, 0);
});

test('旧浏览器记录迁移到服务端后清除本地账本，刷新恢复；过期后不会重复迁移旧备份', async t => {
  const { fetch, db } = setup(t);
  const storage = memoryStorage();
  const original = { session: ledgerWithMember().session, step: 2 };
  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(original));
  const client = createDeviceClient({ storage, fetch });
  const migrated = await client.initialize();
  assert.equal(migrated.ledger.session.members[0].name, '酒友甲');
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem(MIGRATION_KEY), storage.getItem(DEVICE_KEY));
  assert.deepEqual(await createDeviceClient({ storage, fetch }).initialize(), migrated);
  db.prepare('UPDATE device_ledgers SET updated_at = ?').run(Date.now() - RETENTION_MS - 1000);
  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(original));
  const fresh = await createDeviceClient({ storage, fetch }).initialize();
  assert.equal(fresh.ledger.session.demo, true);
  assert.equal(fresh.ledger.knownMembers.length, 0);
});

test('新版记录优先迁移；网络失败、损坏备份和设备标识保存失败不会丢失旧数据', async t => {
  const { fetch } = setup(t);
  const storage = memoryStorage();
  const ledger = ledgerWithMember();
  storage.setItem(STORAGE_KEY, JSON.stringify({ ledger, revision: 9 }));
  storage.setItem(LEGACY_STORAGE_KEY, 'broken legacy');
  const original = storage.getItem(STORAGE_KEY);
  const offline = createDeviceClient({ storage, fetch: () => { throw new Error('offline'); } });
  await assert.rejects(offline.initialize(), /网络/);
  assert.equal(storage.getItem(STORAGE_KEY), original);
  const migrated = await createDeviceClient({ storage, fetch }).initialize();
  assert.equal(migrated.ledger.session.members[0].name, '酒友甲');
  const bad = memoryStorage();
  bad.setItem(STORAGE_KEY, '{broken');
  await assert.rejects(createDeviceClient({ storage: bad, fetch }).initialize());
  assert.equal(bad.getItem(STORAGE_KEY), '{broken');
  const blocked = createDeviceClient({ storage: { getItem: () => null, setItem() { throw new Error('storage blocked'); } }, fetch });
  await assert.rejects(blocked.initialize());
  await assert.rejects(blocked.initialize());
});
