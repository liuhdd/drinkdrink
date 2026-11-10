import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerServer, successful } from './http-fixture.ts';
import { createDeviceClient } from '../src/client/server-storage.ts';
import { editMember } from '../src/client/edit-member.ts';
import { restoreMemberSnapshot } from '../src/client/undo-member.ts';
import { addMembers, createSession } from '../src/shared/domain.ts';
import { emptyLedger, withLedgerSession } from '../src/shared/persistence.ts';
import { at, requireLedger } from '../src/shared/values.ts';

test('真实 HTTP 保存后撤销改名拒绝占用其他已保存身份的昵称，原账本不变', async t => {
  const service = await ledgerServer(t);
  const client = createDeviceClient({ storage: service.storage, fetch: service.request, randomUUID: () => crypto.randomUUID() });
  const initial = await successful(client.initialize());
  const now = Date.now();
  const original = withLedgerSession(emptyLedger(now), addMembers(createSession({ title: '撤销验证', cupSize: 2, members: [], round: 1 }, now), [{ name: 'Alice' }], [], { memberIds: ['alice'], eventIds: [], at: now }), {});
  const renamed = editMember(original, { session: original.session, member: at(original.session.members, 0) }, 'Carol', 0, '0', { id: 'rename', at: now });
  assert.deepEqual(restoreMemberSnapshot(renamed, original.session), original);
  const added = withLedgerSession(renamed, addMembers(renamed.session, [{ name: 'Alice' }], renamed.knownMembers, { memberIds: ['another-alice'], eventIds: [], at: now }), {});
  const saved = await successful(client.save(added, initial.revision, initial.generation));
  const undoneAdd = await successful(client.save(restoreMemberSnapshot(requireLedger(saved), renamed.session), saved.revision, saved.generation));
  const ledger = requireLedger(undoneAdd);
  const before = structuredClone(ledger);
  for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => restoreMemberSnapshot(ledger, original.session), /无法撤销.*Alice/);
  assert.throws(() => restoreMemberSnapshot({ ...ledger, knownMembers: ledger.knownMembers.map(profile => profile.id === 'another-alice' ? { ...profile, name: 'ALICE' } : profile) }, original.session), /无法撤销.*Alice/);
  assert.deepEqual(ledger, before);
  assert.deepEqual(await client.load(), undoneAdd);
  assert.deepEqual(ledger.knownMembers.map(member => member.id).sort(), ['alice', 'another-alice']);
});
