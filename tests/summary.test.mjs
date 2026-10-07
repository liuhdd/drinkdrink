import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, addMembers, memberAction } from '../dist/domain.mjs';
import { sessionSummary } from '../dist/summary.mjs';

test('分享总结包含所有成员、并列排行、实际杯数与剩余数量，且不修改账本', () => {
  let session = addMembers(createSession({ title: '朋友小聚', cupSize: 3 }), [{ name: '小林', pending: 7 }, { name: '阿杰', pending: 6 }, { name: '小柚' }]);
  session = memberAction(session, session.members[0].id, 'drink');
  session = memberAction(session, session.members[1].id, 'drink');
  const before = structuredClone(session);
  const summary = sessionSummary(session, session.startedAt + 61_000);
  assert.equal(summary.title, '朋友小聚');
  assert.equal(summary.durationMs, 61_000);
  assert.deepEqual(summary.totals, { members: 3, consumed: 6, cups: 2, pending: 7 });
  assert.deepEqual(summary.members.map(member => member.rank), [1, 1, 3]);
  assert.deepEqual(session, before);
  const empty = createSession();
  assert.deepEqual(sessionSummary(empty, empty.startedAt).totals, { members: 0, consumed: 0, cups: 0, pending: 0 });
});

test('总结支持最多30人和长昵称，拒绝未结束或无效时间', () => {
  const session = addMembers(createSession(), Array.from({ length: 30 }, (_, i) => ({ name: `十二个字的长昵称酒友${i}` })));
  assert.equal(sessionSummary(session, session.startedAt).members.length, 30);
  assert.throws(() => sessionSummary(session), /结束/);
  assert.throws(() => sessionSummary(session, session.startedAt - 1), /结束/);
});
