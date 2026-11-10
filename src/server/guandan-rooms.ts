import { roomDatabase } from './guandan-room-database.ts';
import { chooseAiAction, createDeck, createGame, legalPlays, nextRound, parseGuandanGame, passTurn, playCards, shuffleDeck, type Game } from '../shared/guandan.ts';
import { ROOM_TTL_MS, roomActionInput, roomCreateInput, roomJoinInput, roomTokenInput, type RoomSnapshot, type RoomActionRequest } from '../shared/guandan-room.ts';
import { arrayInput, integerInput, required, textInput, uuidInput } from '../shared/validation.ts';
import { isProblem, parseJson } from '../shared/errors.ts';
import type { ExternalValue, LedgerDatabase } from '../shared/types.ts';

type Member = { name: string; hash: string; requestId: string; requestHash: string };
type StoredRoom = { roomId: string; version: number; expiresAt: number; status: 'waiting' | 'playing' | 'closed'; invite: string; members: Member[]; game: Game | null; createHash: string; createId: string };
function fail(code: string, message: string, status: number): never { throw Object.assign(new Error(message), { name: 'RoomError', code, status }); }
function json(value: object, status: number): Response { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, X-Room-Invite' } }); }
async function digest(value: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function randomToken(): string { return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function deck() { return shuffleDeck(createDeck(), () => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000); }
function stored(value: ExternalValue): StoredRoom {
  const data = parseJson(textInput(required(value, 'data', 'row'), 'data', 200000), 'read room');
  const status = required(data, 'status', 'room');
  if (status !== 'waiting' && status !== 'playing' && status !== 'closed') throw new Error('Invalid stored room status');
  const rawGame = required(data, 'game', 'room');
  const members = arrayInput(required(data, 'members', 'room'), 'members').map(item => ({ name: textInput(required(item, 'name', 'member'), 'name', 12), hash: roomTokenInput(required(item, 'hash', 'member')), requestId: uuidInput(required(item, 'requestId', 'member'), 'requestId'), requestHash: roomTokenInput(required(item, 'requestHash', 'member')) }));
  if (members.length < 1 || members.length > 4 || new Set(members.map(member => member.hash)).size !== members.length) throw new Error('Invalid stored members');
  return { roomId: uuidInput(required(data, 'roomId', 'room'), 'roomId'), version: integerInput(required(value, 'version', 'row'), 'version', 1, Number.MAX_SAFE_INTEGER), expiresAt: integerInput(required(data, 'expiresAt', 'room'), 'expiresAt', 0, Number.MAX_SAFE_INTEGER), status, invite: roomTokenInput(required(data, 'invite', 'room')), members, game: rawGame === null ? null : parseGuandanGame(rawGame), createHash: roomTokenInput(required(data, 'createHash', 'room')), createId: uuidInput(required(data, 'createId', 'room'), 'createId') };
}
async function read(db: LedgerDatabase, id: string): Promise<StoredRoom | null> { const value = await db.prepare('SELECT data, version FROM guandan_rooms WHERE room_id = ?').bind(id).first(); if (value === null) return null; try { return stored(value); } catch (cause) { throw new Error('Stored room is invalid', { cause }); } }
function snapshot(room: StoredRoom, seat: number, now: number): RoomSnapshot {
  const status = room.expiresAt <= now ? 'expired' : room.status;
  const game = room.game;
  let visible: RoomSnapshot['game'] = null;
  if (seat >= 0 && game && status !== 'expired' && status !== 'closed') {
    const { hands, ...publicGame } = game;
    visible = { ...publicGame, hand: hands[seat]!, handCounts: hands.map(hand => hand.length), hints: game.status === 'playing' && game.turn === seat ? legalPlays(game, seat).map(cards => cards.map(card => card.id)) : [] };
  }
  return { roomId: room.roomId, version: room.version, status, expiresAt: room.expiresAt, selfSeat: seat < 0 ? null : seat, hostSeat: 0, seats: [0, 1, 2, 3].map(index => ({ seat: index, name: room.members[index]?.name ?? (room.game ? `电脑${index + 1}` : '空位'), kind: room.members[index] ? 'human' : room.game ? 'bot' : 'empty' })), inviteToken: seat < 0 ? null : room.invite, game: visible };
}
function advance(game: Game, humans: number): Game {
  let next = game;
  for (let step = 0; step < 500 && next.status === 'playing' && next.turn >= humans; step++) {
    const action = chooseAiAction(next);
    next = action.type === 'pass' ? passTurn(next, next.turn) : playCards(next, next.turn, action.cardIds);
  }
  if (next.status === 'playing' && next.turn >= humans) throw new Error('Robot action bound exceeded');
  return next;
}
function act(room: StoredRoom, seat: number, action: RoomActionRequest): StoredRoom {
  if (['start', 'next', 'close'].includes(action.type) && seat !== 0) fail('FORBIDDEN', '只有房主可以操作', 403);
  if (action.type === 'close') return { ...room, status: 'closed', game: null };
  if (action.type === 'start') {
    if (room.status !== 'waiting' || room.members.length < 2) fail('STATE', '至少两位真人入座后才能开局', 400);
    return { ...room, status: 'playing', game: advance(createGame({ id: crypto.randomUUID(), deck: deck(), firstPlayer: 0 }), room.members.length) };
  }
  if (!room.game || room.status !== 'playing') fail('STATE', '请先等待房主开局', 400);
  const game = action.type === 'next' ? (room.game.status === 'match-over' ? createGame({ id: crypto.randomUUID(), deck: deck(), firstPlayer: 0 }) : nextRound(room.game, { id: crypto.randomUUID(), deck: deck() })) : action.type === 'pass' ? passTurn(room.game, seat) : action.type === 'play' ? playCards(room.game, seat, action.cardIds) : fail('STATE', '无效房间操作', 400);
  return { ...room, game: advance(game, room.members.length) };
}
async function body(request: Request): Promise<ExternalValue> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail('VALIDATION', '请使用 application/json', 400);
  const reader = request.body?.getReader();
  if (!reader) fail('VALIDATION', '缺少请求内容', 400);
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 4096) { await reader.cancel(); fail('VALIDATION', '请求不得超过4096字节', 413); } chunks.push(value); }
  const buffer = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return parseJson(new TextDecoder().decode(buffer), 'room request');
}
export async function cleanupGuandanRooms(database: LedgerDatabase, now: number): Promise<void> {
  const db = roomDatabase(database);
  // 保留一天过期提示，之后彻底删除独立牌局。 Keep expiry visible for one day, then delete independent rooms.
  await db.prepare('DELETE FROM guandan_rooms WHERE expires_at < ?').bind(now - ROOM_TTL_MS).run();
}
export async function guandanRoomsApi(request: Request, database: LedgerDatabase): Promise<Response> {
  const db = roomDatabase(database);
  try {
    const url = new URL(request.url), route = /^\/api\/guandan\/rooms(?:\/([a-f0-9-]+)(?:\/(join|action))?)?$/i.exec(url.pathname);
    if (!route) fail('NOT_FOUND', '房间接口不存在', 404);
    const id = route[1]?.toLowerCase() ?? null, operation = route[2]?.toLowerCase() ?? null;
    if ((id === null || operation !== null) ? request.method !== 'POST' : request.method !== 'GET') fail('METHOD', '不支持此请求方法', 405);
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.method === 'POST' && request.headers.get('origin') !== url.origin) || (request.headers.has('origin') && request.headers.get('origin') !== url.origin)) fail('ORIGIN', '请在本站使用组局', 403);
    const authorization = request.headers.get('authorization');
    const token = authorization === null ? null : roomTokenInput(authorization.startsWith('Bearer ') ? authorization.slice(7) : null);
    const hash = token === null ? null : await digest(token);
    const now = Date.now();
    if (id === null) {
      if (hash === null) fail('UNAUTHORIZED', '缺少座位凭证', 401);
      const requestId = uuidInput(request.headers.get('x-request-id'), 'X-Request-ID'), input = roomCreateInput(await body(request));
      const requestHash = await digest(JSON.stringify(input));
      const existing = await read(db, input.roomId);
      if (existing) {
        if (existing.members[0]!.hash !== hash) fail('CONFLICT', '房间标识已占用', 409);
        if (existing.createId !== requestId || existing.createHash !== requestHash) fail('CONFLICT', '创建请求已变更', 409);
        return json(snapshot(existing, 0, now), 200);
      }
      const room: StoredRoom = { roomId: input.roomId, version: 1, status: 'waiting', expiresAt: now + ROOM_TTL_MS, invite: randomToken(), members: [{ name: input.name, hash, requestId, requestHash }], game: null, createId: requestId, createHash: requestHash };
      const result = await db.prepare('INSERT INTO guandan_rooms (room_id, data, version, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(room_id) DO NOTHING').bind(room.roomId, JSON.stringify(room), room.expiresAt).run();
      if (!result.meta.changes) { const latest = await read(db, room.roomId); if (latest && latest.members[0]!.hash === hash && latest.createId === requestId && latest.createHash === requestHash) return json(snapshot(latest, 0, now), 200); fail('CONFLICT', '房间标识已占用', 409); }
      return json(snapshot(room, 0, now), 200);
    }
    uuidInput(id, 'roomId');
    const room = await read(db, id);
    if (!room) fail('NOT_FOUND', '房间不存在或已清理', 404);
    const seat = room.members.findIndex(member => member.hash === hash);
    const invited = request.headers.get('x-room-invite') === room.invite;
    if (seat < 0 && !invited) fail('UNAUTHORIZED', '邀请或座位凭证无效', 401);
    if (request.method === 'GET') return json(snapshot(room, seat, now), 200);
    if (hash === null) fail('UNAUTHORIZED', '缺少座位凭证', 401);
    if (operation === 'action' && seat < 0) fail('FORBIDDEN', '邀请链接不能操作座位', 403);
    const requestId = uuidInput(request.headers.get('x-request-id'), 'X-Request-ID');
    const raw = await body(request), input = operation === 'join' ? roomJoinInput(raw) : roomActionInput(raw);
    const requestHash = await digest(JSON.stringify({ operation, input }));
    const member = room.members[seat];
    if (member?.requestId === requestId) { if (member.requestHash !== requestHash) fail('REQUEST_REUSED', '请求标识已用于不同操作', 400); return json(snapshot(room, seat, now), 200); }
    if (room.expiresAt <= now) fail('EXPIRED', '房间已过期，请重新组局', 410);
    if (room.status === 'closed') fail('CLOSED', '房主已关闭房间', 410);
    if (operation === 'join' && seat >= 0) return json(snapshot(room, seat, now), 200);
    if (input.version !== room.version) fail('CONFLICT', '房间已更新，请刷新后重试', 409);
    let updated: StoredRoom, nextSeat = seat;
    if (operation === 'join') {
      if (room.status !== 'waiting') fail('STARTED', '本局已开局，不能再加入', 409);
      if (room.members.length >= 4) fail('FULL', '房间已满', 409);
      const join = roomJoinInput(raw);
      if (room.members.some(entry => entry.name === join.name)) fail('NAME_TAKEN', '此昵称已有人使用，请换一个', 409);
      nextSeat = room.members.length;
      updated = { ...room, members: [...room.members, { name: join.name, hash, requestId, requestHash }] };
    } else {
      updated = act(room, seat, roomActionInput(raw));
      updated = { ...updated, members: updated.members.map((entry, index) => index === seat ? { ...entry, requestId, requestHash } : entry) };
    }
    updated = { ...updated, version: room.version + 1 };
    const result = await db.prepare('UPDATE guandan_rooms SET data = ?, version = version + 1 WHERE room_id = ? AND version = ?').bind(JSON.stringify(updated), id, room.version).run();
    if (!result.meta.changes) { const latest = await read(db, id); const latestSeat = latest?.members.findIndex(entry => entry.hash === hash) ?? -1; const entry = latest?.members[latestSeat]; if (latest && entry?.requestId === requestId && entry.requestHash === requestHash) return json(snapshot(latest, latestSeat, now), 200); fail('CONFLICT', '房间已更新，请刷新后重试', 409); }
    return json(snapshot(updated, nextSeat, now), 200);
  } catch (error) {
    // 错误不可包含数据库、手牌、凭证或请求正文。 Never expose storage, hands, credentials or request bodies in errors.
    if (error instanceof Error && error.name === 'RoomStorageError') {
      console.error({ operation: 'guandan rooms', code: 'STORAGE' });
      return json({ error: { code: 'STORAGE', message: '房间存储暂时不可用，请稍后重试' } }, 503);
    }
    if (error instanceof Error && error.name === 'RoomError' && 'code' in error && 'status' in error && typeof error.code === 'string' && typeof error.status === 'number') return json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof Error && (isProblem(error) && error.code === 'VALIDATION' || error.name === 'SyntaxError')) return json({ error: { code: 'VALIDATION', message: '请求格式无效，请刷新后重试' } }, 400);
    if (error instanceof Error && error.name === 'GuandanRuleError') return json({ error: { code: 'RULE', message: error.message } }, 400);
    console.error({ operation: 'guandan rooms', code: 'INTERNAL' });
    return json({ error: { code: 'INTERNAL', message: '房间暂时无法读取或保存，请稍后重试' } }, 503);
  }
}
