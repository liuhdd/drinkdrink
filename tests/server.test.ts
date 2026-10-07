import { successful } from './http-fixture.ts';
import { databaseRow, storedLedger, memberSeen } from '../src/server/records.ts';
import { draftIdentity } from '../src/client/actions.ts';
import type { TestContext } from 'node:test';
import type { ExternalValue, WorkerEnv } from '../src/shared/types.ts';
import { requireLedger } from '../src/shared/values.ts';
import { decodeSnapshot } from '../src/shared/protocol.ts';
import { applyMigrations, sqliteAdapter } from '../scripts/sqlite.ts';
import { at, field } from '../src/shared/values.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { cleanupExpired } from '../src/server/worker.ts';
import { RETENTION_MS, retainLedger } from '../src/server/retention.ts';
import { createSession, addMembers } from '../src/shared/domain.ts';
import { emptyLedger, finishSession, startNextSession, restoreLedger } from '../src/shared/persistence.ts';
import { createDeviceClient, DEVICE_KEY, MIGRATION_KEY } from '../src/client/server-storage.ts';
import { STORAGE_KEY, LEGACY_STORAGE_KEY } from '../src/client/device-storage.ts';

function setup(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  applyMigrations(db);
  const env: WorkerEnv = { DB: sqliteAdapter(db), ASSETS: { fetch: () => new Response('asset') } };
  const fetch = (path: string, options: RequestInit) => worker.fetch(new Request(`https://ledger.test${path}`, {
    ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), ...(options.method === 'PUT' ? { Origin: 'https://ledger.test' } : {}) },
  }), env);
  const request = (id: string, method: string, data: ExternalValue) => fetch('/api/ledger', { method, headers: { 'X-Device-ID': id, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { db, env, fetch, request };
}

const ledgerWithMember = () => ({ ...emptyLedger(Date.now()), session: addMembers(createSession({ title: '今晚的酒局', cupSize: 2, members: [], round: 1 }, Date.now()), [{ name: '酒友甲', pending: 4 }], [], draftIdentity([{ name: '酒友甲', pending: 4 }].length)) });
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
};

test('结束本局通过服务端保存，重新加载保持最终结果，下一局不重复归档', async t => {
  const { fetch } = setup(t);
  const storage = memoryStorage();
  const client = createDeviceClient({ storage, fetch, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  const active = await successful(client.save(ledgerWithMember(), initial.revision, initial.generation));
  const finished = finishSession(requireLedger(active), Date.now(), crypto.randomUUID());
  await successful(client.save(finished, active.revision, active.generation));
  const refreshed = await successful(createDeviceClient({ storage, fetch, randomUUID: () => crypto.randomUUID() }).initialize());
  assert.deepEqual(requireLedger(refreshed), finished);
  const edited = structuredClone(finished);
  at(edited.session.members, 0).pending++;
  await assert.rejects(() => successful(client.save(edited, refreshed.revision, refreshed.generation)), /已结束/);
  assert.deepEqual(await client.load(), refreshed);
  const next = startNextSession(requireLedger(refreshed), { title: '下次小聚', cupSize: 2, members: requireLedger(refreshed).session.members }, Date.now(), crypto.randomUUID());
  const saved = await successful(client.save(next, refreshed.revision, refreshed.generation));
  assert.equal(requireLedger(saved).history.length, 1);
  assert.equal(at(requireLedger(saved).history, 0).endedAt, finished.session.endedAt);
  assert.equal(requireLedger(saved).session.endedAt, undefined);
  const future = structuredClone(saved);
  requireLedger(future).session.endedAt = Date.now() + 60 * 60 * 1000;
  await assert.rejects(() => successful(client.save(requireLedger(future), future.revision, future.generation)), /格式无效/);
  assert.deepEqual(await client.load(), saved);
});

test('已结束酒局按结束时间保留30天，到期后当前结果和归档一起清理', () => {
  const now = Date.now();
  const ledger = ledgerWithMember();
  ledger.session.startedAt = now - RETENTION_MS - 1000;
  ledger.session.events = [];
  const finished = finishSession(ledger, now - 1000, crypto.randomUUID());
  assert.deepEqual(retainLedger(finished, {}, now).ledger.session, finished.session);
  assert.ok(finished.session.endedAt !== undefined);
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
  assert.equal((await request('missing', 'GET', undefined)).status, 400);
  const saved = await readSnapshot(await request(id, 'PUT', { ledger: ledgerWithMember(), revision: 0, generation: null }));
  assert.equal(saved.revision, 1);
  assert.equal(at(requireLedger(saved).session.members, 0).pending, 4);
  assert.deepEqual(await readSnapshot(await request(other, 'GET', undefined)), { ledger: null, revision: 0, generation: null });
  const writes = await Promise.all([request(id, 'PUT', { ...saved, ledger: { ...requireLedger(saved), step: 2 } }), request(id, 'PUT', { ...saved, ledger: { ...requireLedger(saved), step: 3 } })]);
  assert.deepEqual(writes.map(response => response.status).sort(), [200, 409]);
  assert.equal((await readSnapshot(await request(id, 'GET', undefined))).revision, 2);
  db.prepare('UPDATE device_ledgers SET updated_at = ? WHERE device_id = ?').run(Date.now() - RETENTION_MS - 1000, id);
  assert.equal((await readSnapshot(await request(id, 'GET', undefined))).revision, 0);
  const replacement = await readSnapshot(await request(id, 'PUT', { ledger: emptyLedger(Date.now()), revision: 0, generation: null }));
  assert.notEqual(replacement.generation, saved.generation);
  assert.equal((await request(id, 'PUT', saved)).status, 409);
  assert.equal(at(requireLedger(await readSnapshot(await request(id, 'GET', undefined))).session.members, 0).id, 'demo-1');
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
  const saved = await readSnapshot(await request(id, 'PUT', { ledger, revision: 0, generation: null }));
  assert.equal(requireLedger(saved).history.length, 1);
  const raw = field(db.prepare('SELECT data FROM device_ledgers WHERE device_id = ?').get(id), 'data');
  assert.equal(typeof raw, 'string');
  const stored = storedLedger(JSON.parse(String(raw)));
  stored.ledger.history = ledger.history;
  stored.ledger.session.startedAt = cutoff - 1;
  at(stored.ledger.session.events, 0).at = cutoff - 1;
  stored.memberSeen['old-friend'] = cutoff - 1;
  stored.memberSeen['recent-friend'] = cutoff;
  db.prepare('UPDATE device_ledgers SET data = ?, cleanup_at = ? WHERE device_id = ?').run(JSON.stringify(stored), cutoff, id);
  await request(inactive, 'PUT', { ledger: emptyLedger(Date.now()), revision: 0, generation: null });
  db.prepare('UPDATE device_ledgers SET updated_at = ? WHERE device_id = ?').run(cutoff - 1, inactive);
  await worker.scheduled({ scheduledTime: now }, env);
  assert.equal(field(db.prepare('SELECT COUNT(*) AS count FROM device_ledgers WHERE device_id = ?').get(inactive), 'count'), 0);
  const row = databaseRow(db.prepare('SELECT * FROM device_ledgers WHERE device_id = ?').get(id));
  const cleaned = storedLedger(JSON.parse(row.data));
  assert.deepEqual(cleaned.ledger.history.map(entry => entry.id), ['boundary']);
  assert.deepEqual(cleaned.ledger.knownMembers.map(member => member.id), ['recent-friend']);
  assert.equal(cleaned.ledger.session.members.length, 0);
  assert.equal(cleaned.ledger.session.events.length, 0);
  assert.equal(row.revision, saved.revision + 1);
  const updatedAt = row.updated_at;
  await cleanupExpired(env.DB, now);
  assert.equal(field(db.prepare('SELECT updated_at FROM device_ledgers WHERE device_id = ?').get(id), 'updated_at'), updatedAt);
});

test('读写也执行过期清理，修改其他酒友不会无限续期被移除的成员', async t => {
  const { request, db } = setup(t);
  const id = crypto.randomUUID();
  const ledger = ledgerWithMember();
  ledger.knownMembers = [{ id: 'removed', name: '已移除', color: 0 }];
  const saved = await readSnapshot(await request(id, 'PUT', { ledger, revision: 0, generation: null }));
  const row = databaseRow(db.prepare('SELECT * FROM device_ledgers WHERE device_id = ?').get(id));
  const stored = storedLedger(JSON.parse(row.data));
  stored.memberSeen.removed = Date.now() - RETENTION_MS - 10;
  db.prepare('UPDATE device_ledgers SET data = ?, cleanup_at = 0 WHERE device_id = ?').run(JSON.stringify(stored), id);
  const conflict = await request(id, 'PUT', { ...saved, ledger: { ...requireLedger(saved), step: 2 } });
  assert.equal(conflict.status, 409);
  const latest = await readSnapshot(conflict);
  assert.deepEqual(requireLedger(latest).knownMembers, []);
  assert.equal(at(requireLedger(latest).session.members, 0).name, '酒友甲');
});

test('服务端拒绝跨站请求、损坏/超大/未来数据；存储失败保留原记录', async t => {
  const { fetch, request, env } = setup(t);
  const id = crypto.randomUUID();
  const saved = await readSnapshot(await request(id, 'PUT', { ledger: ledgerWithMember(), revision: 0, generation: null }));
  assert.equal((await fetch('/api/ledger', { headers: { 'X-Device-ID': id, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request(id, 'POST', undefined)).status, 405);
  assert.equal((await request(id, 'PUT', { ...saved, ledger: {} })).status, 400);
  const future = structuredClone(saved);
  requireLedger(future).session.startedAt = Date.now() + 60 * 60 * 1000;
  assert.equal((await request(id, 'PUT', future)).status, 400);
  assert.equal((await fetch('/api/ledger', { method: 'PUT', headers: { 'X-Device-ID': id, 'Content-Type': 'application/json' }, body: ' '.repeat(2_000_001) })).status, 413);
  assert.deepEqual(await readSnapshot(await request(id, 'GET', undefined)), saved);
  const prepare = env.DB.prepare;
  env.DB.prepare = () => { throw new Error('test database unavailable'); };
  t.mock.method(console, 'error', () => {});
  assert.equal((await request(id, 'GET', undefined)).status, 503);
  env.DB.prepare = prepare;
  assert.deepEqual(await readSnapshot(await request(id, 'GET', undefined)), saved);
});

test('体验局中用户添加的真实成员和计数也会在 30 天后清理', () => {
  const now = Date.now();
  const ledger = emptyLedger(Date.now());
  ledger.session = addMembers(ledger.session, [{ name: '真实用户', pending: 8 }], [], draftIdentity([{ name: '真实用户', pending: 8 }].length));
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
  const client = createDeviceClient({ storage, fetch, randomUUID: () => crypto.randomUUID() });
  const migrated = await successful(client.initialize());
  assert.equal(at(requireLedger(migrated).session.members, 0).name, '酒友甲');
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem(MIGRATION_KEY), storage.getItem(DEVICE_KEY));
  assert.deepEqual(await successful(createDeviceClient({ storage, fetch, randomUUID: () => crypto.randomUUID() }).initialize()), migrated);
  db.prepare('UPDATE device_ledgers SET updated_at = ?').run(Date.now() - RETENTION_MS - 1000);
  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(original));
  const fresh = await successful(createDeviceClient({ storage, fetch, randomUUID: () => crypto.randomUUID() }).initialize());
  assert.equal(requireLedger(fresh).session.demo, true);
  assert.equal(requireLedger(fresh).knownMembers.length, 0);
});

test('新版记录优先迁移；网络失败、损坏备份和设备标识保存失败不会丢失旧数据', async t => {
  const { fetch } = setup(t);
  const storage = memoryStorage();
  const ledger = ledgerWithMember();
  storage.setItem(STORAGE_KEY, JSON.stringify({ ledger, revision: 9 }));
  storage.setItem(LEGACY_STORAGE_KEY, 'broken legacy');
  const original = storage.getItem(STORAGE_KEY);
  const offline = createDeviceClient({ storage, fetch: () => { throw new Error('offline'); }, randomUUID: () => crypto.randomUUID() });
  await assert.rejects(successful(offline.initialize()), /网络/);
  assert.equal(storage.getItem(STORAGE_KEY), original);
  const migrated = await successful(createDeviceClient({ storage, fetch, randomUUID: () => crypto.randomUUID() }).initialize());
  assert.equal(at(requireLedger(migrated).session.members, 0).name, '酒友甲');
  const bad = memoryStorage();
  bad.setItem(STORAGE_KEY, '{broken');
  await assert.rejects(successful(createDeviceClient({ storage: bad, fetch, randomUUID: () => crypto.randomUUID() }).initialize()));
  assert.equal(bad.getItem(STORAGE_KEY), '{broken');
  const blocked = createDeviceClient({ storage: { getItem: () => null, setItem() { throw new Error('storage blocked'); }, removeItem: storage.removeItem }, fetch, randomUUID: () => crypto.randomUUID() });
  await assert.rejects(successful(blocked.initialize()));
  await assert.rejects(successful(blocked.initialize()));
});

async function readSnapshot(response: Response) { return decodeSnapshot(await response.json()); }
