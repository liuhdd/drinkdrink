import { test, expect, type Locator, type Page } from '@playwright/test';
import { decodeSnapshot } from '../../src/shared/protocol.ts';
import { requireLedger } from '../../src/shared/values.ts';
import { DEVICE_KEY } from '../../src/client/server-storage.ts';
import { readFile } from 'node:fs/promises';

async function snapshot(page: Page) {
  const id = await page.evaluate(key => localStorage.getItem(key), DEVICE_KEY);
  if (!id) throw new Error('浏览器未创建匿名设备标识');
  const response = await page.request.get('/api/ledger', { headers: { 'X-Device-ID': id } });
  expect(response.ok()).toBe(true);
  return decodeSnapshot(await response.json());
}
async function memberId(page: Page, name: string): Promise<string> {
  const ledger = requireLedger(await snapshot(page));
  const member = ledger.session.members.find(item => item.name === name);
  if (!member) throw new Error(`成员未保存：${name}`);
  return member.id;
}
async function openSettings(page: Page) { await page.locator('#settings-button').click(); await page.locator('#settings-session').click(); await expect(page.locator('#settings-form')).toBeVisible(); }
async function startSession(page: Page, title: string) {
  await openSettings(page);
  await page.locator('#new-session-button').click();
  await page.locator('#new-session-name').fill(title);
  await page.locator('#new-session-cup').fill('2');
  await page.locator('#confirm-new-session').click();
  await expect(page.locator('#session-form')).toHaveCount(0);
  await expect(page.locator('#session-title')).toHaveText(title);
}
async function expectCompactSession(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const [header, title, more] = await Promise.all([
    page.locator('#session-header').boundingBox(), page.locator('#session-title').boundingBox(),
    page.locator('#desktop-settings').boundingBox(),
  ]);
  if (!header || !title || !more) throw new Error('顶部导航、酒局标题或详情入口没有可用的布局尺寸');
  expect(Math.abs(header.y)).toBeLessThanOrEqual(1);
  expect(header.height).toBeLessThanOrEqual(64);
  expect(title.height).toBeLessThanOrEqual(28);
  expect(more.x).toBeGreaterThanOrEqual(title.x + title.width);
  expect(Math.abs(title.y + title.height / 2 - more.y - more.height / 2)).toBeLessThanOrEqual(4);
  await expect(page.locator('#desktop-settings')).toBeInViewport();
}
async function expectFinishedResults(page: Page, members: readonly { id: string; consumed: number; cups: number; pending: number }[]): Promise<void> {
  await expect(page.locator('#members-grid [data-select-member], #members-grid button, #member-controls, #add-button, #subtract-button, #drink-button, #edit-member-button')).toHaveCount(0);
  for (const member of members) {
    const card = page.getByTestId(`member-card-${member.id}`);
    await expect(card.getByTestId(`result-consumed-${member.id}`)).toBeVisible();
    await expect(card.getByTestId(`result-consumed-${member.id}`)).toHaveText(String(member.consumed));
    await expect(card.getByTestId(`result-cups-${member.id}`)).toBeVisible();
    await expect(card.getByTestId(`result-cups-${member.id}`)).toHaveText(`${member.cups} 杯`);
    await expect(card.getByTestId(`result-pending-${member.id}`)).toBeVisible();
    await expect(card.getByTestId(`result-pending-${member.id}`)).toHaveText(new RegExp(`^(?:剩余)?待喝 ${member.pending} 个$`));
  }
}
async function expectHistoryRow(page: Page, id: string): Promise<void> {
  const row = page.getByTestId(`history-${id}`);
  const title = page.getByTestId(`history-title-${id}`);
  const time = page.getByTestId(`history-time-${id}`);
  const consumed = page.getByTestId(`history-consumed-${id}`);
  await expect(title).toBeVisible();
  await expect(time).toBeVisible();
  await expect(consumed).toBeVisible();
  const [rowBox, titleBox, timeBox, consumedBox] = await Promise.all([row.boundingBox(), title.boundingBox(), time.boundingBox(), consumed.boundingBox()]);
  if (!rowBox || !titleBox || !timeBox || !consumedBox) throw new Error('历史条目、局名、时间或已喝数量没有可用的布局尺寸');
  for (const box of [titleBox, timeBox, consumedBox]) {
    expect(box.x).toBeGreaterThanOrEqual(rowBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(rowBox.y);
    expect(box.y + box.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
  }
}
async function textRectangles(locator: Locator): Promise<readonly { top: number; bottom: number }[]> {
  return locator.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()].filter(rect => rect.width > 0).map(rect => ({ top: rect.top, bottom: rect.bottom }));
  });
}
async function setGlobalFontScale(page: Page, scale: number): Promise<void> {
  await page.locator('#settings-button').click();
  await page.locator('#settings-appearance').click();
  await expect(page.locator('#appearance-settings')).toBeVisible();
  await page.locator('#appearance-page').selectOption('global');
  await page.locator('#appearance-font-scale-number').fill(String(scale));
  await page.locator('#appearance-back').click();
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await page.locator('#menu-dialog [data-slot="dialog-close"]').click();
}

test('真实设备账本在 React 中完成批量成员、记账撤销、设置、结束归档与 PNG 下载', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#demo-badge')).toBeVisible();
  await expect(page.locator('#member-controls')).toHaveCount(0);
  await page.locator('#add-members-button').click();
  await page.locator('#draft-name-0').fill('老酒友');
  await page.locator('#add-members-submit').click();
  await expect(page.locator('#add-members-form')).toHaveCount(0);
  await expect(page.locator('#add-members-button')).toBeFocused();
  const rememberedId = await memberId(page, '老酒友');
  await startSession(page, '今晚的酒局'.repeat(6));
  // 长局名与详情入口合并在单行顶栏，不能额外占用内容空间。 Keep the long session title and details entry in one compact top bar.
  for (const viewport of [{ width: 319, height: 515 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expectCompactSession(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  }
  expect(requireLedger(await snapshot(page)).knownMembers.some(item => item.id === rememberedId)).toBe(true);
  await expect(page.locator('#members-grid [data-select-member]')).toHaveCount(0);
  await page.locator('#add-members-button').click();
  await expect(page.locator('#known-members-0 option')).toHaveAttribute('value', '老酒友');
  await page.locator('#draft-name-0').fill('小柚');
  await page.locator('#draft-pending-0').fill('6');
  await page.locator('#append-member').click();
  await page.locator('#draft-name-1').fill('阿北');
  await page.locator('#draft-pending-1').fill('4');
  await page.locator('#add-members-submit').click();
  await expect(page.locator('#add-members-form')).toHaveCount(0);
  const id = await memberId(page, '小柚');
  const otherId = await memberId(page, '阿北');
  await page.setViewportSize({ width: 319, height: 515 });
  await expect(page.locator('#member-controls')).toHaveCount(0);
  await page.getByTestId(`member-${id}`).click();
  await expect(page.getByTestId(`member-${id}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#member-controls')).toBeVisible();
  await expect(page.locator('#drink-button')).toBeVisible();
  const [rowBox, controlsBox] = await Promise.all([page.getByTestId(`member-${id}`).boundingBox(), page.locator('#member-controls').boundingBox()]);
  if (!rowBox || !controlsBox) throw new Error('酒友行或操作区没有可用的布局尺寸');
  expect(controlsBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(319);
  await page.getByTestId(`member-${id}`).click();
  await expect(page.getByTestId(`member-${id}`)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#member-controls')).toHaveCount(0);
  await page.getByTestId(`member-${otherId}`).click();
  await expect(page.locator('#member-controls')).toHaveCount(1);
  await expect(page.locator('#add-button')).toBeVisible();
  await page.locator('#add-button').click();
  await expect(page.getByTestId(`pending-${otherId}`)).toHaveText('5');
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('6');
  await page.locator('#undo-button').click();
  await expect(page.getByTestId(`pending-${otherId}`)).toHaveText('4');
  await page.getByTestId(`member-${id}`).click();
  await expect(page.locator('#member-controls')).toHaveCount(1);
  await expect(page.locator('#add-button')).toBeVisible();
  await expect(page.getByTestId(`member-${otherId}`)).toHaveAttribute('aria-pressed', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#add-button').click();
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('7');
  await page.locator('#undo-button').click();
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('6');
  await page.locator('#subtract-button').click();
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('5');
  await page.locator('#drink-button').click();
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('3');
  await expect(page.getByTestId(`pending-${otherId}`)).toHaveText('4');
  await page.locator('#mobile-ranking').click();
  await expect(page.getByTestId(`consumed-${id}`)).toHaveText('2');
  await page.locator('#mobile-ledger').click();
  await page.locator('#edit-member-button').click();
  await page.locator('#member-name').fill('小柚子');
  await page.locator('#member-pending').fill('1');
  await page.getByTestId('color-4').check();
  await page.locator('#save-member').click();
  await expect(page.locator('#member-form')).toHaveCount(0);
  await expect(page.locator('#drink-button')).toBeDisabled();
  await page.locator('#undo-button').click();
  await expect(page.getByTestId(`member-${id}`)).toContainText('小柚');
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('3');
  await openSettings(page);
  await page.locator('#settings-step').fill('2');
  await page.locator('#save-settings').click();
  await expect(page.locator('#settings-form')).toHaveCount(0);
  await expect(page.locator('#settings-button')).toBeFocused();
  await page.locator('#add-button').click();
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('5');
  await page.reload();
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('5');
  await expect(page.locator('#undo-button')).toBeDisabled();
  await page.locator('#desktop-settings').click();
  await page.locator('#settings-session').click();
  await expect(page.locator('#settings-form')).toBeVisible();
  await page.locator('#end-session-button').click();
  await page.locator('#confirm-end-session').click();
  await expect(page.locator('#summary-preview')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#summary-download').click();
  const download = await downloadPromise;
  const downloaded = testInfo.outputPath('summary.png');
  await download.saveAs(downloaded);
  expect((await readFile(downloaded)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  await page.locator('[data-slot="dialog-close"]').click();
  await expect(page.locator('#finished-session')).toBeVisible();
  await expect(page.locator('#add-members-button')).toHaveCount(0);
  const saved = requireLedger(await snapshot(page));
  expect(saved.session.members.find(item => item.id === id)).toMatchObject({ pending: 5, consumed: 2, cups: 1 });
  expect(saved.history).toHaveLength(1);
  const results = [{ id, consumed: 2, cups: 1, pending: 5 }, { id: otherId, consumed: 0, cups: 0, pending: 4 }];
  await expectFinishedResults(page, results);
  await page.reload();
  await expect(page.locator('#finished-session')).toBeVisible();
  await expectFinishedResults(page, results);
  await openSettings(page);
  await expect(page.locator('#settings-name')).toBeDisabled();
  await expect(page.locator('#end-session-button')).toHaveCount(0);
  await page.locator('[data-slot="dialog-close"]').click();
  await page.locator('#mobile-history').click();
  const archive = saved.history[0];
  if (!archive) throw new Error('结束后的酒局未归档');
  for (const viewport of [{ width: 319, height: 515 }, { width: 370, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expectHistoryRow(page, archive.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  }
  await setGlobalFontScale(page, 150);
  await page.setViewportSize({ width: 319, height: 515 });
  await page.locator('#mobile-history').click();
  const historyTime = page.getByTestId(`history-time-${archive.id}`);
  await expect(historyTime).toBeVisible();
  expect(new Set((await textRectangles(historyTime)).map(rect => Math.round(rect.top))).size).toBe(1);
  const consumed = page.getByTestId(`history-consumed-${archive.id}`);
  await expect(consumed).toBeVisible();
  expect(new Set((await textRectangles(consumed)).map(rect => Math.round(rect.top))).size).toBe(1);
  const [historyBox, consumedBox] = await Promise.all([page.getByTestId(`history-${archive.id}`).boundingBox(), consumed.boundingBox()]);
  if (!historyBox || !consumedBox) throw new Error('放大字号后的历史条目或已喝数量没有可用的布局尺寸');
  expect(consumedBox.x).toBeGreaterThanOrEqual(historyBox.x);
  expect(consumedBox.x + consumedBox.width).toBeLessThanOrEqual(historyBox.x + historyBox.width);
  expect(consumedBox.y).toBeGreaterThanOrEqual(historyBox.y);
  expect(consumedBox.y + consumedBox.height).toBeLessThanOrEqual(historyBox.y + historyBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(319);
  await page.locator('#mobile-ledger').click();
  await expectFinishedResults(page, results);
  for (const member of results) expect(new Set((await textRectangles(page.getByTestId(`result-pending-${member.id}`))).map(rect => Math.round(rect.top))).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(319);
  await setGlobalFontScale(page, 100);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-history').click();
  await page.getByTestId(`history-${archive.id}`).click();
  await expect(page.getByTestId(`consumed-${id}`)).toHaveText('2');
  // 窄屏历史弹窗不得裁切排行计数。 Narrow history dialogs must not clip ranking counts.
  await page.setViewportSize({ width: 333, height: 505 });
  expect(await page.locator('#history-dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#history-summary-button').click();
  await expect(page.locator('#summary-preview')).toBeVisible();
  await page.locator('[data-slot="dialog-close"]').click();
  await page.locator('#mobile-ledger').click();
  await startSession(page, '好友再聚');
  expect(requireLedger(await snapshot(page)).history).toHaveLength(1);
  await expect(page.getByTestId(`pending-${id}`)).toHaveText('0');
  await expect(page.locator('#member-controls')).toHaveCount(0);
  await page.getByTestId(`member-${id}`).click();
  await page.locator('#edit-member-button').click();
  await page.locator('#delete-member').click();
  await page.locator('#confirm-remove-member').click();
  await expect(page.getByTestId(`member-${id}`)).toHaveCount(0);
  await page.locator('#add-members-button').click();
  await expect(page.locator('#known-members-0 option[value="小柚"]')).toHaveCount(1);
  await page.locator('#draft-name-0').fill('小柚');
  await page.locator('#add-members-submit').click();
  await expect(page.getByTestId(`member-${id}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#nav-ledger')).toBeVisible();
  await expect(page.locator('#leaderboard')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('同设备并发页面同步与冲突保持表单，其他设备隔离', async ({ page, context, browser }) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await startSession(page, '并发验证');
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('#session-title')).toHaveText('并发验证');
  await page.locator('#add-members-button').click();
  await page.locator('#draft-name-0').fill('并发甲');
  await second.locator('#add-members-button').click();
  await second.locator('#draft-name-0').fill('并发乙');
  await second.locator('#add-members-submit').click();
  await expect(second.locator('#add-members-form')).toHaveCount(0);
  await page.locator('#add-members-submit').click();
  await expect(page.getByTestId('form-error')).toContainText('另一页面已更新记录');
  await expect(page.locator('#draft-name-0')).toHaveValue('并发甲');
  await page.locator('#add-members-submit').click();
  await expect(page.locator('#add-members-form')).toHaveCount(0);
  expect(requireLedger(await snapshot(page)).session.members).toHaveLength(2);
  await second.bringToFront();
  await second.reload();
  await expect(second.locator('#members-grid [data-select-member]')).toHaveCount(2);
  await context.setOffline(true);
  await page.bringToFront();
  await openSettings(page);
  await page.locator('[data-slot="dialog-close"]').click();
  await expect(page.locator('#integration-error')).toContainText('同步失败');
  await context.setOffline(false);
  await expect(page.locator('#integration-error')).toHaveCount(0);
  const independent = await browser.newContext({ baseURL: 'http://127.0.0.1:4186' });
  const other = await independent.newPage();
  await other.goto('http://127.0.0.1:4186/');
  await expect(other.locator('#demo-badge')).toBeVisible();
  expect(requireLedger(await snapshot(other)).session.demo).toBe(true);
  await independent.close();
});
