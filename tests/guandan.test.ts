import test from 'node:test';
import assert from 'node:assert/strict';
import { at } from '../src/shared/values.ts';
import { beats, cardLabel, chooseAiAction, classifyCards, createDeck, createGame, hint, isWild, legalPlays, nextRound, parseGuandanGame, passTurn, playCards, rankPower, shuffleDeck, sortHand, teamOf } from '../src/shared/guandan.ts';
import type { Card, Combination, Game, Suit } from '../src/shared/guandan.ts';
function randomSource(initial: number): () => number {
  let seed = initial;
  return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
}
function select(rank: number, count: number): Card[] { return createDeck().filter(card => card.rank === rank).slice(0, count); }
function suited(ranks: number[], suit: Suit): Card[] { return ranks.map(rank => {
  const card = createDeck().find(card => card.rank === rank && card.suit === suit && card.deck === 0);
  assert.ok(card);
  return card;
}); }
function classified(cards: Card[], level: number): Combination { const value = classifyCards(cards, level); assert.ok(value); return value; }
function completedRound(seed: number): Game {
  let game = createGame({ id: `round-${seed}`, deck: shuffleDeck(createDeck(), randomSource(seed)), firstPlayer: seed % 4 });
  for (let count = 0; count < 1000 && game.status === 'playing'; count++) {
    const action = chooseAiAction(game);
    game = action.type === 'play' ? playCards(game, game.turn, action.cardIds) : passTurn(game, game.turn);
  }
  assert.equal(game.status, 'round-over');
  return game;
}

test('完整牌型与级牌百搭比较：普通牌、A两端顺子、连对、钢板、炸弹层级和四王', () => {
  const wilds = createDeck().filter(card => isWild(card, 7));
  assert.equal(classified(select(7, 1), 7).power, 15);
  assert.equal(classified(select(15, 1), 7).power, 16);
  assert.equal(classified([...select(8, 1), at(wilds, 0)], 7).kind, 'pair');
  assert.equal(classified([...select(8, 2), at(wilds, 0)], 7).kind, 'triple');
  assert.equal(classified([...select(8, 2), ...select(9, 2), at(wilds, 0)], 7).kind, 'full-house');
  assert.equal(classified([...select(15, 2), ...select(9, 3)], 7).kind, 'full-house');
  assert.equal(classifyCards([...select(15, 1), at(wilds, 0)], 7), null);
  const lowStraight = [at(select(14, 1), 0), at(select(2, 2), 1), at(select(3, 1), 0), at(select(4, 1), 0), at(select(5, 1), 0)];
  assert.equal(classified(lowStraight, 7).kind, 'straight');
  assert.equal(classified(lowStraight, 7).power, 5);
  assert.equal(classified(suited([10, 11, 12, 13, 14], 'clubs'), 7).power, 14);
  assert.equal(classifyCards(suited([12, 13, 14, 2, 3], 'clubs'), 7), null);
  assert.equal(classified([...select(14, 2), ...select(2, 2), ...select(3, 2)], 7).kind, 'consecutive-pairs');
  assert.equal(classified([...select(6, 3), ...select(7, 3)], 7).kind, 'consecutive-triples');
  const flush = classified([...suited([8, 9, 10, 11], 'clubs'), at(wilds, 0)], 7);
  assert.equal(flush.kind, 'straight-flush');
  const four = classified(select(14, 4), 7), five = classified(select(2, 5), 7), six = classified(select(2, 6), 7);
  assert.ok(beats(five, four)); assert.ok(beats(flush, five)); assert.ok(beats(six, flush));
  assert.ok(beats(classified([...select(14, 8), ...wilds], 7), six));
  assert.ok(beats(classified([...select(15, 2), ...select(16, 2)], 7), classified([...select(14, 8), ...wilds], 7)));
  assert.equal(beats(classified(select(3, 3), 7), classified(select(2, 2), 7)), false);
  assert.equal(classifyCards([at(wilds, 0), at(wilds, 0)], 7), null);
  assert.equal(cardLabel(at(select(16, 1), 0)), '大王');
});

test('十二场真实完整AI对局：108张守恒、合法行动、接风、升降方切换、进退贡及打A通关', () => {
  let sawWind = false, sawSingle = false, sawDouble = false, sawUpgradeTwo = false;
  for (let seed = 1; seed <= 12; seed++) {
    const random = randomSource(seed);
    let game = createGame({ id: `${seed}-1`, deck: shuffleDeck(createDeck(), random), firstPlayer: seed % 4 });
    let actions = 0;
    while (game.status !== 'match-over') {
      while (game.status === 'playing') {
        const before = JSON.stringify(game);
        const action = chooseAiAction(game);
        const previous = game;
        game = action.type === 'play' ? playCards(game, game.turn, action.cardIds) : passTurn(game, game.turn);
        assert.equal(JSON.stringify(previous), before, '纯函数不得修改输入');
        assert.deepEqual(parseGuandanGame(JSON.parse(JSON.stringify(game))), game);
        if (game.status === 'match-over') {
          assert.equal(previous.level, 14);
          assert.equal(previous.levelTeam, game.result?.winner);
        }
        if (previous.table !== null && at(previous.hands, previous.table.player).length === 0 && game.table === null && at(game.hands, (previous.table.player + 2) % 4).length > 0) {
          assert.equal(game.turn, (previous.table.player + 2) % 4); sawWind = true;
        }
        actions++;
        assert.ok(actions < 12000, 'AI必须推进到整场结束');
      }
      assert.ok(game.result);
      sawSingle ||= game.result.upgrade < 3;
      sawDouble ||= game.result.upgrade === 3;
      sawUpgradeTwo ||= game.result.upgrade === 2;
      if (game.status === 'match-over') break;
      const previous = structuredClone(game);
      assert.ok(previous.result);
      game = nextRound(game, { id: `${seed}-${game.round + 1}`, deck: shuffleDeck(createDeck(), random) });
      assert.equal(game.level, at(previous.levels, previous.result.winner));
      assert.deepEqual(game.hands.map(hand => hand.length), [27, 27, 27, 27]);
      assert.ok(game.tributeLog.length > 0);
      assert.deepEqual(parseGuandanGame(game), game);
    }
    assert.equal(game.result?.matchWon, true);
    assert.throws(() => nextRound(game, { id: 'beyond', deck: createDeck() }), { name: 'GuandanRuleError' });
  }
  assert.ok(sawWind && sawSingle && sawDouble && sawUpgradeTwo);
});

// 保持实体牌守恒，只指定发牌去向。 Rearrange a complete deck without fabricating cards.
function placeBigJokers(deck: Card[], recipients: [number, number]): Card[] {
  const result = [...deck];
  const jokers = result.filter(card => card.rank === 16);
  for (let index = 0; index < 2; index++) {
    const jokerIndex = result.findIndex(card => card.id === at(jokers, index).id);
    const target = at(recipients, index) + index * 4;
    const displaced = at(result, target);
    result[target] = at(result, jokerIndex);
    result[jokerIndex] = displaced;
  }
  return result;
}
test('真实结算后单贡、双贡、红桃级牌免贡和合计两大王抗贡', () => {
  let single: Game | null = null, double: Game | null = null;
  for (let seed = 1; seed < 30 && (single === null || double === null); seed++) {
    const game = completedRound(seed);
    assert.ok(game.result);
    if (game.result.upgrade === 3) double = game; else single = game;
  }
  assert.ok(single); assert.ok(double);
  for (const previous of [single, double]) {
    assert.ok(previous.result);
    const order = previous.result.order;
    const first = at(order, 0), second = at(order, 1), third = at(order, 2), last = at(order, 3);
    const donors = previous.result.upgrade === 3 ? [third, last] : [last];
    const antiDeck = placeBigJokers(createDeck(), [last, donors.length === 2 ? third : last]);
    const anti = nextRound(previous, { id: `${previous.id}-anti`, deck: antiDeck });
    assert.equal(anti.turn, first);
    assert.ok(anti.tributeLog[0]?.includes('抗贡'));
    assert.deepEqual(anti.hands, createGame({ id: 'dealt', deck: antiDeck, firstPlayer: 0 }).hands.map(hand => sortHand(hand, anti.level)));
    const normalDeck = placeBigJokers(createDeck(), [first, second]);
    const next = nextRound(previous, { id: `${previous.id}-tribute`, deck: normalDeck });
    assert.equal(next.tributeLog.length, donors.length);
    const originalHands = createGame({ id: 'original', deck: normalDeck, firstPlayer: 0 }).hands;
    const contributions = donors.map(player => ({ player, card: at(sortHand(at(originalHands, player).filter(card => !isWild(card, next.level)), next.level), 0) })).sort((a, b) => rankPower(b.card.rank, next.level) - rankPower(a.card.rank, next.level) || a.player - b.player);
    assert.equal(next.turn, at(contributions, 0).player);
    contributions.forEach(({ player, card }, index) => {
      assert.equal(at(next.hands, player).some(held => held.id === card.id), false);
      assert.ok(at(next.hands, index === 0 ? first : second).some(held => held.id === card.id));
    });
    assert.deepEqual(parseGuandanGame(next), next);
  }
});

test('严格存档边界与非法操作不改变牌局，刷新后继续同一手', () => {
  const deck = createDeck();
  const beforeDeck = structuredClone(deck);
  assert.throws(() => shuffleDeck(deck, () => 1), { name: 'GuandanRuleError' });
  assert.deepEqual(deck, beforeDeck);
  assert.throws(() => createGame({ id: 'bad', deck: deck.slice(1), firstPlayer: 0 }), { name: 'GuandanRuleError' });
  let game = createGame({ id: 'saved', deck: shuffleDeck(deck, randomSource(22)), firstPlayer: 0 });
  const original = structuredClone(game);
  assert.throws(() => passTurn(game, 0), { name: 'GuandanRuleError' });
  assert.throws(() => playCards(game, 1, [at(at(game.hands, 1), 0).id]), { name: 'GuandanRuleError' });
  assert.throws(() => playCards(game, 0, [at(at(game.hands, 1), 0).id]), { name: 'GuandanRuleError' });
  assert.throws(() => playCards(game, 0, []), { name: 'GuandanRuleError' });
  assert.deepEqual(game, original);
  const suggested = hint(game, 0); assert.ok(suggested);
  game = playCards(game, 0, suggested.map(card => card.id));
  const saved = parseGuandanGame(JSON.parse(JSON.stringify(game)));
  assert.deepEqual(chooseAiAction(saved), chooseAiAction(game));
  const corrupt = structuredClone(game); at(corrupt.hands, 0).push(at(at(corrupt.hands, 1), 0));
  assert.throws(() => parseGuandanGame(corrupt));
  assert.throws(() => parseGuandanGame({ ...game, turn: 9 }));
  assert.throws(() => parseGuandanGame({ ...game, status: 'round-over' }));
  assert.throws(() => parseGuandanGame({ ...game, table: { ...game.table, combination: { kind: 'joker-bomb', size: 4, power: 100 } } }));
  assert.throws(() => parseGuandanGame({ ...game, passed: [game.turn] }));
});


test('所有提示候选均为可实际执行的合法动作，百搭提示可循环且不改变输入', () => {
  const desired = [...createDeck().filter(card => isWild(card, 2)), ...select(8, 8), ...select(9, 3), ...select(10, 3), ...select(11, 3), ...select(12, 2), ...select(15, 2), ...select(16, 2)];
  const deck = createDeck();
  desired.forEach((card, index) => {
    const position = deck.findIndex(held => held.id === card.id);
    const displaced = at(deck, index * 4);
    deck[index * 4] = at(deck, position);
    deck[position] = displaced;
  });
  let game = createGame({ id: 'all-hints', deck, firstPlayer: 0 });
  const leading = legalPlays(game, 0);
  assert.ok(leading.length > 20);
  assert.ok(leading.some(cards => cards.length === 10));
  assert.ok(leading.some(cards => classifyCards(cards, game.level)?.kind === 'joker-bomb'));
  for (let turn = 0; turn < 30 && game.status === 'playing'; turn++) {
    const before = structuredClone(game);
    const candidates = legalPlays(game, game.turn);
    assert.deepEqual(hint(game, game.turn), candidates[0] ?? null);
    for (const cards of candidates) {
      const next = playCards(game, game.turn, cards.map(card => card.id));
      assert.deepEqual(parseGuandanGame(next), next);
    }
    assert.deepEqual(game, before);
    const action = chooseAiAction(game);
    game = action.type === 'play' ? playCards(game, game.turn, action.cardIds) : passTurn(game, game.turn);
  }
});


test('真实种子18连续七局：历史已升A的队伍赢下对方低级局，只夺回打A权', () => {
  const random = randomSource(18);
  let game = createGame({ id: 'recover-a-1', deck: shuffleDeck(createDeck(), random), firstPlayer: 2 });
  for (let round = 1; round <= 7; round++) {
    let actions = 0;
    while (game.status === 'playing') {
      const action = chooseAiAction(game);
      game = action.type === 'play' ? playCards(game, game.turn, action.cardIds) : passTurn(game, game.turn);
      assert.ok(++actions < 1000);
    }
    if (round < 7) game = nextRound(game, { id: `recover-a-${round + 1}`, deck: shuffleDeck(createDeck(), random) });
  }
  assert.equal(game.level, 7);
  assert.equal(game.levelTeam, 1);
  assert.equal(game.status, 'round-over');
  assert.equal(game.result?.winner, 0);
  assert.equal(game.result?.previousLevel, 14);
  assert.equal(game.result?.matchWon, false);
  assert.deepEqual(parseGuandanGame(game), game);
  assert.throws(() => parseGuandanGame({ ...game, status: 'match-over', result: { ...game.result, matchWon: true } }));
  const next = nextRound(game, { id: 'now-play-a', deck: shuffleDeck(createDeck(), random) });
  assert.equal(next.level, 14);
  assert.equal(next.levelTeam, 0);
});
