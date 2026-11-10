import { at } from './values.ts';

export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds' | 'joker';
export type Card = { id: string; suit: Suit; rank: number; deck: 0 | 1 };
export type CombinationKind = 'single' | 'pair' | 'triple' | 'full-house' | 'straight' | 'consecutive-pairs' | 'consecutive-triples' | 'bomb' | 'straight-flush' | 'joker-bomb';
export type Combination = { kind: CombinationKind; size: number; power: number };
export function guandanError(message: string): Error {
  const error = new Error(message);
  error.name = 'GuandanRuleError';
  return error;
}
export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const deck of [0, 1] as const) {
    for (const suit of ['spades', 'hearts', 'clubs', 'diamonds'] as const) {
      for (let rank = 2; rank <= 14; rank++) cards.push({ id: `${deck}-${suit}-${rank}`, suit, rank, deck });
    }
    for (const rank of [15, 16]) cards.push({ id: `${deck}-joker-${rank}`, suit: 'joker', rank, deck });
  }
  return cards;
}
export function shuffleDeck(cards: readonly Card[], random: () => number): Card[] {
  const result = cards.map(card => ({ ...card }));
  for (let i = result.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw guandanError('洗牌随机数必须在 [0,1) 内');
    const j = Math.floor(value * (i + 1));
    const current = at(result, i);
    result[i] = at(result, j);
    result[j] = current;
  }
  return result;
}
export function isWild(card: Card, level: number): boolean { return card.suit === 'hearts' && card.rank === level; }
export function rankPower(rank: number, level: number): number { return rank >= 15 ? rank + 1 : rank === level ? 15 : rank; }
export function sortHand(cards: readonly Card[], level: number): Card[] {
  return [...cards].sort((a, b) => rankPower(b.rank, level) - rankPower(a.rank, level) || a.suit.localeCompare(b.suit) || a.id.localeCompare(b.id));
}
export function cardLabel(card: Card): string {
  if (card.rank === 15) return '小王';
  if (card.rank === 16) return '大王';
  const suit = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦', joker: '' }[card.suit];
  const rank = card.rank === 14 ? 'A' : card.rank === 13 ? 'K' : card.rank === 12 ? 'Q' : card.rank === 11 ? 'J' : String(card.rank);
  return `${suit}${rank}`;
}
function category(combo: Combination): number {
  if (combo.kind === 'joker-bomb') return 100;
  if (combo.kind === 'straight-flush') return 5.5;
  return combo.kind === 'bomb' ? combo.size : 0;
}
export function beats(candidate: Combination, previous: Combination): boolean {
  const a = category(candidate), b = category(previous);
  if (a !== b) return a > b;
  if (a > 0) return candidate.power > previous.power;
  return candidate.kind === previous.kind && candidate.size === previous.size && candidate.power > previous.power;
}
function matches(cards: readonly Card[], ranks: readonly number[], level: number, suit: Suit | null): boolean {
  if (cards.length !== ranks.length) return false;
  const remaining = [...ranks];
  let wild = 0;
  for (const card of cards) {
    if (isWild(card, level)) { wild++; continue; }
    if (suit !== null && card.suit !== suit) return false;
    const index = remaining.indexOf(card.rank);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === wild && remaining.every(rank => rank < 15);
}
export function sequenceRanks(length: number): number[][] {
  const sequences: number[][] = [];
  for (let start = 1; start <= 15 - length; start++) sequences.push(Array.from({ length }, (_, i) => start + i === 1 ? 14 : start + i));
  return sequences;
}
export function classifyAll(cards: readonly Card[], level: number): Combination[] {
  if (cards.length === 0 || new Set(cards.map(card => card.id)).size !== cards.length) return [];
  const size = cards.length;
  if (size === 1) return [{ kind: 'single', size, power: rankPower(at(cards, 0).rank, level) }];
  if (size === 4 && cards.every(card => card.suit === 'joker') && cards.filter(card => card.rank === 15).length === 2 && cards.filter(card => card.rank === 16).length === 2) return [{ kind: 'joker-bomb', size, power: 100 }];
  const result: Combination[] = [];
  if (size === 2 || size === 3 || size >= 4 && size <= 10) {
    for (let rank = 2; rank <= (size === 2 ? 16 : 14); rank++) {
      if (matches(cards, Array<number>(size).fill(rank), level, null)) result.push({ kind: size === 2 ? 'pair' : size === 3 ? 'triple' : 'bomb', size, power: rankPower(rank, level) });
    }
  }
  if (size === 5) {
    for (let triple = 2; triple <= 14; triple++) for (let pair = 2; pair <= 16; pair++) {
      if (pair !== triple && matches(cards, [triple, triple, triple, pair, pair], level, null)) result.push({ kind: 'full-house', size, power: rankPower(triple, level) });
    }
    for (const ranks of sequenceRanks(5)) {
      const power = at(ranks, 4);
      if (matches(cards, ranks, level, null)) result.push({ kind: 'straight', size, power });
      for (const suit of ['spades', 'hearts', 'clubs', 'diamonds'] as const) if (matches(cards, ranks, level, suit)) result.push({ kind: 'straight-flush', size, power });
    }
  }
  if (size === 6) {
    for (const width of [2, 3]) for (const ranks of sequenceRanks(6 / width)) {
      if (matches(cards, ranks.flatMap(rank => Array<number>(width).fill(rank)), level, null)) result.push({ kind: width === 2 ? 'consecutive-pairs' : 'consecutive-triples', size, power: at(ranks, ranks.length - 1) });
    }
  }
  return result.sort((a, b) => category(b) - category(a) || b.power - a.power);
}
export function classifyCards(cards: readonly Card[], level: number): Combination | null { return classifyAll(cards, level)[0] ?? null; }

// 按目标牌型取实体牌，百搭只补普通牌。 Select physical cards; wilds cannot replace jokers.
function selectRanks(hand: readonly Card[], ranks: readonly number[], level: number, suit: Suit | null): Card[] | null {
  const available = [...hand];
  const selected: Card[] = [];
  const missing: number[] = [];
  for (const rank of ranks) {
    const index = available.findIndex(card => !isWild(card, level) && card.rank === rank && (suit === null || card.suit === suit));
    if (index < 0) missing.push(rank);
    else selected.push(...available.splice(index, 1));
  }
  for (const rank of missing) {
    if (rank >= 15) return null;
    const index = available.findIndex(card => isWild(card, level));
    if (index < 0) return null;
    selected.push(...available.splice(index, 1));
  }
  return selected;
}
export function candidatePlays(hand: readonly Card[], level: number): Card[][] {
  const plays: Card[][] = hand.map(card => [card]);
  const add = (ranks: number[], suit: Suit | null): void => {
    const selected = selectRanks(hand, ranks, level, suit);
    if (selected !== null) plays.push(selected);
  };
  for (let rank = 2; rank <= 16; rank++) for (let size = 2; size <= (rank >= 15 ? 2 : 10); size++) add(Array<number>(size).fill(rank), null);
  for (let triple = 2; triple <= 14; triple++) for (let pair = 2; pair <= 16; pair++) if (triple !== pair) add([triple, triple, triple, pair, pair], null);
  for (const ranks of sequenceRanks(5)) {
    add(ranks, null);
    for (const suit of ['spades', 'hearts', 'clubs', 'diamonds'] as const) add(ranks, suit);
  }
  for (const width of [2, 3]) for (const ranks of sequenceRanks(6 / width)) add(ranks.flatMap(rank => Array<number>(width).fill(rank)), null);
  const jokers = hand.filter(card => card.suit === 'joker');
  if (jokers.length === 4) plays.push(jokers);
  const unique = new Map<string, Card[]>();
  for (const play of plays) unique.set(play.map(card => card.id).sort().join('|'), play);
  return [...unique.values()];
}
