import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerServer, successful } from './http-fixture.ts';
import { lostSaveResponseProxy } from './network-fixture.ts';
import { createDeviceClient, DEVICE_KEY } from '../src/client/server-storage.ts';
import { addMembers, addPending, completeCup, createSession } from '../src/shared/domain.ts';
import { emptyLedger, finishSession, removeArchive, startNextSession, withLedgerSession } from '../src/shared/persistence.ts';
import { decodeSnapshot } from '../src/shared/protocol.ts';
import { isProblem } from '../src/shared/errors.ts';
import { at, requireLedger } from '../src/shared/values.ts';
import type { Ledger } from '../src/shared/types.ts';

function playedLedger(now: number): Ledger {
  const session = addMembers(createSession({ title: '第一场', cupSize: 2, members: [], round: 1 }, now - 1000), [{ name: '小柚', pending: 6 }], [], { memberIds: ['friend'], eventIds: ['added'], at: now - 900 });
  return withLedgerSession(emptyLedger(now - 1000), completeCup(session, 'friend', { id: 'drank', at: now - 800 }), { step: 3 });
}

test('直接新开一局经真实 HTTP 归档完整结果，丢失响应重试只保存一次，活动局可删除历史', async t => {
  const service = await ledgerServer(t);
  const client = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  const active = await successful(client.save(playedLedger(Date.now()), initial.revision, initial.generation));
  const previous = requireLedger(active);
  const endedAt = Date.now();
  const next = startNextSession(previous, { title: '第二场', cupSize: 3, members: previous.session.members }, endedAt, 'first-archive');
  const proxy = await lostSaveResponseProxy(t, service.origin);
  const retrying = createDeviceClient({ storage: service.storage, fetch: proxy.request, randomUUID: () => crypto.randomUUID() });
  const saved = await successful(retrying.save(next, active.revision, active.generation));
  const writes = proxy.exchanges.filter(exchange => exchange.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.ok(at(writes, 0).requestId);
  assert.deepEqual(at(writes, 0), at(writes, 1));
  assert.equal(saved.revision, active.revision + 1);
  assert.deepEqual(await client.load(), saved);
  const archived = at(requireLedger(saved).history, 0);
  assert.equal(requireLedger(saved).history.length, 1);
  assert.deepEqual(archived, { id: 'first-archive', endedAt, session: { ...previous.session, endedAt } });
  assert.deepEqual(at(requireLedger(saved).session.members, 0), { ...at(previous.session.members, 0), cupSize: 3, pending: 0, consumed: 0, cups: 0 });
  assert.deepEqual(requireLedger(saved).session.events, []);
  assert.equal(service.db.prepare('SELECT revision FROM device_ledgers WHERE device_id = ?').get(service.storage.getItem(DEVICE_KEY))?.revision, saved.revision);
  const deleted = await successful(client.save(removeArchive(requireLedger(saved), archived.id), saved.revision, saved.generation));
  assert.deepEqual(requireLedger(deleted), { ...requireLedger(saved), history: [] });
  assert.deepEqual(await client.load(), deleted);
});

test('已结束本局的归档可删除，删除响应重试幂等，最终结果只读且新开局不恢复删除记录', async t => {
  const service = await ledgerServer(t);
  const client = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  const finished = finishSession(playedLedger(Date.now()), Date.now(), 'finished-archive');
  const saved = await successful(client.save(finished, initial.revision, initial.generation));
  const proxy = await lostSaveResponseProxy(t, service.origin);
  const retrying = createDeviceClient({ storage: service.storage, fetch: proxy.request, randomUUID: () => crypto.randomUUID() });
  const deleted = await successful(retrying.save(removeArchive(requireLedger(saved), 'finished-archive'), saved.revision, saved.generation));
  const writes = proxy.exchanges.filter(exchange => exchange.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.ok(at(writes, 0).requestId);
  assert.deepEqual(at(writes, 0), at(writes, 1));
  assert.equal(deleted.revision, saved.revision + 1);
  assert.deepEqual(requireLedger(deleted), { ...finished, history: [] });
  assert.deepEqual(await client.load(), deleted);
  const altered = structuredClone(requireLedger(deleted));
  at(altered.session.members, 0).consumed++;
  await assert.rejects(client.save(altered, deleted.revision, deleted.generation), error => {
    assert.ok(error instanceof Error && isProblem(error));
    assert.equal(error.code, 'DOMAIN_RULE');
    return true;
  });
  assert.deepEqual(await client.load(), deleted);
  const next = startNextSession(requireLedger(deleted), { title: '第三场', cupSize: 2, members: finished.session.members }, Date.now(), 'must-not-reappear');
  const restarted = await successful(client.save(next, deleted.revision, deleted.generation));
  assert.deepEqual(requireLedger(restarted).history, []);
  assert.deepEqual(requireLedger(restarted).knownMembers, finished.knownMembers);
  assert.equal(requireLedger(restarted).session.endedAt, undefined);
  assert.deepEqual(await client.load(), restarted);
});

test('陈旧删除不能覆盖新记账，另一设备删除归档不影响原设备', async t => {
  const service = await ledgerServer(t);
  const client = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  const first = playedLedger(Date.now());
  const next = startNextSession(first, { title: '第二场', cupSize: 2, members: first.session.members }, Date.now(), 'archive');
  const saved = await successful(client.save(next, initial.revision, initial.generation));
  const staleDelete = removeArchive(requireLedger(saved), 'archive');
  const changed = withLedgerSession(next, addPending(next.session, 'friend', 4, { id: 'new-count', at: Date.now() }), {});
  const latest = await successful(client.save(changed, saved.revision, saved.generation));
  await assert.rejects(client.save(staleDelete, saved.revision, saved.generation), error => {
    assert.ok(error instanceof Error && isProblem(error));
    assert.equal(error.code, 'CONFLICT');
    return true;
  });
  assert.deepEqual(await client.load(), latest);
  assert.equal(at(requireLedger(latest).session.members, 0).pending, 4);
  const headers = { 'X-Device-ID': crypto.randomUUID(), 'X-Request-ID': crypto.randomUUID(), 'Content-Type': 'application/json' };
  const otherResponse = await service.request('/api/ledger', { method: 'PUT', headers, body: JSON.stringify({ ledger: next, revision: 0, generation: null }) });
  assert.equal(otherResponse.status, 200);
  const other = decodeSnapshot(await otherResponse.json());
  const deletionResponse = await service.request('/api/ledger', { method: 'PUT', headers: { ...headers, 'X-Request-ID': crypto.randomUUID() }, body: JSON.stringify({ ...other, ledger: removeArchive(requireLedger(other), 'archive') }) });
  assert.equal(deletionResponse.status, 200);
  const otherDeleted = decodeSnapshot(await deletionResponse.json());
  assert.deepEqual(requireLedger(otherDeleted), { ...next, history: [] });
  const otherRead = await service.request('/api/ledger', { method: 'GET', headers });
  assert.equal(otherRead.status, 200);
  assert.deepEqual(decodeSnapshot(await otherRead.json()), otherDeleted);
  assert.deepEqual(await client.load(), latest);
});
