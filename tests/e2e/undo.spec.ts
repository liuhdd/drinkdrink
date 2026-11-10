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
async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#desktop-settings').click();
  await page.locator('#settings-session').click();
  await page.locator('#new-session-button').click();
  await page.locator('#confirm-new-session').click();
  await expect(page.locator('#session-form')).toHaveCount(0);
}
async function add(page: Page, name: string) {
  await page.locator('#add-members-button').click();
  await page.locator('#draft-name-0').fill(name);
  await page.locator('#add-members-submit').click();
  await expect(page.locator('#add-members-form')).toHaveCount(0);
}

test('撤销改名不能与新记住的酒友重名，失败不保存也不消耗撤销记录', async ({ page }) => {
  await start(page);
  await add(page, 'Alice');
  const alice = at(requireLedger(await snapshot(page)).session.members, 0);
  await page.getByTestId(`member-${alice.id}`).click();
  await page.locator('#edit-member-button').click();
  await page.locator('#member-name').fill('Carol');
  await page.locator('#save-member').click();
  await expect(page.locator('#member-form')).toHaveCount(0);
  await add(page, 'Alice');
  await page.locator('#undo-button').click();
  await expect(page.locator('#member-count')).toHaveText('1');
  const before = await snapshot(page);
  expect(requireLedger(before).knownMembers.map(member => member.name).sort()).toEqual(['Alice', 'Carol']);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('#undo-button').click();
    await expect(page.locator('#integration-error')).toContainText('无法撤销');
    await expect(page.locator('#integration-error')).toContainText('Alice');
    await expect(page.locator('#undo-button')).toBeEnabled();
    expect(await snapshot(page)).toEqual(before);
  }
});

test('撤销仅保留最近 30 次操作且刷新清空撤销记录但保留计数', async ({ page }) => {
  test.setTimeout(60_000);
  await start(page);
  await add(page, 'Alice');
  const alice = at(requireLedger(await snapshot(page)).session.members, 0);
  await page.getByTestId(`member-${alice.id}`).click();
  for (let count = 1; count <= 31; count++) {
    await page.locator('#add-button').click();
    await expect(page.getByTestId(`pending-${alice.id}`)).toHaveText(String(count));
  }
  for (let count = 30; count >= 1; count--) {
    await page.locator('#undo-button').click();
    await expect(page.getByTestId(`pending-${alice.id}`)).toHaveText(String(count));
  }
  await expect(page.locator('#undo-button')).toBeDisabled();
  await page.locator('#add-button').click();
  await expect(page.getByTestId(`pending-${alice.id}`)).toHaveText('2');
  await expect(page.locator('#undo-button')).toBeEnabled();
  const before = await snapshot(page);
  await page.reload();
  await expect(page.getByTestId(`pending-${alice.id}`)).toHaveText('2');
  await expect(page.locator('#undo-button')).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
});
