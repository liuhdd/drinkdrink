import type { Card, Game } from './guandan.ts';
import type { ExternalValue } from './types.ts';
import { arrayInput, integerInput, required, textInput, uuidInput, invalid } from './validation.ts';

export type RoomGame = Omit<Game, 'hands'> & { hand: Card[]; handCounts: number[]; hints: string[][] };
export type RoomSeat = { seat: number; name: string; kind: 'human' | 'bot' | 'empty' };
export type RoomSnapshot = {
  roomId: string; version: number; status: 'waiting' | 'playing' | 'closed' | 'expired';
  expiresAt: number; selfSeat: number | null; hostSeat: number; seats: RoomSeat[];
  inviteToken: string | null; game: RoomGame | null;
};
export type RoomCreateRequest = { roomId: string; name: string };
export type RoomJoinRequest = { version: number; name: string };
export type RoomActionRequest = { version: number } & ({ type: 'start' | 'next' | 'close' | 'pass' } | { type: 'play'; cardIds: string[] });
export type RoomError = { error: { code: string; message: string } };
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export function roomTokenInput(value: ExternalValue): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('token', '64 位随机十六进制凭证', null);
  return value;
}
export function roomCreateInput(value: ExternalValue): RoomCreateRequest {
  return { roomId: uuidInput(required(value, 'roomId', 'request'), 'roomId').toLowerCase(), name: textInput(required(value, 'name', 'request'), 'name', 12).trim() };
}
export function roomJoinInput(value: ExternalValue): RoomJoinRequest {
  return { version: integerInput(required(value, 'version', 'request'), 'version', 1, Number.MAX_SAFE_INTEGER), name: textInput(required(value, 'name', 'request'), 'name', 12).trim() };
}
export function roomActionInput(value: ExternalValue): RoomActionRequest {
  const version = integerInput(required(value, 'version', 'request'), 'version', 1, Number.MAX_SAFE_INTEGER);
  const type = required(value, 'type', 'request');
  if (type === 'start' || type === 'next' || type === 'close' || type === 'pass') return { version, type };
  if (type !== 'play') invalid('type', '房间操作', null);
  const cardIds = arrayInput(required(value, 'cardIds', 'request'), 'cardIds').map(id => textInput(id, 'cardId', 40));
  if (cardIds.length < 1 || cardIds.length > 27 || new Set(cardIds).size !== cardIds.length) invalid('cardIds', '1–27张不重复的牌', null);
  return { version, type, cardIds };
}
