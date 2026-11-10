import { test, expect, type Page } from '@playwright/test';
import { DEVICE_KEY } from '../../src/client/server-storage.ts';
import { APPEARANCE_STORAGE_KEY } from '../../src/client/appearance-storage.ts';
import { DEFAULT_APPEARANCE } from '../../src/shared/appearance.ts';
import { addMembers, addPending, completeCup, createSession } from '../../src/shared/domain.ts';
import { finishSession, startNextSession, withLedgerSession } from '../../src/shared/persistence.ts';
import { decodeSnapshot } from '../../src/shared/protocol.ts';
import { requireLedger } from '../../src/shared/values.ts';
import type { Ledger, Snapshot } from '../../src/shared/types.ts';

async function deviceId(page: Page): Promise<string> {
  const id = await page.evaluate(key => localStorage.getItem(key), DEVICE_KEY);
  if (!id) throw new Error('浏览器未创建匿名设备标识');
  return id;
}
async function snapshot(page: Page): Promise<Snapshot> {
  const response = await page.request.get('/api/ledger', { headers: { 'X-Device-ID': await deviceId(page) } });
  expect(response.ok()).toBe(true);
  return decodeSnapshot(await response.json());
}
async function save(page: Page, ledger: Ledger): Promise<void> {
  const previous = await snapshot(page);
  const response = await page.request.put('/api/ledger', {
    headers: { 'X-Device-ID': await deviceId(page), 'X-Request-ID': crypto.randomUUID(), Origin: new URL(page.url()).origin },
    data: { ledger, revision: previous.revision, generation: previous.generation },
  });
  expect(response.ok()).toBe(true);
}
async function seed(page: Page): Promise<Ledger> {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const now = Date.now() - 10_000;
  const session = addMembers(createSession({ title: '已结束的上一局', cupSize: 2, round: 1, members: [] }, now), [{ name: '小柚', pending: 6 }, { name: '阿北', pending: 4 }], [], { memberIds: ['alice', 'bob'], eventIds: ['initial-alice', 'initial-bob'], at: now + 1 });
  const previous = finishSession({ version: 2, session: completeCup(session, 'alice', { id: 'previous-cup', at: now + 2 }), step: 1, history: [], knownMembers: [] }, now + 3, 'previous-session');
  const started = startNextSession(previous, { title: '删除酒友验证', cupSize: 2, members: previous.session.members }, now + 4, 'unused');
  const pending = addPending(started.session, 'alice', 6, { id: 'pending-alice', at: now + 5 });
  const ledger = withLedgerSession(started, completeCup(pending, 'alice', { id: 'current-cup', at: now + 6 }), {});
  await save(page, ledger);
  await page.reload();
  await expect(page.locator('#session-title')).toHaveText(ledger.session.title);
  return requireLedger(await snapshot(page));
}
async function edit(page: Page, id: string): Promise<void> {
  await page.getByTestId(`member-${id}`).click();
  await page.locator('#edit-member-button').click();
  await expect(page.locator('#edit-dialog')).toBeVisible();
  await expect(page.locator('#member-name')).toBeFocused();
}

test('酒友编辑顶部可见删除入口，取消不写入，删除保留历史并支持撤销和刷新', async ({ page }, testInfo) => {
  const original = await seed(page);
  for (const viewport of [{ width: 319, height: 515 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await edit(page, 'alice');
    await expect(page.locator('#delete-member')).toBeInViewport();
    expect(await page.locator('#edit-dialog').evaluate(element => element.scrollTop)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`edit-member-${viewport.width}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.locator('#edit-dialog')).toHaveCount(0);
    await page.getByTestId('member-alice').click();
  }
  await page.setViewportSize({ width: 319, height: 515 });
  await edit(page, 'alice');
  await page.locator('#member-name').fill('');
  await page.locator('#member-pending').fill('-1');
  await page.locator('#delete-member').click();
  await expect(page.locator('#remove-form')).toBeVisible();
  const beforeCancel = await snapshot(page);
  await page.getByTestId('cancel-dialog').click();
  await expect(page.locator('#remove-form')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(beforeCancel);
  await page.locator('#edit-member-button').click();
  await page.locator('#delete-member').click();
  await page.screenshot({ path: testInfo.outputPath('delete-member-confirmation.png') });
  await page.locator('#confirm-remove-member').click();
  await expect(page.getByTestId('member-alice')).toHaveCount(0);
  await expect(page.locator('#member-controls')).toHaveCount(0);
  const removed = requireLedger(await snapshot(page));
  expect(removed.session.members).toEqual(original.session.members.filter(member => member.id !== 'alice'));
  expect(removed.session.events).toEqual(original.session.events);
  expect(removed.history).toEqual(original.history);
  expect(removed.knownMembers).toEqual(original.knownMembers);
  await page.locator('#undo-button').click();
  await expect(page.getByTestId('member-alice')).toBeVisible();
  expect(requireLedger(await snapshot(page)).session).toEqual(original.session);
  await page.locator('#edit-member-button').click();
  await page.locator('#delete-member').click();
  await page.locator('#confirm-remove-member').click();
  await expect(page.getByTestId('member-alice')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#member-count')).toHaveText('1');
  await expect(page.locator('#undo-button')).toBeDisabled();
  await page.locator('#add-members-button').click();
  await expect(page.locator('#known-members-0 option[value="小柚"]')).toHaveCount(1);
  await page.getByTestId('cancel-dialog').click();
  await edit(page, 'bob');
  await page.locator('#delete-member').click();
  await page.locator('#confirm-remove-member').click();
  await expect(page.locator('#member-count')).toHaveText('0');
  expect(requireLedger(await snapshot(page)).history).toEqual(original.history);
  await page.locator('#undo-button').click();
  await expect(page.getByTestId('member-bob')).toBeVisible();
});

test('矮屏放大字号和按钮后无需滚动即可发现酒友删除入口', async ({ page }, testInfo) => {
  await seed(page);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: APPEARANCE_STORAGE_KEY, value: { ...DEFAULT_APPEARANCE, regions: { 'member-dialog': { ...DEFAULT_APPEARANCE.global, fontScale: 150, buttonScale: 130 } } } });
  await page.reload();
  await page.setViewportSize({ width: 319, height: 515 });
  await edit(page, 'alice');
  await expect(page.locator('#delete-member')).toBeInViewport();
  expect(await page.locator('#edit-dialog').evaluate(element => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(319);
  await page.screenshot({ path: testInfo.outputPath('edit-member-large-appearance.png') });
});

test('删除冲突后可重试，保留另一位酒友的最新记录且不重复提交', async ({ page }) => {
  const original = await seed(page);
  await edit(page, 'alice');
  await page.locator('#delete-member').click();
  const changed = withLedgerSession(original, addPending(original.session, 'bob', 3, { id: 'other-page-add', at: Date.now() }), {});
  await save(page, changed);
  await page.locator('#confirm-remove-member').click();
  await expect(page.getByTestId('form-error')).toContainText('另一页面已更新记录');
  expect(requireLedger(await snapshot(page))).toEqual(changed);
  const before = await snapshot(page);
  await page.locator('#confirm-remove-member').evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('确认删除入口不是按钮');
    button.click(); button.click();
  });
  await expect(page.locator('#remove-form')).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(requireLedger(after).session.members).toEqual(changed.session.members.filter(member => member.id !== 'alice'));
  expect(requireLedger(after).session.events).toEqual(changed.session.events);
});

for (const scenario of ['new-session', 'changed-member', 'ended-session', 'removed-member'] as const) {
  test(`删除确认遇到 ${scenario} 后阻止过时重试，服务端记录不变`, async ({ page }) => {
    const original = await seed(page);
    await edit(page, 'alice');
    await page.locator('#delete-member').click();
    const now = Date.now();
    const changed = scenario === 'new-session'
      ? startNextSession(original, { title: '另一页面的新酒局', cupSize: 2, members: original.session.members }, now, 'new-archive')
      : scenario === 'changed-member'
        ? withLedgerSession(original, addPending(original.session, 'alice', 1, { id: 'updated-alice', at: now }), {})
        : scenario === 'ended-session'
          ? finishSession(original, now, 'ended-archive')
          : withLedgerSession(original, { ...original.session, members: original.session.members.filter(member => member.id !== 'alice') }, {});
    await save(page, changed);
    await page.locator('#confirm-remove-member').click();
    await expect(page.getByTestId('form-error')).toContainText('另一页面已更新记录');
    const before = await snapshot(page);
    await page.locator('#confirm-remove-member').click();
    await expect(page.getByTestId('form-error')).toContainText(scenario === 'new-session' ? '当前酒局已变更' : scenario === 'changed-member' ? '记录已更新' : scenario === 'ended-session' ? '本局已结束' : '已不在本局');
    expect(await snapshot(page)).toEqual(before);
    expect(requireLedger(before)).toEqual(changed);
    await page.keyboard.press('Escape');
    await expect(page.locator('#remove-form')).toHaveCount(0);
  });
}
