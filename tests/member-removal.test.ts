import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerServer, successful } from './http-fixture.ts';
import { createDeviceClient } from '../src/client/server-storage.ts';
import { removeMember } from '../src/client/remove-member.ts';
import { addMembers, addPending, completeCup, createSession } from '../src/shared/domain.ts';
import { finishSession, startNextSession, withLedgerSession } from '../src/shared/persistence.ts';
import { requireLedger, at } from '../src/shared/values.ts';
import type { Ledger } from '../src/shared/types.ts';

function fixture(now: number): Ledger {
  const session = addMembers(createSession({ title: '上一局', cupSize: 2, round: 1, members: [] }, now), [{ name: '酒友甲', pending: 6 }, { name: '酒友乙', pending: 4 }], [], { memberIds: ['alice', 'bob'], eventIds: ['initial-alice', 'initial-bob'], at: now + 1 });
  const previous = finishSession({ version: 2, session: completeCup(session, 'alice', { id: 'previous-cup', at: now + 2 }), step: 1, history: [], knownMembers: [] }, now + 3, 'previous');
  const next = startNextSession(previous, { title: '本局', cupSize: 2, members: session.members }, now + 4, 'unused');
  const pending = addPending(next.session, 'alice', 6, { id: 'pending', at: now + 5 });
  return withLedgerSession(next, completeCup(pending, 'alice', { id: 'current-cup', at: now + 6 }), {});
}

test('真实 HTTP 与 SQLite 删除酒友保留记录、历史和档案，可恢复完整计数并移除最后一位', async t => {
  const server = await ledgerServer(t);
  const client = createDeviceClient({ storage: server.storage, fetch: server.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  const original = fixture(Date.now() - 10_000);
  const saved = await successful(client.save(original, initial.revision, initial.generation));
  const member = at(original.session.members, 0);
  const removed = removeMember(original, original.session, member);
  assert.deepEqual(original, requireLedger(saved));
  assert.deepEqual(removed.session.members, original.session.members.slice(1));
  assert.deepEqual(removed.session.events, original.session.events);
  assert.deepEqual(removed.history, original.history);
  assert.deepEqual(removed.knownMembers, original.knownMembers);
  const deleted = await successful(client.save(removed, saved.revision, saved.generation));
  assert.deepEqual(requireLedger(await client.load()), removed);
  const restored = await successful(client.save(withLedgerSession(removed, original.session, {}), deleted.revision, deleted.generation));
  assert.deepEqual(requireLedger(restored), original);
  const remaining = removeMember(removed, removed.session, at(removed.session.members, 0));
  const empty = await successful(client.save(remaining, restored.revision, restored.generation));
  assert.deepEqual(requireLedger(empty).session.members, []);
  assert.deepEqual(requireLedger(empty).history, original.history);
  assert.deepEqual(requireLedger(empty).session.events, original.session.events);
});

test('真实版本冲突后删除仅接受同局同成员，不能覆盖更新计数、已结束或新局', async t => {
  const server = await ledgerServer(t);
  const client = createDeviceClient({ storage: server.storage, fetch: server.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  const original = fixture(Date.now() - 10_000);
  const saved = await successful(client.save(original, initial.revision, initial.generation));
  const member = at(original.session.members, 0);
  const changed = withLedgerSession(original, addPending(original.session, 'bob', 1, { id: 'other-page', at: Date.now() }), {});
  const concurrent = await successful(client.save(changed, saved.revision, saved.generation));
  await assert.rejects(client.save(removeMember(original, original.session, member), saved.revision, saved.generation), /另一页面已更新记录/);
  assert.deepEqual(await client.load(), concurrent);
  const retry = removeMember(changed, original.session, member);
  const deleted = await successful(client.save(retry, concurrent.revision, concurrent.generation));
  assert.deepEqual(requireLedger(deleted).session.members, changed.session.members.slice(1));
  assert.deepEqual(requireLedger(deleted).session.events, changed.session.events);
  assert.throws(() => removeMember(retry, original.session, member), /已不在本局/);
  const updated = withLedgerSession(original, addPending(original.session, member.id, 1, { id: 'updated-member', at: Date.now() }), {});
  assert.throws(() => removeMember(updated, original.session, member), /记录已更新/);
  assert.throws(() => removeMember(finishSession(original, Date.now(), 'ended'), original.session, member), /已结束/);
  const next = startNextSession(original, { title: '新局', cupSize: 2, members: original.session.members }, Date.now(), 'next');
  assert.throws(() => removeMember(next, original.session, member), /当前酒局已变更/);
  assert.deepEqual(await client.load(), deleted);
});
