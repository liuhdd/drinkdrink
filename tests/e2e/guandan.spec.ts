import { test, expect, type Page } from '@playwright/test';
import { chooseAiAction, createDeck, createGame, parseGuandanGame, passTurn, playCards, shuffleDeck, type Game } from '../../src/shared/guandan.ts';
import { GUANDAN_STORAGE_KEY } from '../../src/client/guandan-storage.ts';

async function openGuandan(page: Page): Promise<void> {
  await page.locator('#mobile-tools').click();
  await page.locator('#tool-guandan').click();
  await expect(page.locator('#guandan-title')).toBeFocused();
  await page.locator('#guandan-mode-practice').click();
}
async function savedGame(page: Page): Promise<Game> {
  const raw = await page.evaluate(key => localStorage.getItem(key), GUANDAN_STORAGE_KEY);
  if (!raw) throw new Error('练习牌局尚未保存');
  return parseGuandanGame(JSON.parse(raw) as unknown);
}
function finishedRound(): Game {
  let state = 173;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  let game = createGame({ id: 'browser-round', deck: shuffleDeck(createDeck(), random), firstPlayer: 0 });
  for (let actions = 0; actions < 1000 && game.status === 'playing'; actions++) {
    const action = chooseAiAction(game);
    game = action.type === 'play' ? playCards(game, game.turn, action.cardIds) : passTurn(game, game.turn);
  }
  if (game.status !== 'round-over') throw new Error('真实规则引擎未能完成测试牌局');
  return game;
}

test('掼蛋支持真实选牌与电脑轮转，返回和刷新保留独立牌局', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const ledgerWrites: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method()); });
  await openGuandan(page);
  await page.locator('#guandan-rules').click();
  await expect(page.locator('#guandan-rules-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#guandan-rules')).toBeFocused();
  await page.locator('#guandan-start').click();
  await expect(page.getByTestId('guandan-hand-card')).toHaveCount(27);
  await expect(page.locator('#guandan-pass')).toBeDisabled();
  const first = await savedGame(page);
  const ordinary = first.hands[0]!.filter(card => card.rank !== first.level && card.rank < 15);
  const pair = [ordinary[0]!, ordinary.find(card => card.rank !== ordinary[0]!.rank)!];
  for (const card of pair) await page.locator(`#guandan-card-${card.id}`).click();
  await page.locator('#guandan-play').click();
  await expect(page.locator('#guandan-notice')).toBeVisible();
  await expect(page.locator('#guandan-error')).toHaveCount(0);
  await expect(page.getByTestId('guandan-hand-card')).toHaveCount(27);
  await page.locator('#guandan-clear').click();
  await page.locator('#guandan-hint').click();
  const selected = await page.locator('[data-testid="guandan-hand-card"][aria-pressed="true"]').count();
  expect(selected).toBeGreaterThan(0);
  await page.locator('#guandan-play').click();
  await expect(page.getByTestId('guandan-hand-card')).toHaveCount(27 - selected);
  await expect(page.locator('#guandan-seat-0')).toHaveAttribute('data-turn', 'true', { timeout: 15_000 });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.locator('#guandan-play')).toBeInViewport();
    await expect(page.locator('#app-header')).toBeHidden();
  }
  await page.screenshot({ path: testInfo.outputPath('guandan-mobile.png'), fullPage: true });
  const saved = await savedGame(page);
  await page.locator('#guandan-mode-back').click();
  await page.locator('#tools-back').click();
  await expect(page.locator('#tool-guandan')).toBeFocused();
  await page.locator('#tool-guandan').click();
  await page.locator('#guandan-mode-practice').click();
  expect(await savedGame(page)).toEqual(saved);
  await page.reload();
  await expect(page.locator('#workspace')).toBeVisible();
  await openGuandan(page);
  await expect(page.getByTestId('guandan-hand-card')).toHaveCount(27 - selected);
  expect(await savedGame(page)).toEqual(saved);
  await page.locator('#guandan-restart').click();
  await page.locator('#guandan-restart-cancel').click();
  expect(await savedGame(page)).toEqual(saved);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: testInfo.outputPath('guandan-desktop.png'), fullPage: true });
  await page.locator('#guandan-restart').click();
  await page.locator('#guandan-restart-confirm').click();
  await expect(page.getByTestId('guandan-hand-card')).toHaveCount(27);
  expect((await savedGame(page)).id).not.toBe(saved.id);
  expect(errors).toEqual([]);
  expect(ledgerWrites).toEqual([]);
});

test('完整牌局结算后下一局执行进退贡，同设备新页恢复相同手牌', async ({ page, context }) => {
  const round = finishedRound();
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.evaluate(({ key, game }) => localStorage.setItem(key, JSON.stringify(game)), { key: GUANDAN_STORAGE_KEY, game: round });
  await openGuandan(page);
  await expect(page.locator('#guandan-result')).toBeVisible();
  await page.locator('#guandan-next-round').click();
  await expect(page.getByTestId('guandan-hand-card')).toHaveCount(27);
  await expect(page.locator('#guandan-tribute')).toBeVisible();
  await page.locator('#guandan-pause').click();
  const next = await savedGame(page);
  expect(next.round).toBe(2);
  expect(next.tributeLog.length).toBeGreaterThan(0);
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('#workspace')).toBeVisible();
  await openGuandan(other);
  await other.locator('#guandan-pause').click();
  expect((await savedGame(other)).id).toBe(next.id);
  await other.locator('#guandan-restart').click();
  await other.locator('#guandan-restart-confirm').click();
  await expect(page.locator('#guandan-level')).toContainText('第 1 局');
  expect((await savedGame(page)).id).not.toBe(next.id);
});

test('损坏练习记录保持原样，只有确认重开才覆盖', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.evaluate(key => localStorage.setItem(key, '{bad json'), GUANDAN_STORAGE_KEY);
  await openGuandan(page);
  await expect(page.locator('#guandan-error')).toBeVisible();
  await expect(page.locator('#guandan-start')).toBeDisabled();
  await page.locator('#guandan-reload').click();
  expect(await page.evaluate(key => localStorage.getItem(key), GUANDAN_STORAGE_KEY)).toBe('{bad json');
  await page.locator('#guandan-error-restart').click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(key => localStorage.getItem(key), GUANDAN_STORAGE_KEY)).toBe('{bad json');
  await page.locator('#guandan-error-restart').click();
  await page.locator('#guandan-restart-confirm').click();
  await expect(page.locator('#guandan-error')).toHaveCount(0);
  await expect(page.getByTestId('guandan-hand-card')).toHaveCount(27);
});
