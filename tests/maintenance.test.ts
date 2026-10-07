import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { ledgerServer, successful } from './http-fixture.ts';
import { createDeviceClient, DEVICE_KEY, MIGRATION_KEY, SYNC_KEY } from '../src/client/server-storage.ts';
import { STORAGE_KEY, LEGACY_STORAGE_KEY } from '../src/client/device-storage.ts';
import { isProblem } from '../src/shared/errors.ts';
import { requireLedger } from '../src/shared/values.ts';

test('真实文件权限失败明确区分服务端已保存与本地维护失败，修复不重复写账本', async t => {
  const service = await ledgerServer(t);
  const client = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  service.storage.setItem(STORAGE_KEY, 'old v2 backup');
  service.storage.setItem(LEGACY_STORAGE_KEY, 'old v1 backup');
  chmodSync(service.storagePath, 0o400);
  try {
    const result = await client.save({ ...requireLedger(initial), step: 2 }, initial.revision, initial.generation);
    assert.equal(result.snapshot.revision, initial.revision + 1);
    assert.equal(requireLedger(result.snapshot).step, 2);
    assert.ok(result.localError !== null && isProblem(result.localError));
    assert.equal(result.localError.code, 'BROWSER');
    assert.equal(result.localError.details.path, MIGRATION_KEY);
    assert.ok(result.localError.cause instanceof Error);
    assert.match(result.localError.message, /已在服务端保存/);
    assert.equal(service.storage.getItem(STORAGE_KEY), 'old v2 backup');
    assert.deepEqual(await client.load(), result.snapshot);
    chmodSync(service.storagePath, 0o600);
    assert.deepEqual(await client.repairLocalStorage(), result.snapshot);
    assert.equal(service.storage.getItem(STORAGE_KEY), null);
    assert.equal(service.storage.getItem(LEGACY_STORAGE_KEY), null);
    assert.equal(service.storage.getItem(MIGRATION_KEY), service.storage.getItem(DEVICE_KEY));
    assert.match(String(service.storage.getItem(SYNC_KEY)), /^[0-9a-f-]{36}$/);
    assert.deepEqual(await client.load(), result.snapshot);
  } finally { chmodSync(service.storagePath, 0o600); }
});

test('损坏的设备标识明确失败，不替换标识或请求另一本账本', async t => {
  const service = await ledgerServer(t);
  service.storage.setItem(DEVICE_KEY, 'invalid-device');
  const client = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  await assert.rejects(client.initialize(), error => {
    assert.ok(error instanceof Error && isProblem(error));
    assert.equal(error.code, 'VALIDATION');
    assert.equal(error.details.path, DEVICE_KEY);
    return true;
  });
  assert.equal(service.storage.getItem(DEVICE_KEY), 'invalid-device');
  assert.equal(service.db.prepare('SELECT COUNT(*) AS total FROM device_ledgers').get()?.total, 0);
});
