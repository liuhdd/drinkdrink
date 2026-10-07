import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ledgerServer, successful } from './http-fixture.ts';
import { disconnectingProxy, lostSaveResponseProxy, unavailableUpstreamProxy } from './network-fixture.ts';
import { createDeviceClient, DEVICE_KEY } from '../src/client/server-storage.ts';
import { diagnosticDatabase } from '../src/server/database.ts';
import { sqliteAdapter } from '../scripts/sqlite.ts';
import { emptyLedger } from '../src/shared/persistence.ts';
import { decodeSnapshot } from '../src/shared/protocol.ts';
import { at, requireLedger } from '../src/shared/values.ts';
import { isProblem } from '../src/shared/errors.ts';

test('真实 TCP 断连最多请求三次，耗尽后保留最后网络错误及请求参数', async t => {
  const service = await ledgerServer(t);
  const proxy = await disconnectingProxy(t);
  const client = createDeviceClient({ storage: service.storage, fetch: proxy.request, randomUUID: () => crypto.randomUUID() });
  await assert.rejects(client.load(), error => {
    assert.ok(error instanceof Error && isProblem(error));
    assert.equal(error.code, 'NETWORK');
    assert.equal(error.details.request?.deviceId, service.storage.getItem(DEVICE_KEY));
    assert.ok(error.cause instanceof Error);
    return true;
  });
  assert.equal(proxy.exchanges.length, 3);
});

test('真实 PUT 已提交但响应断连时，重试使用同一请求标识和内容且不重复增加版本', async t => {
  const service = await ledgerServer(t);
  const initialClient = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(initialClient.initialize());
  const proxy = await lostSaveResponseProxy(t, service.origin);
  const client = createDeviceClient({ storage: service.storage, fetch: proxy.request, randomUUID: () => crypto.randomUUID() });
  const saved = await successful(client.save({ ...requireLedger(initial), step: 2 }, initial.revision, initial.generation));
  const writes = proxy.exchanges.filter(exchange => exchange.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.ok(at(writes, 0).requestId !== null);
  assert.deepEqual(at(writes, 0), at(writes, 1));
  assert.equal(saved.revision, initial.revision + 1);
  assert.deepEqual(await initialClient.load(), saved);
  assert.equal(requireLedger(saved).step, 2);
  await assert.rejects(() => client.save(requireLedger(initial), initial.revision, initial.generation), error => { assert.ok(error instanceof Error && isProblem(error)); assert.equal(error.code, 'CONFLICT'); return true; });
  assert.equal(proxy.exchanges.length, 3);
  const future = { ...requireLedger(saved), session: { ...requireLedger(saved).session, startedAt: Date.now() + 3_600_000 } };
  await assert.rejects(() => client.save(future, saved.revision, saved.generation), error => { assert.ok(error instanceof Error && isProblem(error)); assert.equal(error.code, 'VALIDATION'); return true; });
  assert.equal(proxy.exchanges.length, 4);
});

test('重复请求和并发创建幂等，同一标识不同内容拒绝，旧客户端保留版本检查', async t => {
  const service = await ledgerServer(t);
  const device = crypto.randomUUID(), requestId = crypto.randomUUID();
  const ledger = emptyLedger(Date.now());
  const body = JSON.stringify({ ledger, revision: 0, generation: null });
  const headers = { 'X-Device-ID': device, 'X-Request-ID': requestId, 'Content-Type': 'application/json' };
  const responses = await Promise.all([service.request('/api/ledger', { method: 'PUT', headers, body }), service.request('/api/ledger', { method: 'PUT', headers, body })]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const saved = decodeSnapshot(await at(responses, 0).json());
  assert.deepEqual(decodeSnapshot(await at(responses, 1).json()), saved);
  const wrong = await service.request('/api/ledger', { method: 'PUT', headers, body: JSON.stringify({ ledger: { ...ledger, step: 2 }, revision: 0, generation: null }) });
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /不同请求/);
  const legacyHeaders = { 'X-Device-ID': device, 'Content-Type': 'application/json' };
  const conflict = await service.request('/api/ledger', { method: 'PUT', headers: legacyHeaders, body });
  assert.equal(conflict.status, 409);
  const nextBody = JSON.stringify({ ledger: { ...requireLedger(saved), step: 3 }, revision: saved.revision, generation: saved.generation });
  const concurrent = await Promise.all([service.request('/api/ledger', { method: 'PUT', headers: { ...headers, 'X-Request-ID': crypto.randomUUID() }, body: nextBody }), service.request('/api/ledger', { method: 'PUT', headers: { ...headers, 'X-Request-ID': crypto.randomUUID() }, body: nextBody })]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
  assert.equal(service.db.prepare('SELECT revision FROM device_ledgers WHERE device_id = ?').get(device)?.revision, 2);
});

test('真实 SQLite 写锁释放后重试成功，持续锁定耗尽后明确失败且不写入', async t => {
  const service = await ledgerServer(t);
  const lock = new DatabaseSync(service.databasePath);
  t.after(() => lock.close());
  const database = diagnosticDatabase(sqliteAdapter(service.db));
  const insert = database.prepare('INSERT INTO ledgers (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING').bind('lock-test', '{}');
  lock.exec('BEGIN IMMEDIATE');
  let locked = true;
  const release = setTimeout(() => { lock.exec('ROLLBACK'); locked = false; }, 40);
  try {
    const saved = await insert.run();
    assert.equal(saved.meta.changes, 1);
  } finally { clearTimeout(release); if (locked) lock.exec('ROLLBACK'); }
  lock.exec('BEGIN IMMEDIATE');
  try {
    await assert.rejects(database.prepare('INSERT INTO ledgers (user_id, data) VALUES (?, ?)').bind('never-written', '{}').run(), error => {
      assert.ok(error instanceof Error && isProblem(error));
      assert.equal(error.code, 'STORAGE');
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /database is locked/);
      assert.deepEqual(error.details.database?.parameters, ['never-written', '{}']);
      return true;
    });
  } finally { lock.exec('ROLLBACK'); }
  assert.equal(service.db.prepare('SELECT COUNT(*) AS total FROM ledgers WHERE user_id = ?').get('never-written')?.total, 0);
});

test('真实上游断连产生的 JSON 503 响应最多重试三次，保留状态与响应体', async t => {
  const service = await ledgerServer(t);
  const proxy = await unavailableUpstreamProxy(t, service.origin);
  await service.stop();
  const client = createDeviceClient({ storage: service.storage, fetch: proxy.request, randomUUID: () => crypto.randomUUID() });
  await assert.rejects(client.load(), error => {
    assert.ok(error instanceof Error && isProblem(error));
    assert.equal(error.details.status, 503);
    assert.match(String(error.details.responseBody), /fetch failed/);
    return true;
  });
  assert.equal(proxy.exchanges.length, 3);
});
