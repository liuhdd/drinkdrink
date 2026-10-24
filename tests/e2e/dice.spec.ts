import { test, expect, type Page } from '@playwright/test';

test.use({ hasTouch: true });

// 通过 Chrome 原生触屏事件拖动，验证真实 Pointer Events 与手指释放行为。 Use Chrome touch input to exercise real pointer events and release behavior.
async function dragCup(page: Page, upwardDistance: number): Promise<void> {
  const gesture = page.locator('#dice-gesture');
  await gesture.scrollIntoViewIfNeeded();
  const bounds = await gesture.boundingBox();
  if (!bounds) throw new Error('骰盅手势区域没有可用的布局尺寸');
  const x = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height * 0.75;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, id: 1 }] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - upwardDistance * step / 6, id: 1 }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

async function expectDiceValues(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    const die = page.getByTestId(`dice-${index}`);
    await expect(die).toHaveAttribute('data-value', /^[1-6]$/);
    await expect(die).toHaveAttribute('aria-hidden', 'true');
  }
  await expect(page.locator('#dice-result')).toHaveCount(0);
}

test('真实触屏摇骰子保持盖盅、半揭遮挡与完全揭晓，重新摇动先盖盅且不写入账本', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const ledgerWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method());
  });
  await page.locator('#mobile-tools').click();
  await expect(page.locator('#tools-view')).toBeVisible();
  await page.locator('#tool-dice').click();
  await expect(page.locator('#dice-shake')).toBeInViewport();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '0');
  await expect(page.locator('#dice-count-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#dice-count-settings')).toHaveCount(0);
  await expect(page.locator('#dice-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#dice-sound')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#dice-sound').click();
  await expect(page.locator('#dice-sound')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#dice-sound').click();
  await page.locator('#dice-count-toggle').click();
  await expect(page.locator('#dice-count-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#dice-count-settings')).toBeVisible();
  await expect(page.locator('#dice-count-5')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#dice-count-1').click();
  await expect(page.locator('[data-testid^="dice-"]')).toHaveCount(1);
  await page.locator('#dice-count-6').click();
  await expect(page.locator('#dice-count-6')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="dice-"]')).toHaveCount(6);
  await expect(page.locator('#dice-count-settings')).toBeVisible();
  await page.locator('#dice-count-toggle').click();
  await expect(page.locator('#dice-count-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#dice-count-settings')).toHaveCount(0);
  await page.locator('#dice-count-toggle').click();
  await expect(page.locator('#dice-count-settings')).toBeVisible();
  await page.locator('#dice-shake').click();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'covering');
  await expect(page.locator('#dice-shake')).toBeDisabled();
  await expect(page.locator('#dice-count-toggle')).toBeDisabled();
  await expect(page.locator('#dice-count-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#dice-count-settings')).toHaveCount(0);
  await expect(page.locator('#dice-sound')).toBeDisabled();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'shaking');
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '0');
  await expect(page.locator('#dice-result')).toHaveCount(0);
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'settled');
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '0');
  await expect(page.locator('#dice-result')).toHaveCount(0);
  await expect(page.locator('#dice-cup')).toBeAttached();
  await page.screenshot({ path: testInfo.outputPath('dice-closed.png'), fullPage: true });
  await dragCup(page, 90);
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '90');
  await expect(page.locator('#dice-result')).toHaveCount(0);
  await expect(page.locator('#dice-gesture')).toHaveAttribute('aria-valuenow', '50');
  await page.screenshot({ path: testInfo.outputPath('dice-half.png'), fullPage: true });
  await dragCup(page, 180);
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '180');
  await expect(page.locator('#dice-gesture')).toHaveAttribute('aria-valuenow', '100');
  await expectDiceValues(page, 6);
  await page.screenshot({ path: testInfo.outputPath('dice-open.png'), fullPage: true });
  await page.locator('#dice-shake').click();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'covering');
  await expect(page.locator('#dice-result')).toHaveCount(0);
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'shaking');
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '0');
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'settled');
  await dragCup(page, 180);
  await expectDiceValues(page, 6);
  await dragCup(page, -90);
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '90');
  await expect(page.locator('#dice-result')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect(ledgerWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test('离线账本错误时工具仍可用，键盘可揭盖且切换页面会结束本次摇动', async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await context.setOffline(true);
  await page.locator('#settings-button').click();
  await expect(page.locator('#settings-form')).toBeVisible();
  await page.locator('[data-slot="dialog-close"]').click();
  await expect(page.locator('#integration-error')).toBeVisible();
  await page.locator('#mobile-tools').click();
  await expect(page.locator('#tools-view')).toBeVisible();
  await page.locator('#tool-dice').click();
  await page.locator('#dice-shake').click();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'settled');
  const gesture = page.locator('#dice-gesture');
  await gesture.focus();
  await expect(gesture).toBeFocused();
  await expect(gesture).toHaveAttribute('role', 'slider');
  await gesture.press('ArrowUp');
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '10');
  await expect(page.locator('#dice-result')).toHaveCount(0);
  await gesture.press('End');
  await expect(gesture).toHaveAttribute('aria-valuenow', '100');
  await expectDiceValues(page, 5);
  await gesture.press('Home');
  await expect(gesture).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#dice-result')).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.locator('#integration-error')).toHaveCount(0);
  await page.locator('#settings-button').click();
  await expect(page.locator('#settings-form')).toBeVisible();
  await page.locator('[data-slot="dialog-close"]').click();
  await page.locator('#dice-shake').click();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'shaking');
  await page.locator('#mobile-ledger').click();
  await expect(page.locator('#dice-scene')).toHaveCount(0);
  await page.locator('#mobile-tools').click();
  await page.locator('#tool-dice').click();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'ready');
  await page.locator('#dice-shake').click();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'settled');
  await page.reload();
  await page.locator('#mobile-tools').click();
  await page.locator('#tool-dice').click();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '0');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#nav-tools')).toBeVisible();
  await page.locator('#nav-ledger').click();
  await page.locator('#nav-tools').click();
  await expect(page.locator('#tools-view')).toBeVisible();
  await page.locator('#tool-dice').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: testInfo.outputPath('dice-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('#mobile-tools')).toBeVisible();
  await expect(page.locator('#nav-tools')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768);
  expect(errors).toEqual([]);
});
