import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, addMembers } from '../dist/domain.mjs';
import { startNextSession } from '../dist/persistence.mjs';
import { loadDeviceLedger, saveDeviceLedger, STORAGE_KEY, LEGACY_STORAGE_KEY } from '../dist/device-storage.mjs';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('设备存储迁移旧记录并保存历史和成员，重新读取恢复完整数据，其他设备独立', () => {
  const storage = memoryStorage();
  const original = JSON.stringify({ session: addMembers(createSession({ title: '今晚的酒局', cupSize: 2, members: [], round: 1, demo: false }), [{ name: '酒友甲' }], []), step: 2 });
  storage.setItem(LEGACY_STORAGE_KEY, original);
  const migrated = loadDeviceLedger(storage);
  assert.equal(migrated.ledger.knownMembers[0].name, '酒友甲');
  const archived = startNextSession(migrated.ledger, { title: '第二局', cupSize: 3, keepMembers: false }, Date.now());
  const saved = saveDeviceLedger(storage, archived, migrated.revision);
  assert.deepEqual(loadDeviceLedger(storage), saved);
  assert.equal(loadDeviceLedger(storage).ledger.history.length, 1);
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), original);
  assert.equal(loadDeviceLedger(memoryStorage()).revision, 0);
  assert.equal(loadDeviceLedger(memoryStorage()).ledger.history.length, 0);
});

test('旧页面不能覆盖新记录，存储失败及损坏数据不会覆盖原记录', () => {
  const storage = memoryStorage();
  const initial = loadDeviceLedger(storage);
  saveDeviceLedger(storage, initial.ledger, 0);
  const before = storage.getItem(STORAGE_KEY);
  assert.throws(() => saveDeviceLedger(storage, initial.ledger, 0), error => error.data.revision === 1);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  const fullStorage = { getItem: storage.getItem, setItem() { throw new Error('QuotaExceededError'); } };
  assert.throws(() => saveDeviceLedger(fullStorage, initial.ledger, 1), /QuotaExceededError/);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  storage.setItem(STORAGE_KEY, '{broken');
  assert.throws(() => loadDeviceLedger(storage));
  assert.throws(() => saveDeviceLedger(storage, initial.ledger, 1));
  assert.equal(storage.getItem(STORAGE_KEY), '{broken');
});
