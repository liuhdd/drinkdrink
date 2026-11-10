import { at } from './values.ts';
import { classifyAll } from './guandan-cards.ts';
import type { Card, Combination, CombinationKind, Suit } from './guandan-cards.ts';
import { teamOf, validateDeck } from './guandan.ts';
import type { Game, Play, RoundResult, Team } from './guandan.ts';
function invalid(path: string): never {
  const error = new TypeError(`本机掼蛋存档字段 ${path} 无效，请明确重开练习`);
  error.name = 'GuandanStorageError';
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
export function parseGuandanGame(input: unknown): Game {
  const value = record(input, 'game');
  const level = integer(value.level, 2, 14, 'level');
  const levels = array(value.levels, 'levels');
  if (levels.length !== 2) invalid('levels');
  const game: Game = {
    id: text(value.id, 'id'), round: integer(value.round, 1, 100000, 'round'), level,
    levels: [integer(at(levels, 0), 2, 14, 'levels.0'), integer(at(levels, 1), 2, 14, 'levels.1')], levelTeam: team(value.levelTeam, 'levelTeam'),
    hands: array(value.hands, 'hands').map((hand, index) => cards(hand, `hands.${index}`)),
    turn: integer(value.turn, 0, 3, 'turn'), table: play(value.table, level, 'table'), lastPlay: play(value.lastPlay, level, 'lastPlay'), passed: seats(value.passed, 'passed'), playedCards: cards(value.playedCards, 'playedCards'), finishOrder: seats(value.finishOrder, 'finishOrder'),
    status: oneOf(value.status, ['playing', 'round-over', 'match-over'], 'status'), result: roundResult(value.result),
    tributeLog: array(value.tributeLog, 'tributeLog').map((entry, index) => text(entry, `tributeLog.${index}`)), lastAction: text(value.lastAction, 'lastAction'),
  };
  if (!game.id || game.hands.length !== 4 || game.hands.some(hand => hand.length > 27) || game.tributeLog.length > 2) invalid('hands/id/tributeLog');
  try { validateDeck([...game.hands.flat(), ...game.playedCards]); }
  catch (cause) {
    const error = new TypeError('本机掼蛋存档的108张牌不守恒或牌身份无效', { cause });
    error.name = 'GuandanStorageError';
    throw error;
  }
  for (const held of [game.table, game.lastPlay]) if (held !== null) {
    if (!held.cards.every(played => game.playedCards.some(expected => expected.id === played.id && expected.rank === played.rank && expected.suit === played.suit && expected.deck === played.deck))) invalid('table/lastPlay.cards');
  }
  if (game.lastPlay !== null && game.lastPlay.cards.map(held => held.id).join('|') !== game.playedCards.slice(-game.lastPlay.cards.length).map(held => held.id).join('|')) invalid('lastPlay');
  if ((game.playedCards.length === 0) !== (game.lastPlay === null)) invalid('lastPlay');
  if (game.table !== null && JSON.stringify(game.table) !== JSON.stringify(game.lastPlay)) invalid('table');
  if (game.table === null && game.passed.length > 0) invalid('passed');
  if (game.passed.some(player => player === game.table?.player || at(game.hands, player).length === 0)) invalid('passed');
  if (game.status === 'playing') {
    if (game.result !== null || at(game.hands, game.turn).length === 0 || game.finishOrder.length > 2 || game.level !== at(game.levels, game.levelTeam)) invalid('playing');
    if (game.hands.some((hand, player) => (hand.length === 0) !== game.finishOrder.includes(player))) invalid('finishOrder');
    if (game.finishOrder.length === 2 && teamOf(at(game.finishOrder, 0)) === teamOf(at(game.finishOrder, 1))) invalid('finishOrder');
    if (game.passed.includes(game.turn) || game.turn === game.table?.player) invalid('turn');
  } else {
    const result = game.result;
    if (result === null || result.order.length !== 4 || result.order.join() !== game.finishOrder.join()) invalid('result.order');
    if (at(game.hands, at(result.order, 0)).length !== 0 || at(game.hands, at(result.order, 1)).length !== 0) invalid('finishOrder');
    const first = at(result.order, 0);
    const partnerPosition = result.order.indexOf((first + 2) % 4);
    const upgrade = partnerPosition === 1 ? 3 : partnerPosition === 2 ? 2 : 1;
    if (result.winner !== teamOf(first) || result.upgrade !== upgrade || result.nextLevel !== Math.min(14, result.previousLevel + upgrade) || at(game.levels, result.winner) !== result.nextLevel || result.matchWon !== (game.level === 14 && game.levelTeam === result.winner && partnerPosition < 3) || (game.status === 'match-over') !== result.matchWon) invalid('result');
    if (partnerPosition !== 1 && at(game.hands, at(result.order, 2)).length !== 0) invalid('finishOrder');
  }
  return game;
}
