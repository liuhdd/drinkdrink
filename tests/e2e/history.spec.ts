import { test, expect, type Page } from '@playwright/test';
import { DEVICE_KEY } from '../../src/client/server-storage.ts';
import { decodeSnapshot } from '../../src/shared/protocol.ts';
import { at, requireLedger } from '../../src/shared/values.ts';

async function snapshot(page: Page) {
  const device = await page.evaluate(key => localStorage.getItem(key), DEVICE_KEY);
  if (!device) throw new Error('设备标识未创建');
  const response = await page.request.get('/api/ledger', { headers: { 'X-Device-ID': device } });
  expect(response.ok()).toBe(true);
  return decodeSnapshot(await response.json());
}
async function openNew(page: Page, title: string) {
  await page.locator('#desktop-settings').click();
  await page.locator('#settings-session').click();
  await page.locator('#new-session-button').click();
  await page.locator('#new-session-name').fill(title);
}
async function start(page: Page, title: string) {
  await openNew(page, title);
  await page.locator('#confirm-new-session').click();
  await expect(page.locator('#session-form')).toHaveCount(0);
  await expect(page.locator('#session-title')).toHaveText(title);
}
async function add(page: Page) {
  await page.locator('#add-members-button').click();
  await page.locator('#draft-name-0').fill('酒友甲');
  await page.locator('#draft-pending-0').fill('6');
  await page.locator('#add-members-submit').click();
  await expect(page.locator('#add-members-form')).toHaveCount(0);
  return at(requireLedger(await snapshot(page)).session.members, 0).id;
}
async function openDelete(page: Page, id: string) {
  await page.locator('#mobile-history').click();
  await page.getByTestId(`history-${id}`).click();
  await page.locator('#delete-history-button').click();
  await expect(page.locator('#delete-history-form')).toBeVisible();
}

test('正式局直接新开后保留上一局计数和记录，历史刷新不丢失', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await start(page, '第一局');
  const member = await add(page);
  await page.getByTestId(`member-${member}`).click();
  await page.locator('#drink-button').click();
  await expect(page.getByTestId(`pending-${member}`)).toHaveText('4');
  const before = requireLedger(await snapshot(page));
  await start(page, '第二局');
  const saved = requireLedger(await snapshot(page));
  expect(saved.history).toHaveLength(1);
  const archive = at(saved.history, 0);
  expect(archive.session.members).toEqual(before.session.members);
  expect(archive.session.events).toEqual(before.session.events);
  expect(saved.session.members).toEqual(before.session.members.map(item => ({ ...item, pending: 0, consumed: 0, cups: 0 })));
  await expect(page.locator('#member-controls')).toHaveCount(0);
  await page.locator('#mobile-history').click();
  await page.getByTestId(`history-${archive.id}`).click();
  await expect(page.getByTestId(`consumed-${member}`)).toHaveText('2');
  await expect(page.locator('#history-dialog #activity-list > div')).toHaveCount(before.session.events.length);
  await page.reload();
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#mobile-history').click();
  await expect(page.getByTestId(`history-${archive.id}`)).toBeVisible();
  expect(requireLedger(await snapshot(page)).history).toEqual(saved.history);
});

test('空局不归档，历史删除确认可取消，离线保留并重试，刷新后不恢复', async ({ page, context }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await start(page, '空局');
  await start(page, '有记录的酒局');
  expect(requireLedger(await snapshot(page)).history).toHaveLength(0);
  const member = await add(page);
  await start(page, '当前酒局');
  const before = requireLedger(await snapshot(page));
  const archive = at(before.history, 0);
  await openDelete(page, archive.id);
  await page.getByTestId('cancel-dialog').click();
  await expect(page.locator('#history-dialog')).toBeVisible();
  expect(requireLedger(await snapshot(page))).toEqual(before);
  await page.locator('#delete-history-button').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#delete-history-dialog')).toHaveCount(0);
  await expect(page.getByTestId(`history-${archive.id}`)).toBeFocused();
  await openDelete(page, archive.id);
  for (const viewport of [{ width: 319, height: 515 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const modal = page.locator('#delete-history-dialog');
    expect(await modal.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('#confirm-delete-history')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`delete-confirm-${viewport.width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setOffline(true);
  await page.locator('#confirm-delete-history').click();
  await expect(page.getByTestId('form-error')).toContainText('无法连接记录服务');
  await expect(page.locator('#delete-history-dialog')).toBeVisible();
  await expect(page.getByTestId(`history-${archive.id}`)).toHaveCount(1);
  await context.setOffline(false);
  await page.locator('#confirm-delete-history').click();
  await expect(page.locator('#delete-history-dialog')).toHaveCount(0);
  await expect(page.getByTestId(`history-${archive.id}`)).toHaveCount(0);
  await expect(page.locator('#settings-button')).toBeFocused();
  expect(requireLedger(await snapshot(page))).toEqual({ ...before, history: [] });
  await page.locator('#mobile-ledger').click();
  await page.getByTestId(`member-${member}`).click();
  await page.locator('#add-button').click();
  await expect(page.getByTestId(`pending-${member}`)).toHaveText('1');
  await page.locator('#undo-button').click();
  await expect(page.getByTestId(`pending-${member}`)).toHaveText('0');
  expect(requireLedger(await snapshot(page)).history).toHaveLength(0);
  await page.reload();
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#mobile-history').click();
  await expect(page.locator('#history-list button')).toHaveCount(0);
});

test('删除已结束本局的历史不解锁计数，新开局不重新生成已删历史', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await start(page, '结束后删除');
  await add(page);
  await page.locator('#desktop-settings').click();
  await page.locator('#settings-session').click();
  await page.locator('#end-session-button').click();
  await page.locator('#confirm-end-session').click();
  await expect(page.locator('#summary-preview')).toBeVisible();
  await page.locator('[data-slot="dialog-close"]').click();
  const before = requireLedger(await snapshot(page));
  await openDelete(page, at(before.history, 0).id);
  const puts: string[] = [];
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith('/api/ledger')) puts.push(request.url()); });
  // 同一事件循环双提交必须只有一次持久化。 Two submissions in one event loop must persist only once.
  await page.locator('#delete-history-form').evaluate(form => { if (!(form instanceof HTMLFormElement)) throw new Error('删除表单不存在'); form.requestSubmit(); form.requestSubmit(); });
  await expect(page.locator('#delete-history-form')).toHaveCount(0);
  expect(puts).toHaveLength(1);
  expect(requireLedger(await snapshot(page))).toEqual({ ...before, history: [] });
  await page.reload();
  await expect(page.locator('#finished-session')).toBeVisible();
  await expect(page.locator('#add-members-button')).toHaveCount(0);
  await expect(page.locator('#members-grid button')).toHaveCount(0);
  await start(page, '下一局');
  expect(requireLedger(await snapshot(page)).history).toHaveLength(0);
});

test('跨页删除冲突不覆盖更新，重新确认只删指定历史；新开局冲突不误开另一局', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await start(page, '第一局');
  const member = await add(page);
  await start(page, '第二局');
  const archive = at(requireLedger(await snapshot(page)).history, 0);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('#session-title')).toHaveText('第二局');
  await openDelete(page, archive.id);
  await second.getByTestId(`member-${member}`).click();
  await second.locator('#add-button').click();
  await expect(second.getByTestId(`pending-${member}`)).toHaveText('1');
  await page.locator('#confirm-delete-history').click();
  await expect(page.getByTestId('form-error')).toContainText('另一页面已更新记录');
  await expect(page.locator('#delete-history-form')).toBeVisible();
  await page.locator('#confirm-delete-history').click();
  await expect(page.locator('#delete-history-form')).toHaveCount(0);
  const saved = requireLedger(await snapshot(page));
  expect(saved.history).toHaveLength(0);
  expect(at(saved.session.members, 0).pending).toBe(1);
  await openNew(page, '待确认新局');
  await second.reload();
  await expect(second.locator('#workspace')).toBeVisible();
  await start(second, '另一页面的新局');
  await page.locator('#confirm-new-session').click();
  await expect(page.getByTestId('form-error')).toContainText('另一页面已更新记录');
  await expect(page.locator('#new-session-name')).toHaveValue('待确认新局');
  await page.locator('#confirm-new-session').click();
  await expect(page.getByTestId('form-error')).toContainText('当前酒局已切换');
  expect(requireLedger(await snapshot(page)).session.title).toBe('另一页面的新局');
  expect(requireLedger(await snapshot(page)).history).toHaveLength(1);
  await page.getByTestId('cancel-dialog').click();
  await expect(page.locator('#session-form')).toHaveCount(0);
});

test('新开局断网不丢本局或表单，恢复后双提交只归档一次', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await start(page, '断网前的酒局');
  await add(page);
  const before = await snapshot(page);
  await openNew(page, '保留输入的新局');
  await page.locator('#new-session-cup').fill('3');
  await context.setOffline(true);
  await page.locator('#confirm-new-session').click();
  await expect(page.getByTestId('form-error')).toContainText('无法连接记录服务');
  await expect(page.locator('#new-session-name')).toHaveValue('保留输入的新局');
  await expect(page.locator('#new-session-cup')).toHaveValue('3');
  await expect(page.locator('#session-title')).toHaveText('断网前的酒局');
  await context.setOffline(false);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#session-form').evaluate(form => { if (!(form instanceof HTMLFormElement)) throw new Error('新局表单不存在'); form.requestSubmit(); form.requestSubmit(); });
  await expect(page.locator('#session-form')).toHaveCount(0);
  const saved = await snapshot(page);
  expect(saved.revision).toBe(before.revision + 1);
  expect(requireLedger(saved).history).toHaveLength(1);
  expect(at(requireLedger(saved).history, 0).session.members).toEqual(requireLedger(before).session.members);
  expect(requireLedger(saved).session.title).toBe('保留输入的新局');
  expect(requireLedger(saved).session.cupSize).toBe(3);
});
