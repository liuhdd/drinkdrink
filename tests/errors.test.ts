import { successful } from './http-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerServer } from './http-fixture.ts';
import { createDeviceClient, DEVICE_KEY } from '../src/client/server-storage.ts';
import { emptyLedger } from '../src/shared/persistence.ts';
import { isProblem } from '../src/shared/errors.ts';
import { field, requireLedger } from '../src/shared/values.ts';

test('真实 HTTP 校验错误包含字段路径、请求内容和状态；数据库失败保留原始原因', async t => {
  const service = await ledgerServer(t);
  const deviceId = crypto.randomUUID();
  const body = JSON.stringify({ ledger: { ...emptyLedger(Date.now()), step: '2' }, revision: 0, generation: null });
  const response = await service.request('/api/ledger', { method: 'PUT', headers: { 'X-Device-ID': deviceId, 'Content-Type': 'application/json' }, body });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.equal(field(data, 'code'), 'VALIDATION');
  assert.equal(field(field(data, 'details'), 'path'), 'ledger.step');
  assert.equal(field(field(field(data, 'details'), 'request'), 'body'), body);
  service.closeDatabase();
  const failed = await service.request('/api/ledger', { method: 'GET', headers: { 'X-Device-ID': deviceId } });
  const failure = await failed.json();
  assert.equal(failed.status, 503);
  assert.equal(field(failure, 'code'), 'STORAGE');
  assert.match(String(field(field(failure, 'cause'), 'message')), /not open|closed/i);
  assert.match(String(field(field(field(failure, 'details'), 'database'), 'sql')), /DELETE/);
});

test('真实断连和 API 错误在客户端保留请求、响应及异常原因', async t => {
  const service = await ledgerServer(t);
  const client = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  await assert.rejects(() => successful(client.save({ ...emptyLedger(Date.now()), session: { ...emptyLedger(Date.now()).session, startedAt: Date.now() + 3_600_000 } }, initial.revision, initial.generation)), error => {
    assert.ok(error instanceof Error && isProblem(error));
    assert.equal(error.details.status, 400);
    assert.ok(error.details.request?.body);
    assert.ok(error.details.responseBody);
    return true;
  });
  await service.stop();
  await assert.rejects(client.load(), error => {
    assert.ok(error instanceof Error && isProblem(error));
    assert.equal(error.code, 'NETWORK');
    assert.equal(error.details.request?.method, 'GET');
    assert.ok(error.cause instanceof Error);
    return true;
  });
});

test('真实 SQLite 损坏的版本元数据归为服务端存储损坏，不归咎请求参数', async t => {
  const service = await ledgerServer(t);
  const client = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  await successful(client.initialize());
  service.db.prepare('UPDATE device_ledgers SET revision = 0 WHERE device_id = ?').run(service.storage.getItem(DEVICE_KEY));
  await assert.rejects(client.load(), error => {
    assert.ok(error instanceof Error && isProblem(error));
    assert.equal(error.code, 'CORRUPT_STORAGE');
    assert.equal(error.details.status, 500);
    assert.equal(error.details.path, 'database.revision');
    assert.ok(error.cause instanceof Error);
    assert.match(String(error.details.responseBody), /SELECT/);
    return true;
  });
});
