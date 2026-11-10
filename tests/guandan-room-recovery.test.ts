import test from 'node:test';
import assert from 'node:assert/strict';
import { activeRoomId, retryableRoomError, roomHttpError } from '../src/client/guandan-room.ts';

test('房间恢复优先当前标签，其他标签最近房间更新不会覆盖当前标签或主动退出标记', () => {
  const roomA = crypto.randomUUID(), roomB = crypto.randomUUID();
  assert.equal(activeRoomId(roomA, roomB), roomA);
  assert.equal(activeRoomId(roomB, roomA), roomB);
  assert.equal(activeRoomId('', roomB), null);
  assert.equal(activeRoomId(null, roomA), roomA);
  assert.equal(activeRoomId(null, null), null);
});

test('客户端不叠加存储层重试，网络与网关失败仍可重试', () => {
  assert.equal(retryableRoomError(roomHttpError('存储暂时不可用', 503, 'STORAGE')), false);
  assert.equal(retryableRoomError(roomHttpError('网络失败', 0, 'NETWORK')), true);
  assert.equal(retryableRoomError(roomHttpError('网关失败', 503, 'HTTP')), true);
  assert.equal(retryableRoomError(roomHttpError('操作冲突', 409, 'CONFLICT')), false);
});
