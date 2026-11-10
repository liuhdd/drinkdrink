import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { applyMigrations, sqliteAdapter } from '../scripts/sqlite.ts';
import worker from '../src/server/worker.ts';
import { cleanupGuandanRooms } from '../src/server/guandan-rooms.ts';
import { ROOM_TTL_MS, type RoomSnapshot } from '../src/shared/guandan-room.ts';
import { parseRoomSnapshot } from '../src/client/guandan-room-parse.ts';

const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function setup(t: TestContext) {
  const db = new DatabaseSync(':memory:'); applyMigrations(db);
  const env = { DB: sqliteAdapter(db), ASSETS: { fetch: () => new Response('asset') } };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    const response = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method ?? 'GET', headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); });
  const request = (path: string, credential: string | null, invite: string | null, data: object | null, requestId: string) => fetch(`${origin}/api/guandan/rooms${path}`, { method: data ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Request-ID': requestId, ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(invite ? { 'X-Room-Invite': invite } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { db, env, request, origin };
}
async function read(response: Response): Promise<RoomSnapshot> { assert.equal(response.status, 200, await response.clone().text()); assert.match(response.headers.get('cache-control')!, /no-store/); return parseRoomSnapshot(await response.json()); }

test('真实HTTP四设备组局：座位隔离、并发幂等、重连、完整牌局和下一局', async t => {
  const { request } = await setup(t), keys = [token(), token(), token(), token()], roomId = crypto.randomUUID(), createId = crypto.randomUUID();
  const create = { roomId, name: '房主' };
  let room = await read(await request('', keys[0]!, null, create, createId));
  assert.deepEqual(await read(await request('', keys[0]!, null, create, createId)), room);
  const invite = room.inviteToken!;
  const preview = await read(await request(`/${roomId}`, null, invite, null, crypto.randomUUID()));
  assert.equal(preview.selfSeat, null); assert.equal(preview.inviteToken, null); assert.equal(preview.game, null);
  for (let seat = 1; seat < 4; seat++) room = await read(await request(`/${roomId}/join`, keys[seat]!, invite, { version: room.version, name: `玩家${seat}` }, crypto.randomUUID()));
  assert.equal((await request(`/${roomId}/join`, token(), invite, { version: room.version, name: '第五人' }, crypto.randomUUID())).status, 409);
  assert.equal((await request(`/${roomId}/action`, keys[1]!, null, { version: room.version, type: 'start' }, crypto.randomUUID())).status, 403);
  assert.equal((await request(`/${roomId}/action`, token(), invite, { version: room.version, type: 'close' }, crypto.randomUUID())).status, 403);
  const start = { version: room.version, type: 'start' }, startId = crypto.randomUUID();
  const concurrent = await Promise.all([request(`/${roomId}/action`, keys[0]!, null, start, startId), request(`/${roomId}/action`, keys[0]!, null, start, startId)]);
  room = await read(concurrent[0]!); assert.deepEqual(await read(concurrent[1]!), room);
  assert.equal((await request(`/${roomId}/action`, keys[0]!, null, { ...start, type: 'close' }, startId)).status, 400);
  assert.equal((await request(`/${roomId}/action`, keys[0]!, null, start, crypto.randomUUID())).status, 409);
  assert.equal((await request(`/${roomId}/join`, token(), invite, { version: room.version, name: '迟到' }, crypto.randomUUID())).status, 409);
  const snapshots = await Promise.all(keys.map(key => request(`/${roomId}`, key, null, null, crypto.randomUUID()).then(read)));
  assert.equal(new Set(snapshots.flatMap(item => item.game!.hand.map(card => card.id))).size, 108);
  for (const item of snapshots) { assert.equal(item.game!.hand.length, 27); assert.equal(Object.hasOwn(item.game!, 'hands'), false); for (const key of keys) assert.equal(JSON.stringify(item).includes(key), false); }
  assert.equal((await request(`/${roomId}`, token(), null, null, crypto.randomUUID())).status, 401);
  assert.equal((await read(await request(`/${roomId}`, null, invite, null, crypto.randomUUID()))).game, null);
  for (let step = 0; step < 1000 && room.game!.status === 'playing'; step++) {
    const seat = room.game!.turn;
    room = await read(await request(`/${roomId}`, keys[seat]!, null, null, crypto.randomUUID()));
    const ids = room.game!.hints[0];
    room = await read(await request(`/${roomId}/action`, keys[seat]!, null, ids ? { version: room.version, type: 'play', cardIds: ids } : { version: room.version, type: 'pass' }, crypto.randomUUID()));
  }
  assert.equal(room.game!.status, 'round-over');
  room = await read(await request(`/${roomId}/action`, keys[0]!, null, { version: room.version, type: 'next' }, crypto.randomUUID())); assert.equal(room.game!.round, 2);
  assert.deepEqual(await read(await request(`/${roomId}`, keys[0]!, null, null, crypto.randomUUID())), room);
  const close = { version: room.version, type: 'close' }, closeId = crypto.randomUUID();
  room = await read(await request(`/${roomId}/action`, keys[0]!, null, close, closeId)); assert.equal(room.status, 'closed'); assert.equal(room.game, null);
  assert.deepEqual(await read(await request(`/${roomId}/action`, keys[0]!, null, close, closeId)), room);
  assert.equal((await request(`/${roomId}/action`, keys[0]!, null, close, crypto.randomUUID())).status, 410);
  assert.equal((await request(`/${roomId}/action`, keys[0]!, null, { version: room.version, type: 'next' }, crypto.randomUUID())).status, 410);
  assert.equal((await read(await request(`/${roomId}`, keys[1]!, null, null, crypto.randomUUID()))).status, 'closed');
});

test('真实HTTP两真人电脑推进、只读轮询、过期清理与损坏记录不泄密', async t => {
  const { db, env, request } = await setup(t), keys = [token(), token()], roomId = crypto.randomUUID();
  let room = await read(await request('', keys[0]!, null, { roomId, name: '甲' }, crypto.randomUUID()));
  const invite = room.inviteToken!;
  room = await read(await request(`/${roomId}/join`, keys[1]!, invite, { version: room.version, name: '乙' }, crypto.randomUUID()));
  room = await read(await request(`/${roomId}/action`, keys[0]!, null, { version: room.version, type: 'start' }, crypto.randomUUID()));
  for (let step = 0; step < 1000 && room.game!.status === 'playing'; step++) {
    const seat = room.game!.turn; assert.ok(seat < 2);
    room = await read(await request(`/${roomId}`, keys[seat]!, null, null, crypto.randomUUID()));
    assert.deepEqual(await read(await request(`/${roomId}`, keys[seat]!, null, null, crypto.randomUUID())), room);
    const ids = room.game!.hints[0]; room = await read(await request(`/${roomId}/action`, keys[seat]!, null, ids ? { version: room.version, type: 'play', cardIds: ids } : { version: room.version, type: 'pass' }, crypto.randomUUID()));
  }
  assert.equal(room.game!.status, 'round-over');
  db.prepare("UPDATE guandan_rooms SET data = json_set(data, '$.expiresAt', ?), expires_at = ? WHERE room_id = ?").run(Date.now() - 1, Date.now() - 1, roomId);
  assert.equal((await read(await request(`/${roomId}`, keys[0]!, null, null, crypto.randomUUID()))).status, 'expired');
  assert.equal((await request(`/${roomId}/action`, keys[0]!, null, { version: room.version, type: 'next' }, crypto.randomUUID())).status, 410);
  db.prepare("UPDATE guandan_rooms SET data = ? WHERE room_id = ?").run(`secret-${keys[1]}`, roomId);
  const broken = await request(`/${roomId}`, keys[0]!, null, null, crypto.randomUUID()); assert.equal(broken.status, 503); const text = await broken.text(); assert.equal(text.includes(keys[1]!), false); assert.equal(text.includes('secret-'), false);
  await cleanupGuandanRooms(env.DB, Date.now() + ROOM_TTL_MS * 2);
  assert.equal((await request(`/${roomId}`, keys[0]!, null, null, crypto.randomUUID())).status, 404);
});


test('真实HTTP拒绝跨源、超限与伪造座位，并发不同操作只写入一次且不延长有效期', async t => {
  const { request, origin } = await setup(t), key = token(), guest = token(), roomId = crypto.randomUUID();
  let room = await read(await request('', key, null, { roomId, name: '甲' }, crypto.randomUUID()));
  const expiry = room.expiresAt;
  assert.equal((await request(`/${roomId}/join`, guest, room.inviteToken, { version: room.version, name: '甲' }, crypto.randomUUID())).status, 409);
  room = await read(await request(`/${roomId}/join`, guest, room.inviteToken, { version: room.version, name: '乙', seat: 0, host: true }, crypto.randomUUID()));
  assert.equal(room.selfSeat, 1);
  const url = `${origin}/api/guandan/rooms/${roomId}/action`;
  const headers = { Authorization: `Bearer ${key}`, 'X-Request-ID': crypto.randomUUID(), 'Content-Type': 'application/json' };
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://foreign.test' }, body: JSON.stringify({ version: room.version, type: 'start' }) })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: origin }, body: JSON.stringify({ padding: 'x'.repeat(4096) }) })).status, 413);
  const responses = await Promise.all([request(`/${roomId}/action`, key, null, { version: room.version, type: 'start' }, crypto.randomUUID()), request(`/${roomId}/action`, key, null, { version: room.version, type: 'start' }, crypto.randomUUID())]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const active = await read(await request(`/${roomId}`, key, null, null, crypto.randomUUID()));
  assert.equal(active.version, room.version + 1); assert.equal(active.expiresAt, expiry);
  assert.equal((await request(`/${roomId}/action`, guest, null, { version: active.version, type: 'play', cardIds: [active.game!.hand[0]!.id], seat: 0 }, crypto.randomUUID())).status, 400);
  assert.deepEqual(await read(await request(`/${roomId}`, key, null, null, crypto.randomUUID())), active);
});


test('真实HTTP已成功写入在到期后重放仅返回过期快照，不续期或再次写入', async t => {
  const { request, db } = await setup(t), host = token(), guest = token(), roomId = crypto.randomUUID();
  let room = await read(await request('', host, null, { roomId, name: '甲' }, crypto.randomUUID()));
  const join = { version: room.version, name: '乙' }, joinId = crypto.randomUUID();
  room = await read(await request(`/${roomId}/join`, guest, room.inviteToken, join, joinId));
  const expiresAt = Date.now() - 1;
  db.prepare("UPDATE guandan_rooms SET data = json_set(data, '$.expiresAt', ?), expires_at = ? WHERE room_id = ?").run(expiresAt, expiresAt, roomId);
  const expired = await read(await request(`/${roomId}/join`, guest, room.inviteToken, join, joinId));
  assert.equal(expired.status, 'expired'); assert.equal(expired.version, room.version); assert.equal(expired.expiresAt, expiresAt); assert.equal(expired.game, null);
  assert.equal((await request(`/${roomId}/join`, guest, room.inviteToken, join, crypto.randomUUID())).status, 410);
  assert.deepEqual(await read(await request(`/${roomId}`, guest, null, null, crypto.randomUUID())), expired);
});


test('真实SQLite故障返回脱敏STORAGE码，区别内部错误以避免客户端叠加重试', async t => {
  const { request, db } = await setup(t), key = token(), roomId = crypto.randomUUID();
  await read(await request('', key, null, { roomId, name: '甲' }, crypto.randomUUID()));
  db.exec('DROP TABLE guandan_rooms');
  const response = await request(`/${roomId}`, key, null, null, crypto.randomUUID());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: 'STORAGE', message: '房间存储暂时不可用，请稍后重试' } });
});
