import { at } from '../shared/values.ts';
import { classifyAll, createDeck } from '../shared/guandan-cards.ts';
import type { Card, Combination, CombinationKind, Suit } from '../shared/guandan-cards.ts';
import type { Play, RoundResult, Team } from '../shared/guandan.ts';
import type { RoomGame, RoomSnapshot } from '../shared/guandan-room.ts';
function invalid(path: string): never {
  const error = new TypeError(`组局响应字段 ${path} 无效，请重新连接`);
  error.name = 'GuandanRoomResponseError';
  throw error;
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(path);
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 4000) invalid(path);
  return value;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path);
  return value;
}
function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  const found = values.find(item => item === value);
  if (found === undefined) invalid(path);
  return found;
}
function team(value: unknown, path: string): Team { const result = integer(value, 0, 1, path); return result === 0 ? 0 : 1; }
function seats(value: unknown, path: string): number[] {
  const result = array(value, path).map((entry, index) => integer(entry, 0, 3, `${path}.${index}`));
  if (new Set(result).size !== result.length) invalid(path);
  return result;
}
function card(value: unknown, path: string): Card {
  const entry = record(value, path);
  const suit = oneOf<Suit>(entry.suit, ['spades', 'hearts', 'clubs', 'diamonds', 'joker'], `${path}.suit`);
  const rank = integer(entry.rank, suit === 'joker' ? 15 : 2, suit === 'joker' ? 16 : 14, `${path}.rank`);
  return { id: text(entry.id, `${path}.id`), rank, suit, deck: team(entry.deck, `${path}.deck`) };
}
function cards(value: unknown, path: string): Card[] { return array(value, path).map((entry, index) => card(entry, `${path}.${index}`)); }
function combination(value: unknown, path: string): Combination {
  const entry = record(value, path);
  return {
    kind: oneOf<CombinationKind>(entry.kind, ['single', 'pair', 'triple', 'full-house', 'straight', 'consecutive-pairs', 'consecutive-triples', 'bomb', 'straight-flush', 'joker-bomb'], `${path}.kind`),
    size: integer(entry.size, 1, 10, `${path}.size`), power: integer(entry.power, 2, 100, `${path}.power`),
  };
}
function play(value: unknown, level: number, path: string): Play | null {
  if (value === null) return null;
  const entry = record(value, path);
  const parsed: Play = { player: integer(entry.player, 0, 3, `${path}.player`), cards: cards(entry.cards, `${path}.cards`), combination: combination(entry.combination, `${path}.combination`) };
  if (!classifyAll(parsed.cards, level).some(combo => combo.kind === parsed.combination.kind && combo.size === parsed.combination.size && combo.power === parsed.combination.power)) invalid(`${path}.combination`);
  return parsed;
}
function roundResult(value: unknown): RoundResult | null {
  if (value === null) return null;
  const entry = record(value, 'result');
  if (typeof entry.matchWon !== 'boolean') invalid('result.matchWon');
  return { winner: team(entry.winner, 'result.winner'), order: seats(entry.order, 'result.order'), upgrade: integer(entry.upgrade, 1, 3, 'result.upgrade'), previousLevel: integer(entry.previousLevel, 2, 14, 'result.previousLevel'), nextLevel: integer(entry.nextLevel, 2, 14, 'result.nextLevel'), matchWon: entry.matchWon };
}
function parseGame(input: unknown): RoomGame {
  const value = record(input, 'game');
  const level = integer(value.level, 2, 14, 'level');
  const levels = array(value.levels, 'levels');
  if (levels.length !== 2) invalid('levels');
  const game: RoomGame = {
    id: text(value.id, 'id'), round: integer(value.round, 1, 100000, 'round'), level,
    levels: [integer(at(levels, 0), 2, 14, 'levels.0'), integer(at(levels, 1), 2, 14, 'levels.1')], levelTeam: team(value.levelTeam, 'levelTeam'),
    hand: cards(value.hand, 'hand'), handCounts: array(value.handCounts, 'handCounts').map(count => integer(count, 0, 27, 'handCounts')), hints: array(value.hints, 'hints').map(hint => array(hint, 'hint').map(id => text(id, 'hint.cardId'))),
    turn: integer(value.turn, 0, 3, 'turn'), table: play(value.table, level, 'table'), lastPlay: play(value.lastPlay, level, 'lastPlay'), passed: seats(value.passed, 'passed'), playedCards: cards(value.playedCards, 'playedCards'), finishOrder: seats(value.finishOrder, 'finishOrder'),
    status: oneOf(value.status, ['playing', 'round-over', 'match-over'], 'status'), result: roundResult(value.result),
    tributeLog: array(value.tributeLog, 'tributeLog').map((entry, index) => text(entry, `tributeLog.${index}`)), lastAction: text(value.lastAction, 'lastAction'),
  };
  if (game.handCounts.length !== 4 || game.hand.length > 27) invalid('handCounts');
  const canonical = createDeck();
  for (const card of [...game.hand, ...game.playedCards]) if (!canonical.some(item => item.id === card.id && item.rank === card.rank && item.deck === card.deck && item.suit === card.suit)) invalid('cards');
  if (new Set([...game.hand, ...game.playedCards].map(card => card.id)).size !== game.hand.length + game.playedCards.length) invalid('duplicate cards');
  if (game.hints.some(hint => new Set(hint).size !== hint.length || !hint.length || hint.some(id => !game.hand.some(card => card.id === id)))) invalid('hints');
  return game;
}
export function parseRoomSnapshot(input: unknown): RoomSnapshot {
  const value = record(input, 'room');
  const roomId = text(value.roomId, 'roomId');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(roomId)) invalid('roomId');
  const inviteToken = value.inviteToken === null ? null : text(value.inviteToken, 'inviteToken');
  if (inviteToken !== null && !/^[a-f0-9]{64}$/.test(inviteToken)) invalid('inviteToken');
  const snapshot: RoomSnapshot = {
    roomId, version: integer(value.version, 1, Number.MAX_SAFE_INTEGER, 'version'),
    status: oneOf(value.status, ['waiting', 'playing', 'closed', 'expired'], 'status'),
    expiresAt: integer(value.expiresAt, 1, Number.MAX_SAFE_INTEGER, 'expiresAt'),
    selfSeat: value.selfSeat === null ? null : integer(value.selfSeat, 0, 3, 'selfSeat'),
    hostSeat: integer(value.hostSeat, 0, 3, 'hostSeat'), inviteToken,
    seats: array(value.seats, 'seats').map(item => {
      const seat = record(item, 'seat');
      return { seat: integer(seat.seat, 0, 3, 'seat'), name: text(seat.name, 'seat.name'), kind: oneOf(seat.kind, ['human', 'bot', 'empty'], 'seat.kind') };
    }),
    game: value.game === null ? null : parseGame(value.game),
  };
  if (snapshot.seats.length !== 4 || new Set(snapshot.seats.map(seat => seat.seat)).size !== 4) invalid('seats');
  if (snapshot.game && (snapshot.selfSeat === null ? snapshot.game.hand.length !== 0 : snapshot.game.hand.length !== snapshot.game.handCounts[snapshot.selfSeat])) invalid('hand');
  return snapshot;
}
