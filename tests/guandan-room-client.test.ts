import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteUrl, parseRoomInvite } from '../src/client/guandan-room.ts';
import { parseRoomSnapshot } from '../src/client/guandan-room-parse.ts';
import { ledgerServer } from './http-fixture.ts';

function token(): string { return [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join(''); }

test('邀请地址只用fragment携带邀请，不包含玩家身份，拒绝跨源与缺失凭证', () => {
  const invite = { roomId: crypto.randomUUID(), inviteToken: token() };
  const link = inviteUrl(invite, 'https://ledger.example');
  const url = new URL(link);
  assert.equal(url.searchParams.has('invite'), false);
  assert.equal(url.searchParams.has('seatToken'), false);
  assert.equal(url.searchParams.get('tool'), 'guandan-room');
  assert.deepEqual(parseRoomInvite(link, 'https://ledger.example'), invite);
  assert.throws(() => parseRoomInvite(link, 'https://different.example'));
  assert.throws(() => parseRoomInvite('https://ledger.example/#guandan-room=' + invite.roomId, 'https://ledger.example'));
  assert.throws(() => parseRoomInvite('javascript:alert(1)', 'https://ledger.example'));
});

test('前端严格解析真实HTTP房间响应，拒绝错误手牌数量和偷渡提示', async t => {
  const { origin } = await ledgerServer(t);
  const roomId = crypto.randomUUID();
  const host = token(), guest = token();
  const call = async (path: string, seatToken: string, invite: string | null, body: object | null) => {
    const response = await fetch(`${origin}/api/guandan/rooms${path}`, { method: body === null ? 'GET' : 'POST', headers: { Origin: origin, Authorization: `Bearer ${seatToken}`, 'Content-Type': 'application/json', 'X-Request-ID': crypto.randomUUID(), ...(invite ? { 'X-Room-Invite': invite } : {}) }, ...(body === null ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, 200, await response.clone().text());
    return parseRoomSnapshot(await response.json());
  };
  let room = await call('', host, null, { roomId, name: '甲' });
  const invite = room.inviteToken;
  room = await call(`/${roomId}/join`, guest, invite, { version: room.version, name: '乙' });
  room = await call(`/${roomId}/action`, host, null, { version: room.version, type: 'start' });
  assert.ok(room.game);
  const hostGame = room.game;
  assert.equal(hostGame.hand.length, 27);
  const guestView = await call(`/${roomId}`, guest, null, null);
  assert.ok(guestView.game);
  assert.equal(guestView.game.hand.some(card => hostGame.hand.some(held => held.id === card.id)), false);
  assert.equal(Object.hasOwn(hostGame, 'hands'), false);
  assert.throws(() => parseRoomSnapshot({ ...room, game: { ...hostGame, handCounts: [26, 27, 27, 27] } }));
  assert.throws(() => parseRoomSnapshot({ ...room, game: { ...hostGame, hints: [[guestView.game!.hand[0]!.id]] } }));
  assert.throws(() => parseRoomSnapshot({ ...room, game: { ...hostGame, hand: [hostGame.hand[0], hostGame.hand[0]] } }));
});
