import { test, expect, type Page } from '@playwright/test';

async function openRoom(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#mobile-tools').click();
  await page.locator('#tool-guandan').click();
  await page.locator('#guandan-mode-room').click();
  await expect(page.locator('#guandan-room-tool')).toBeVisible();
}

test('两台独立设备通过邀请加入真实房间，仅显示本人手牌并在刷新后恢复', async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  const ledgerWrites: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openRoom(page);
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method()); });
  await page.locator('#guandan-room-name').fill('房主');
  await page.locator('#guandan-room-create').click();
  await expect(page.locator('#guandan-room-lobby')).toBeVisible();
  await expect(page.locator('#guandan-room-start')).toBeDisabled();
  await expect(page.locator('#guandan-room-qr')).toHaveAttribute('src', /^data:image\/png;base64,/);
  const invitation = await page.locator('#guandan-room-invite-url').inputValue();
  const invitationUrl = new URL(invitation);
  expect(invitationUrl.searchParams.has('invite')).toBe(false);
  expect(new URLSearchParams(invitationUrl.hash.slice(1)).get('invite')).toMatch(/^[a-f0-9]{64}$/);
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  await guest.goto(invitation);
  await expect(guest.locator('#guandan-room-join-name')).toBeVisible();
  expect(new URL(guest.url()).hash).toBe('');
  await guest.locator('#guandan-room-join-name').fill('朋友');
  await guest.locator('#guandan-room-join').click();
  await expect(guest.locator('#guandan-room-lobby')).toBeVisible();
  await expect(page.locator('#guandan-room-lobby-seat-1')).toContainText('朋友');
  await page.locator('#guandan-room-start').click();
  await expect(page.locator('#guandan-room-hand [data-testid="guandan-hand-card"]')).toHaveCount(27);
  await expect(guest.locator('#guandan-room-hand [data-testid="guandan-hand-card"]')).toHaveCount(27);
  const hostCards = await page.locator('#guandan-room-hand [data-card-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-card-id')));
  const guestCards = await guest.locator('#guandan-room-hand [data-card-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-card-id')));
  expect(hostCards.filter(id => guestCards.includes(id))).toEqual([]);
  await expect(guest.locator('#guandan-room-play')).toBeDisabled();
  await page.locator('#guandan-room-hint').click();
  const selected = await page.locator('#guandan-room-hand [aria-pressed="true"]').count();
  await page.locator('#guandan-room-play').click();
  await expect(page.locator('#guandan-room-hand [data-testid="guandan-hand-card"]')).toHaveCount(27 - selected);
  await expect(guest.locator('#guandan-room-pass')).toBeEnabled();
  await guest.reload();
  await expect(guest.locator('#guandan-room-hand [data-testid="guandan-hand-card"]')).toHaveCount(27);
  await expect(guest.locator('#guandan-room-pass')).toBeEnabled();
  await guestContext.setOffline(true);
  await guest.locator('#guandan-room-pass').click();
  await expect(guest.locator('#guandan-room-error')).toBeVisible();
  await expect(guest.locator('#guandan-room-hand [data-testid="guandan-hand-card"]')).toHaveCount(27);
  await guestContext.setOffline(false);
  await guest.locator('#guandan-room-reconnect').click();
  await expect(guest.locator('#guandan-room-error')).toHaveCount(0);
  await guest.locator('#guandan-room-pass').click();
  await expect(page.locator('#guandan-room-seat-0')).toHaveAttribute('data-turn', 'true');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.locator('#guandan-room-play')).toBeInViewport();
  }
  await page.screenshot({ path: testInfo.outputPath('guandan-room-mobile.png'), fullPage: true });
  await page.locator('#guandan-room-close').click();
  await page.locator('#guandan-room-close-cancel').click();
  await expect(page.locator('#guandan-room-hand')).toBeVisible();
  await page.locator('#guandan-room-close').click();
  await page.locator('#guandan-room-close-confirm').click();
  await expect(page.locator('#guandan-room-reset')).toBeVisible();
  await expect(guest.locator('#guandan-room-reset')).toBeVisible();
  expect(errors).toEqual([]);
  expect(ledgerWrites).toEqual([]);
  await guestContext.close();
});
