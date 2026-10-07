import { migrateLegacyLedger } from '../src/shared/persistence.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, restoreLedger } from '../src/shared/persistence.ts';
import { memberActionInput } from '../src/shared/validation.ts';
import { saveRequestInput } from '../src/shared/protocol.ts';
import { databaseRow, memberSeen, at } from '../src/shared/values.ts';

test('当前账本要求完整强类型字段，无关字段不进入成员、操作和酒局', () => {
  const ledger = emptyLedger(Date.now());
  const { step, ...missingStep } = ledger;
  const { version, ...missingVersion } = ledger;
  assert.throws(() => restoreLedger(missingVersion), /version/);
  assert.throws(() => migrateLegacyLedger(missingVersion), /legacy/);
  assert.throws(() => restoreLedger(missingStep), /step/);
  assert.throws(() => restoreLedger({ ...ledger, step: '2' }), /step/);
  const session = { ...ledger.session, irrelevant: 'ignored', members: ledger.session.members.map(member => ({ ...member, irrelevant: 'ignored' })) };
  const restored = restoreLedger({ ...ledger, irrelevant: 'ignored', session });
  assert.deepEqual(restored, ledger);
  assert.throws(() => restoreLedger({ ...ledger, session: { ...session, members: [{ ...at(session.members, 0), color: '1' }] } }));
  assert.equal(migrateLegacyLedger({ session: ledger.session }).step, 1);
});

test('请求、WebMCP和数据库拒绝缺失或损坏数据，合法额外字段被忽略', () => {
  const now = Date.now();
  const ledger = emptyLedger(now);
  assert.throws(() => saveRequestInput({ ledger, revision: 0 }, now), /generation/);
  assert.throws(() => saveRequestInput({ ledger, revision: '0', generation: null }, now), /revision/);
  assert.deepEqual(saveRequestInput({ ledger, revision: 0, generation: null, extra: true }, now), { ledger, revision: 0, generation: null });
  assert.deepEqual(memberActionInput({ memberId: 'friend', action: 'add', quantity: 2, extra: true }, 1), { memberId: 'friend', action: 'add', quantity: 2 });
  assert.throws(() => memberActionInput({ memberId: 'friend', action: 'add', quantity: '2' }, 1), /quantity/);
  assert.throws(() => memberActionInput({ memberId: 'friend', action: ['drink'] }, 1), /action/);
  assert.throws(() => databaseRow({ data: 'invalid' }));
  assert.throws(() => memberSeen({ friend: NaN }));
});
