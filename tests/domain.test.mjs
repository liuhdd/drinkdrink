import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, demoSession, memberAction, leaderboard, validateSession, normalizeSessionCupSize, addMembers, MAX_COUNT } from '../dist/domain.mjs';

test('加酒减酒仅影响该成员的待喝数量，并保留原状态', () => {
  const session = demoSession();
  const added = memberAction(session, 'demo-1', 'add', 4);
  assert.equal(added.members[0].pending, 10);
  assert.equal(session.members[0].pending, 6);
  assert.deepEqual(added.members.slice(1), session.members.slice(1));
  const removed = memberAction(added, 'demo-1', 'subtract', 3);
  assert.equal(removed.members[0].pending, 7);
  assert.equal(removed.members[0].consumed, 8);
});

test('喝完一杯采用本局统一杯量，同时更新待喝、已喝与杯数', () => {
  const session = demoSession();
  session.members[2].cupSize = 3;
  const after = memberAction(session, 'demo-3', 'drink', 1);
  assert.equal(after.members[2].pending, session.members[2].pending - session.cupSize);
  assert.equal(after.members[2].consumed, session.members[2].consumed + session.cupSize);
  assert.equal(after.members[2].cups, session.members[2].cups + 1);
  assert.equal(after.members[2].pending + after.members[2].consumed, session.members[2].pending + session.members[2].consumed);
  assert.equal(after.events[0].amount, 2);
});

test('数量不足与溢出操作被拒绝，原状态不受影响', () => {
  const session = demoSession();
  assert.throws(() => memberAction(session, 'demo-4', 'subtract', 3), /不能小于/);
  session.members[0].pending = 1;
  assert.throws(() => memberAction(session, 'demo-1', 'drink', 1), /不足/);
  session.members[0].pending = MAX_COUNT;
  assert.throws(() => memberAction(session, 'demo-1', 'add', 1), /上限/);
  session.members[0].consumed = MAX_COUNT;
  assert.throws(() => memberAction(session, 'demo-1', 'drink', 1), /上限/);
});

test('排行榜采用已喝个数，杯数不同仍正确排序，相同分数并列', () => {
  const session = demoSession();
  session.members[1].consumed = 8;
  const ranked = leaderboard(session);
  assert.deepEqual(ranked.map(member => member.id), ['demo-1', 'demo-2', 'demo-3', 'demo-4']);
  assert.deepEqual(ranked.map(member => member.rank), [1, 1, 3, 4]);
  assert.equal(leaderboard(createSession({ title: '今晚的酒局', cupSize: 2, members: [], round: 1, demo: false }))[0], undefined);
});

test('新开一局清空所有计数与记录，保留成员并应用统一杯量', () => {
  const old = memberAction(demoSession(), 'demo-1', 'drink', 1);
  const fresh = createSession({ title: '第二局', cupSize: 4, members: old.members, round: 2, demo: false });
  assert.equal(fresh.demo, false);
  assert.equal(fresh.round, 2);
  assert.equal(fresh.events.length, 0);
  assert.ok(fresh.members.every(member => member.cupSize === 4));
  assert.ok(fresh.members.every(member => member.pending === 0 && member.consumed === 0 && member.cups === 0));
  assert.equal(old.members[0].consumed, 10);
});

test('旧记录杯量统一为本局设置，保留既有计数和操作记录', () => {
  const old = memberAction(demoSession(), 'demo-1', 'drink', 1);
  old.members[2].cupSize = 3;
  old.members[3].cupSize = 1;
  const migrated = normalizeSessionCupSize(old);
  assert.ok(migrated.members.every(member => member.cupSize === old.cupSize));
  assert.deepEqual(migrated.members.map(({ cupSize, ...member }) => member), old.members.map(({ cupSize, ...member }) => member));
  assert.deepEqual(migrated.events, old.events);
  assert.equal(old.members[2].cupSize, 3);
  assert.equal(validateSession(migrated), true);
});

test('批量添加多个酒友，各自待喝数量独立且使用本局杯量', () => {
  const original = createSession({ cupSize: 3, title: '今晚的酒局', members: [], round: 1, demo: false });
  const next = addMembers(original, [{ name: ' 阿杰 ', pending: 4 }, { name: '小林', pending: 7 }], []);
  assert.deepEqual(next.members.map(({ name, pending, cupSize, consumed, cups }) => ({ name, pending, cupSize, consumed, cups })), [
    { name: '阿杰', pending: 4, cupSize: 3, consumed: 0, cups: 0 },
    { name: '小林', pending: 7, cupSize: 3, consumed: 0, cups: 0 },
  ]);
  assert.equal(new Set(next.members.map(member => member.id)).size, 2);
  assert.deepEqual(original.members, []);
  assert.equal(validateSession(next), true);
  assert.deepEqual(next.events.map(event => event.amount), [7, 4]);
  const consumed = memberAction(next, next.members[1].id, 'drink', 1);
  assert.equal(consumed.members[1].pending, 4);
  assert.equal(consumed.members[1].consumed, 3);
  assert.deepEqual(consumed.members[0], next.members[0]);
});

test('批量添加完整验证后才生效，拒绝空昵称、重复昵称和人数超限', () => {
  const original = demoSession();
  const before = structuredClone(original);
  for (const drafts of [[], [{ name: '新酒友', pending: 1 }, { name: ' ', pending: 1 }], [{ name: '新人' }, { name: '新人' }], [{ name: '阿杰' }], [{ name: 'abcdefghijklmn' }], [{ name: '新人', pending: -1 }]]) {
    assert.throws(() => addMembers(original, drafts, []));
    assert.deepEqual(original, before);
  }
  const almostFull = addMembers(createSession({ title: '今晚的酒局', cupSize: 2, members: [], round: 1, demo: false }), Array.from({ length: 29 }, (_, index) => ({ name: `成员${index}` })), []);
  assert.equal(addMembers(almostFull, [{ name: '第30位' }], []).members.length, 30);
  assert.throws(() => addMembers(almostFull, [{ name: '第30位' }, { name: '第31位' }], []), /30/);
  assert.equal(almostFull.members.length, 29);
});

test('恢复已保存的记账数据，包括直接编辑待喝为零的操作', () => {
  const session = memberAction(demoSession(), 'demo-1', 'drink', 1);
  session.events.unshift({ id: 'edited', memberId: 'demo-1', name: '阿杰', color: 0, action: 'set', amount: 0, at: Date.now() });
  assert.equal(validateSession(JSON.parse(JSON.stringify(session))), true);
  session.members[0].cupSize = 0;
  assert.equal(validateSession(session), false);
  assert.equal(validateSession({ version: 99 }), false);
});

test('无效输入无法污染计数', () => {
  for (const quantity of [-1, 0, 1.5, '', 'NaN']) {
    assert.throws(() => memberAction(demoSession(), 'demo-1', 'add', quantity));
  }
  assert.throws(() => memberAction(demoSession(), 'missing', 'drink', 1), /没有找到/);
  assert.throws(() => memberAction(demoSession(), 'demo-1', 'invalid', 1), /未知/);
});
