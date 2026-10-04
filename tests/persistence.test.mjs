import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, addMembers, memberAction, demoSession } from '../dist/domain.mjs';
import { restoreLedger, startNextSession, rememberMembers, availableMembers } from '../dist/persistence.mjs';

test('旧版本记录迁移后，新开酒局归档全部计数与记录，刷新仍可读取', () => {
  let session = addMembers(createSession({ title: '周五小聚' }), [{ name: '阿杰', pending: 6 }]);
  session = memberAction(session, session.members[0].id, 'drink');
  const old = { session, step: 3 };
  const migrated = restoreLedger(old);
  assert.equal(migrated.knownMembers[0].name, '阿杰');
  const next = startNextSession(migrated, { title: '周六小聚', cupSize: 4, keepMembers: true }, session.startedAt + 1000);
  assert.deepEqual(next.history[0].session, session);
  assert.equal(next.history[0].endedAt, session.startedAt + 1000);
  assert.equal(next.session.round, 2);
  assert.equal(next.session.members[0].pending, 0);
  assert.equal(next.session.members[0].consumed, 0);
  assert.equal(next.session.members[0].cupSize, 4);
  assert.deepEqual(restoreLedger(JSON.parse(JSON.stringify(next))), next);
  assert.equal(migrated.history.length, 0);
  assert.equal(old.session.members[0].consumed, 2);
  assert.equal(startNextSession(restoreLedger({ session: demoSession(), step: 1 }), { title: '正式酒局', cupSize: 2 }).history.length, 0);
});

test('旧体验酒局中用户自己添加的成员仍迁移，改名不删除另一个已保存身份', () => {
  const demo = addMembers(demoSession(), [{ name: '真实酒友' }]);
  const migrated = restoreLedger({ session: demo, step: 1 });
  assert.deepEqual(migrated.knownMembers.map(member => member.name), ['真实酒友']);
  const members = [{ id: 'a', name: '小林', color: 1 }, { id: 'b', name: '阿杰', color: 2 }];
  const remembered = rememberMembers(members, [{ ...members[0], name: '阿杰' }]);
  assert.deepEqual(remembered.map(member => member.id), ['a', 'b']);
  assert.equal(remembered.find(member => member.id === 'b').color, 2);
});

test('恢复记录拒绝伪装成数字的字符串、无效日期和损坏历史，避免污染计数', () => {
  const value = restoreLedger({ session: addMembers(createSession(), [{ name: '酒友' }]), step: 1 });
  const badCount = structuredClone(value);
  badCount.session.members[0].pending = '1';
  assert.throws(() => restoreLedger(badCount));
  const badDate = structuredClone(value);
  badDate.session.startedAt = 1e20;
  assert.throws(() => restoreLedger(badDate));
  assert.throws(() => restoreLedger({ ...value, history: [{ id: 'bad', endedAt: 0, session: value.session }] }));
  assert.throws(() => restoreLedger({ ...value, knownMembers: [{ id: 'x', name: '', color: 0 }] }));
});

test('已添加成员离局后可快捷重选，重选保留身份与颜色、清零已喝且不重复', () => {
  const first = addMembers(createSession(), [{ name: '阿杰' }, { name: '小林' }]);
  const profiles = rememberMembers([], first.members.map(member => ({ ...member, color: 5 })));
  const next = startNextSession(restoreLedger({ session: first, step: 1 }), { title: '第二局', cupSize: 3 });
  const added = addMembers(next.session, [{ knownMemberId: profiles[0].id, pending: 4 }], profiles);
  assert.equal(added.members[0].id, first.members[1].id);
  assert.equal(added.members[0].name, '小林');
  assert.equal(added.members[0].color, 5);
  assert.equal(added.members[0].consumed, 0);
  assert.equal(added.members[0].pending, 4);
  assert.equal(added.members[0].cupSize, 3);
  assert.deepEqual(availableMembers(profiles, added).map(member => member.name), ['阿杰']);
  assert.throws(() => addMembers(added, [{ knownMemberId: profiles[0].id }], profiles), /重复/);
  assert.throws(() => addMembers(next.session, [{ knownMemberId: 'missing' }], profiles), /没有找到/);
  const manual = addMembers(next.session, [{ name: '小林' }], profiles);
  assert.equal(manual.members[0].id, profiles[0].id);
  const renamed = rememberMembers(profiles, [{ ...profiles[0], name: '林哥' }]);
  assert.deepEqual(renamed.map(member => member.name), ['林哥', '阿杰']);
  assert.equal(availableMembers(renamed, added).length, 1);
});
