import type { RoomActionRequest, RoomCreateRequest, RoomJoinRequest, RoomSnapshot } from '../shared/guandan-room.ts';
import { parseRoomSnapshot } from './guandan-room-parse.ts';
import { retryOperation } from '../shared/retry.ts';

export type RoomInvite = { roomId: string; inviteToken: string };
export type RoomIdentity = { roomId: string; seatToken: string };
const INVITE_KEY = 'cheers-guandan-invite-v1';
const ACTIVE_KEY = 'cheers-guandan-room-active-v1';
const TAB_ACTIVE_KEY = 'cheers-guandan-room-tab-v1';
const TOKEN_PREFIX = 'cheers-guandan-room-seat-v1:';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;

export function parseRoomInvite(link: string, origin: string): RoomInvite {
  const url = new URL(link, origin);
  if (url.origin !== origin) throw new Error('邀请链接必须来自当前网站，请直接打开原邀请链接。');
  const params = new URLSearchParams(url.hash.slice(1));
  const roomId = params.get('guandan-room'), inviteToken = params.get('invite');
  if (!roomId || !UUID.test(roomId) || !inviteToken || !TOKEN.test(inviteToken)) throw new Error('掼蛋邀请链接不完整或无效，请让房主重新分享。');
  return { roomId, inviteToken };
}
export function inviteUrl(invite: RoomInvite, origin: string): string {
  return `${origin}/?tool=guandan-room#${new URLSearchParams({ 'guandan-room': invite.roomId, invite: invite.inviteToken })}`;
}
export function hasRoomInvitation(): boolean {
  return new URLSearchParams(window.location.hash.slice(1)).has('guandan-room');
}
export function readRoomInvite(): RoomInvite | null {
  if (hasRoomInvitation()) {
    const invite = parseRoomInvite(window.location.href, window.location.origin);
    sessionStorage.setItem(INVITE_KEY, inviteUrl(invite, window.location.origin));
    // 先保存加入草稿，再移除地址栏凭证。 Save the join draft before removing the fragment.
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
    return invite;
  }
  const saved = sessionStorage.getItem(INVITE_KEY);
  return saved === null ? null : parseRoomInvite(saved, window.location.origin);
}
export function storeRoomInvite(invite: RoomInvite): void { sessionStorage.setItem(INVITE_KEY, inviteUrl(invite, window.location.origin)); }
export function clearRoomInvite(): void { sessionStorage.removeItem(INVITE_KEY); }
// 空串是本标签主动离开的标记，不能再次套用其他标签的最近房间。 Empty means this tab left explicitly; do not reuse another tab's last room.
export function activeRoomId(tabRoomId: string | null, lastRoomId: string | null): string | null {
  const id = tabRoomId ?? lastRoomId;
  return id === '' ? null : id;
}
export function readRoomIdentity(roomId: string | null): RoomIdentity | null {
  const id = roomId ?? activeRoomId(sessionStorage.getItem(TAB_ACTIVE_KEY), localStorage.getItem(ACTIVE_KEY));
  if (id === null) return null;
  if (!UUID.test(id)) throw new Error('本机保存的房间标识损坏，无法恢复身份。');
  const seatToken = localStorage.getItem(TOKEN_PREFIX + id);
  if (seatToken === null) return null;
  if (!TOKEN.test(seatToken)) throw new Error('本机保存的玩家凭证损坏，无法恢复身份。');
  return { roomId: id, seatToken };
}
export function prepareRoomIdentity(roomId: string): RoomIdentity {
  const existing = readRoomIdentity(roomId);
  if (existing) { activateRoomIdentity(existing); return existing; }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const seatToken = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(TOKEN_PREFIX + roomId, seatToken);
  activateRoomIdentity({ roomId, seatToken });
  return { roomId, seatToken };
}
export function activateRoomIdentity(identity: RoomIdentity): void { sessionStorage.setItem(TAB_ACTIVE_KEY, identity.roomId); localStorage.setItem(ACTIVE_KEY, identity.roomId); }
export function forgetActiveRoom(): void { sessionStorage.setItem(TAB_ACTIVE_KEY, ''); clearRoomInvite(); }

export function roomHttpError(message: string, status: number, code: string): Error & { status: number; code: string } { return Object.assign(new Error(message), { name: 'GuandanRoomHttpError', status, code }); }
export function retryableRoomError(error: Error): boolean { return (!('code' in error) || error.code !== 'STORAGE') && [0, 408, 429, 502, 503, 504].includes(roomErrorStatus(error) ?? -1); }
export function roomErrorStatus(error: Error): number | null { return 'status' in error && typeof error.status === 'number' ? error.status : null; }
export async function callRoom(path: string, identity: RoomIdentity | null, invite: RoomInvite | null, body: RoomActionRequest | RoomCreateRequest | RoomJoinRequest | null): Promise<RoomSnapshot> {
  const requestId = body === null ? null : crypto.randomUUID();
  // 同一次写入的重试必须复用请求ID，日志不包含凭证。 Retry a write with the same request ID, never log credentials.
  return retryOperation('guandan room API', async () => {
    let response: Response;
    try {
      response = await fetch(path, { method: body === null ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000), headers: {
        ...(identity ? { Authorization: `Bearer ${identity.seatToken}` } : {}), ...(invite ? { 'X-Room-Invite': invite.inviteToken } : {}), ...(requestId ? { 'X-Request-ID': requestId, 'Content-Type': 'application/json' } : {}),
      }, ...(body === null ? {} : { body: JSON.stringify(body) }) });
    } catch (cause) { throw roomHttpError(`无法连接组局服务，请检查网络后重连。${cause instanceof Error ? cause.name : '网络错误'}`, 0, 'NETWORK'); }
    const text = await response.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw roomHttpError(`组局服务响应不是有效 JSON（HTTP ${response.status}）。`, response.status, 'RESPONSE'); }
    if (!response.ok) {
      const error = typeof data === 'object' && data !== null && 'error' in data ? data.error : null;
      const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : '服务返回无效错误信息';
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'HTTP';
      throw roomHttpError(`组局请求失败（HTTP ${response.status}）：${message}`, response.status, code);
    }
    return parseRoomSnapshot(data);
  }, retryableRoomError);
}
