import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerServer, successful } from './http-fixture.ts';
import { createDeviceClient } from '../src/client/server-storage.ts';
import { editMember } from '../src/client/edit-member.ts';
import { addMembers, addPending, createSession } from '../src/shared/domain.ts';
import { startNextSession, withLedgerSession } from '../src/shared/persistence.ts';
import { at, requireLedger } from '../src/shared/values.ts';

for (const scenario of ['new-session', 'changed-member', 'other-member'] as const) {
  test(`真实 HTTP 与 SQLite 成员编辑在 ${scenario} 冲突后只允许未变更目标重试`, async t => {
    const server = await ledgerServer(t);
    const client = createDeviceClient({ storage: server.storage, fetch: server.request, randomUUID: () => crypto.randomUUID() });
    const initial = await successful(client.initialize());
    const now = Date.now() - 1000;
    const session = addMembers(createSession({ title: '原局', cupSize: 2, round: 1, members: [] }, now), [{ name: '甲', pending: 6 }, { name: '乙', pending: 2 }], [], { memberIds: ['alice', 'bob'], eventIds: ['add-alice', 'add-bob'], at: now + 1 });
    const original = withLedgerSession({ version: 2 as const, session, step: 1, history: [], knownMembers: [] }, session, {});
    const saved = await successful(client.save(original, initial.revision, initial.generation));
    const member = at(session.members, 0);
    const changed = scenario === 'new-session'
      ? startNextSession(original, { title: '新局', cupSize: 3, members: session.members }, Date.now(), 'archive')
      : withLedgerSession(original, addPending(session, scenario === 'changed-member' ? 'alice' : 'bob', 3, { id: 'other-page-add', at: Date.now() }), {});
    const concurrent = await successful(client.save(changed, saved.revision, saved.generation));
    const source = { session, member };
    const identity = { id: 'edit', at: Date.now() };
    await assert.rejects(client.save(editMember(original, source, '新昵称', 0, '6', identity), saved.revision, saved.generation), /另一页面已更新记录/);
    const retry = () => editMember(requireLedger(concurrent), source, '新昵称', 0, '6', identity);
    if (scenario === 'other-member') {
      const updated = await successful(client.save(retry(), concurrent.revision, concurrent.generation));
      assert.equal(requireLedger(updated).session.members.find(item => item.id === 'bob')?.pending, 5);
      assert.equal(requireLedger(updated).session.members.find(item => item.id === 'alice')?.name, '新昵称');
    } else {
      assert.throws(retry, scenario === 'new-session' ? /当前酒局已变更/ : /记录已更新/);
      assert.deepEqual(await client.load(), concurrent);
    }
  });
}
