import { at } from './values.ts';
import { beats, candidatePlays, cardLabel, classifyAll, createDeck, guandanError, isWild, rankPower, sortHand } from './guandan-cards.ts';
import type { Card, Combination } from './guandan-cards.ts';
export { beats, cardLabel, classifyCards, createDeck, guandanError, isWild, rankPower, shuffleDeck, sortHand } from './guandan-cards.ts';
export type { Card, Combination, CombinationKind, Suit } from './guandan-cards.ts';
export { parseGuandanGame } from './guandan-parse.ts';
export type Team = 0 | 1;
export type Play = { player: number; cards: Card[]; combination: Combination };
export type RoundResult = { winner: Team; order: number[]; upgrade: number; previousLevel: number; nextLevel: number; matchWon: boolean };
export type Game = {
  id: string; round: number; level: number; levels: [number, number]; levelTeam: Team;
  hands: Card[][]; turn: number; table: Play | null; lastPlay: Play | null;
  passed: number[]; playedCards: Card[]; finishOrder: number[];
  status: 'playing' | 'round-over' | 'match-over'; result: RoundResult | null;
  tributeLog: string[]; lastAction: string;
};
export type AiAction = { type: 'play'; cardIds: string[] } | { type: 'pass' };
export function teamOf(player: number): Team { return player % 2 === 0 ? 0 : 1; }
export function playerName(player: number): string { return at(['你', '下家', '对家', '上家'], player); }
export function validateDeck(deck: readonly Card[]): void {
  const canonical = createDeck();
  if (deck.length !== 108 || new Set(deck.map(card => card.id)).size !== 108) throw guandanError('必须提供108张不重复的完整双副牌');
  for (const card of deck) {
    if (!canonical.some(expected => expected.id === card.id && expected.rank === card.rank && expected.suit === card.suit && expected.deck === card.deck)) throw guandanError(`牌 ${card.id} 不属于标准双副牌`);
  }
}
export function dealCards(deck: readonly Card[], level: number): Card[][] {
  validateDeck(deck);
  return [0, 1, 2, 3].map(player => sortHand(deck.filter((_, index) => index % 4 === player).map(card => ({ ...card })), level));
}
export function createGame(input: { id: string; deck: readonly Card[]; firstPlayer: number }): Game {
  if (!input.id || !Number.isInteger(input.firstPlayer) || input.firstPlayer < 0 || input.firstPlayer > 3) throw guandanError('新牌局必须有ID和0至3的先手座位');
  return {
    id: input.id, round: 1, level: 2, levels: [2, 2], levelTeam: 0,
    hands: dealCards(input.deck, 2), turn: input.firstPlayer, table: null, lastPlay: null,
    passed: [], playedCards: [], finishOrder: [], status: 'playing', result: null,
    tributeLog: [], lastAction: `${playerName(input.firstPlayer)}先出牌`,
  };
}
function requireTurn(game: Game, player: number): void {
  if (game.status !== 'playing') throw guandanError('本局已结束，请开始下一局');
  if (game.turn !== player) throw guandanError('还没有轮到该座位出牌');
  if (at(game.hands, player).length === 0) throw guandanError('已出完牌的座位不能行动');
}
function followingPlayer(hands: readonly Card[][], player: number): number {
  for (let offset = 1; offset <= 4; offset++) {
    const next = (player + offset) % 4;
    if (at(hands, next).length > 0) return next;
  }
  throw guandanError('没有仍有手牌的座位');
}
function settle(game: Game): Game {
  if (game.finishOrder.length < 3 && !(game.finishOrder.length === 2 && teamOf(at(game.finishOrder, 0)) === teamOf(at(game.finishOrder, 1)))) return game;
  const order = [...game.finishOrder];
  for (let offset = 0; offset < 4; offset++) {
    const player = (game.turn + offset) % 4;
    if (!order.includes(player)) order.push(player);
  }
  const winner = teamOf(at(order, 0));
  const partnerPosition = order.indexOf((at(order, 0) + 2) % 4);
  const upgrade = partnerPosition === 1 ? 3 : partnerPosition === 2 ? 2 : 1;
  const previousLevel = at(game.levels, winner);
  const nextLevel = Math.min(14, previousLevel + upgrade);
  const matchWon = game.level === 14 && game.levelTeam === winner && partnerPosition < 3;
  const levels: [number, number] = [...game.levels];
  levels[winner] = nextLevel;
  return { ...game, finishOrder: order, levels, status: matchWon ? 'match-over' : 'round-over', result: { winner, order, upgrade, previousLevel, nextLevel, matchWon }, lastAction: `${playerName(at(order, 0))}头游，${winner === 0 ? '我方' : '对方'}${matchWon ? '打过A，赢得整场' : `升${upgrade}级，下次打${nextLevel === 14 ? 'A' : nextLevel}`}` };
}
export function playCards(game: Game, player: number, cardIds: readonly string[]): Game {
  requireTurn(game, player);
  if (cardIds.length === 0 || new Set(cardIds).size !== cardIds.length) throw guandanError('请选择不重复的手牌');
  const hand = at(game.hands, player);
  const cards = cardIds.map(id => {
    const card = hand.find(candidate => candidate.id === id);
    if (card === undefined) throw guandanError(`手中没有牌 ${id}`);
    return { ...card };
  });
  const combinations = classifyAll(cards, game.level);
  if (combinations.length === 0) throw guandanError('所选牌不构成合法掼蛋牌型');
  const table = game.table;
  const combination = combinations.find(candidate => table === null || beats(candidate, table.combination));
  if (combination === undefined) throw guandanError('所选牌不能压过上一手');
  const hands = game.hands.map((held, seat) => seat === player ? held.filter(card => !cardIds.includes(card.id)) : [...held]);
  const finishOrder = at(hands, player).length === 0 ? [...game.finishOrder, player] : [...game.finishOrder];
  const play: Play = { player, cards, combination };
  const result: Game = { ...game, hands, finishOrder, table: play, lastPlay: play, passed: [], playedCards: [...game.playedCards, ...cards], turn: followingPlayer(hands, player), lastAction: `${playerName(player)}出${cards.map(cardLabel).join(' ')}${at(hands, player).length === 0 ? '，已出完' : ''}` };
  return settle(result);
}
export function passTurn(game: Game, player: number): Game {
  requireTurn(game, player);
  const table = game.table;
  if (table === null) throw guandanError('领出时不能过牌');
  const passed = [...game.passed, player];
  const responders = game.hands.map((hand, seat) => ({ hand, seat })).filter(({ hand, seat }) => hand.length > 0 && seat !== table.player);
  if (responders.every(({ seat }) => passed.includes(seat))) {
    const teammate = (table.player + 2) % 4;
    const leader = at(game.hands, table.player).length > 0 ? table.player : at(game.hands, teammate).length > 0 ? teammate : followingPlayer(game.hands, table.player);
    return { ...game, table: null, passed: [], turn: leader, lastAction: `${playerName(player)}过牌，${playerName(leader)}${leader === teammate ? '接风' : '重新领出'}` };
  }
  return { ...game, passed, turn: followingPlayer(game.hands, player), lastAction: `${playerName(player)}过牌` };
}
// 提示列出等价牌型的代表选牌，而非每种实体排列。 Hints use representative physical selections.
export function legalPlays(game: Game, player: number): Card[][] {
  requireTurn(game, player);
  const table = game.table;
  const candidates = candidatePlays(at(game.hands, player), game.level).map(cards => ({ cards, combination: classifyAll(cards, game.level).find(combo => table === null || beats(combo, table.combination)) })).filter((entry): entry is { cards: Card[]; combination: Combination } => entry.combination !== undefined);
  const isBomb = (combination: Combination): number => ['bomb', 'straight-flush', 'joker-bomb'].includes(combination.kind) ? 1 : 0;
  candidates.sort((a, b) => {
    const aFinishes = a.cards.length === at(game.hands, player).length;
    const bFinishes = b.cards.length === at(game.hands, player).length;
    if (aFinishes !== bFinishes) return aFinishes ? -1 : 1;
    return isBomb(a.combination) - isBomb(b.combination) || (table === null ? b.cards.length - a.cards.length : a.cards.length - b.cards.length) || a.combination.power - b.combination.power;
  });
  return candidates.map(candidate => candidate.cards);
}
export function hint(game: Game, player: number): Card[] | null { return legalPlays(game, player)[0] ?? null; }
export function chooseAiAction(game: Game): AiAction {
  const cards = hint(game, game.turn);
  if (cards === null) return { type: 'pass' };
  if (game.table !== null && teamOf(game.table.player) === teamOf(game.turn) && cards.length !== at(game.hands, game.turn).length) return { type: 'pass' };
  return { type: 'play', cardIds: cards.map(card => card.id) };
}
function tributeCard(hand: readonly Card[], level: number): Card {
  const eligible = hand.filter(card => !isWild(card, level));
  return at(sortHand(eligible, level), 0);
}
function returnCard(hand: readonly Card[], level: number): Card {
  const eligible = hand.filter(card => !isWild(card, level));
  const low = eligible.filter(card => card.rank <= 10 && card.rank !== level);
  const choices = low.length > 0 ? low : eligible;
  return at([...choices].sort((a, b) => rankPower(a.rank, level) - rankPower(b.rank, level) || a.id.localeCompare(b.id)), 0);
}
/**
 * 练习局自动进退贡：同贡按座位排序，无非级≤10时退最小非百搭牌。
 * Practice convention: tied tributes use seat order; return the lowest non-wild if no low non-level card exists.
 * 双下未出完两家按轮转顺序记名次；A关失败留A，不采用三败退2变体。
 * Double-down losers use seat order; unsuccessful A attempts stay at A without a three-loss reset.
 */
export function nextRound(game: Game, input: { id: string; deck: readonly Card[] }): Game {
  if (game.status !== 'round-over' || game.result === null) throw guandanError('只有本局结算后才能开始下一局；整场结束请重新开始');
  if (!input.id || input.id === game.id) throw guandanError('下一局需要新的牌局ID');
  const result = game.result;
  const level = at(game.levels, result.winner);
  const hands = dealCards(input.deck, level);
  const first = at(result.order, 0), second = at(result.order, 1), last = at(result.order, 3);
  const doubleDown = teamOf(first) === teamOf(second);
  const donors = doubleDown ? [at(result.order, 2), last] : [last];
  const tributeLog: string[] = [];
  let turn = first;
  const bigJokers = donors.flatMap(player => at(hands, player)).filter(card => card.rank === 16).length;
  if (bigJokers === 2) tributeLog.push(`${doubleDown ? '双下方合计' : playerName(last)}持两张大王，抗贡，头游先出`);
  else {
    const tributes = donors.map(player => ({ player, card: tributeCard(at(hands, player), level) })).sort((a, b) => rankPower(b.card.rank, level) - rankPower(a.card.rank, level) || a.player - b.player);
    turn = at(tributes, 0).player;
    // 同时决定退贡，避免把收到的贡牌直接退回。 Choose returns before receiving tributes.
    const exchanges = tributes.map((tribute, index) => {
      const recipient = index === 0 ? first : second;
      return { ...tribute, recipient, returned: returnCard(at(hands, recipient), level) };
    });
    for (const exchange of exchanges) {
      const { player, card, recipient, returned } = exchange;
      hands[player] = [...at(hands, player).filter(held => held.id !== card.id), returned];
      hands[recipient] = [...at(hands, recipient).filter(held => held.id !== returned.id), card];
      tributeLog.push(`${playerName(player)}向${playerName(recipient)}进贡${cardLabel(card)}，自动退${cardLabel(returned)}`);
    }
  }
  return { id: input.id, round: game.round + 1, level, levels: [...game.levels], levelTeam: result.winner, hands: hands.map(hand => sortHand(hand, level)), turn, table: null, lastPlay: null, passed: [], playedCards: [], finishOrder: [], status: 'playing', result: null, tributeLog, lastAction: `${playerName(turn)}先出牌` };
}
