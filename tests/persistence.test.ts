import { at, field } from '../src/shared/values.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, addMembers, memberAction, demoSession } from '../src/shared/domain.ts';
import { restoreLedger, startNextSession, finishSession, rememberMembers, availableMembers } from '../src/shared/persistence.ts';

test('旧版本记录迁移后，新开酒局归档全部计数与记录，刷新仍可读取', () => {
  let session = addMembers(createSession({ title: '周五小聚', cupSize: 2, members: [], round: 1, demo: false }), [{ name: '阿杰', pending: 6 }], []);
  session = memberAction(session, at(session.members, 0).id, 'drink', 1);
  const old = { session, step: 3 };
  const migrated = restoreLedger(old);
  assert.equal(at(migrated.knownMembers, 0).name, '阿杰');
  const next = startNextSession(migrated, { title: '周六小聚', cupSize: 4, keepMembers: true }, session.startedAt + 1000);
  assert.deepEqual(at(next.history, 0).session, session);
  assert.equal(at(next.history, 0).endedAt, session.startedAt + 1000);
  assert.equal(next.session.round, 2);
  assert.equal(at(next.session.members, 0).pending, 0);
  assert.equal(at(next.session.members, 0).consumed, 0);
  assert.equal(at(next.session.members, 0).cupSize, 4);
  assert.deepEqual(restoreLedger(JSON.parse(JSON.stringify(next))), next);
  assert.equal(migrated.history.length, 0);
  assert.equal(at(old.session.members, 0).consumed, 2);
  assert.equal(startNextSession(restoreLedger({ session: demoSession(), step: 1 }), { title: '正式酒局', cupSize: 2, keepMembers: false }, Date.now()).history.length, 0);
});

test('结束本局立即归档且刷新保留结束状态，新开局不重复归档并可保留成员', () => {
  let session = addMembers(createSession({ title: '今晚小聚', cupSize: 2, members: [], round: 1, demo: false }), [{ name: '阿杰', pending: 6 }], []);
  session = memberAction(session, at(session.members, 0).id, 'drink', 1);
  const ledger = restoreLedger({ session, step: 3 });
  const endedAt = session.startedAt + 1000;
  const finished = finishSession(ledger, endedAt);
  assert.equal(finished.session.endedAt, endedAt);
  assert.equal(finished.history.length, 1);
  assert.equal(at(finished.history, 0).endedAt, endedAt);
  assert.deepEqual(at(finished.history, 0).session, finished.session);
  assert.equal(ledger.session.endedAt, undefined);
  const restored = restoreLedger(JSON.parse(JSON.stringify(finished)));
  assert.deepEqual(restored, finished);
  assert.throws(() => finishSession(restored, Date.now()), /已结束/);
  assert.throws(() => memberAction(restored.session, at(session.members, 0).id, 'add', 1), /已结束/);
  assert.throws(() => addMembers(restored.session, [{ name: '小林' }], []), /已结束/);
  const next = startNextSession(restored, { title: '下次再聚', cupSize: 3, keepMembers: true }, Date.now());
  assert.equal(next.history.length, 1);
  assert.equal(at(next.history, 0).endedAt, endedAt);
  assert.equal(next.session.endedAt, undefined);
  assert.equal(next.session.round, 2);
  assert.equal(at(next.session.members, 0).id, at(session.members, 0).id);
  assert.equal(at(next.session.members, 0).consumed, 0);
  assert.equal(at(next.session.members, 0).pending, 0);
  assert.equal(at(next.session.members, 0).cupSize, 3);
});

test('体验局不能结束归档，结束时间必须有效且不能早于开始时间', () => {
  assert.throws(() => finishSession(restoreLedger({ session: demoSession(), step: 1 }), Date.now()), /体验/);
  const ledger = restoreLedger({ session: createSession({ title: '今晚的酒局', cupSize: 2, members: [], round: 1, demo: false }), step: 1 });
  for (const endedAt of [NaN, Infinity, '1', ledger.session.startedAt - 1]) {
    assert.throws(() => finishSession(ledger, endedAt), /结束时间/);
    assert.throws(() => restoreLedger({ ...ledger, session: { ...ledger.session, endedAt } }));
  }
});

test('旧体验酒局中用户自己添加的成员仍迁移，改名不删除另一个已保存身份', () => {
  const demo = addMembers(demoSession(), [{ name: '真实酒友' }], []);
  const migrated = restoreLedger({ session: demo, step: 1 });
  assert.deepEqual(migrated.knownMembers.map(member => member.name), ['真实酒友']);
  const members = [{ id: 'a', name: '小林', color: 1 }, { id: 'b', name: '阿杰', color: 2 }];
  const remembered = rememberMembers(members, [{ ...at(members, 0), name: '阿杰' }]);
  assert.deepEqual(remembered.map(member => member.id), ['a', 'b']);
  assert.equal(remembered.find(member => member.id === 'b')?.color, 2);
});

test('恢复记录拒绝伪装成数字的字符串、无效日期和损坏历史，避免污染计数', () => {
  const value = restoreLedger({ session: addMembers(createSession({ title: '今晚的酒局', cupSize: 2, members: [], round: 1, demo: false }), [{ name: '酒友' }], []), step: 1 });
  const badCount = structuredClone(value);
  Reflect.set(at(badCount.session.members, 0), 'pending', '1');
  assert.throws(() => restoreLedger(badCount));
  const badDate = structuredClone(value);
  badDate.session.startedAt = 1e20;
  assert.throws(() => restoreLedger(badDate));
  assert.throws(() => restoreLedger({ ...value, history: [{ id: 'bad', endedAt: 0, session: value.session }] }));
  assert.throws(() => restoreLedger({ ...value, knownMembers: [{ id: 'x', name: '', color: 0 }] }));
});

test('已添加成员离局后可快捷重选，重选保留身份与颜色、清零已喝且不重复', () => {
  const first = addMembers(createSession({ title: '今晚的酒局', cupSize: 2, members: [], round: 1, demo: false }), [{ name: '阿杰' }, { name: '小林' }], []);
  const profiles = rememberMembers([], first.members.map(member => ({ ...member, color: 5 })));
  const next = startNextSession(restoreLedger({ session: first, step: 1 }), { title: '第二局', cupSize: 3, keepMembers: false }, Date.now());
  const added = addMembers(next.session, [{ knownMemberId: at(profiles, 0).id, pending: 4 }], profiles);
  assert.equal(at(added.members, 0).id, at(first.members, 1).id);
  assert.equal(at(added.members, 0).name, '小林');
  assert.equal(at(added.members, 0).color, 5);
  assert.equal(at(added.members, 0).consumed, 0);
  assert.equal(at(added.members, 0).pending, 4);
  assert.equal(at(added.members, 0).cupSize, 3);
  assert.deepEqual(availableMembers(profiles, added).map(member => member.name), ['阿杰']);
  assert.throws(() => addMembers(added, [{ knownMemberId: at(profiles, 0).id }], profiles), /重复/);
  assert.throws(() => addMembers(next.session, [{ knownMemberId: 'missing' }], profiles), /没有找到/);
  const manual = addMembers(next.session, [{ name: '小林' }], profiles);
  assert.equal(at(manual.members, 0).id, at(profiles, 0).id);
  const renamed = rememberMembers(profiles, [{ ...at(profiles, 0), name: '林哥' }]);
  assert.deepEqual(renamed.map(member => member.name), ['林哥', '阿杰']);
  assert.equal(availableMembers(renamed, added).length, 1);
});
