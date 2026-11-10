import { test, expect, type Page } from '@playwright/test';
import { DEVICE_KEY } from '../../src/client/server-storage.ts';
import { addMembers, addPending, createSession } from '../../src/shared/domain.ts';
import { startNextSession, withLedgerSession } from '../../src/shared/persistence.ts';
import { decodeSnapshot } from '../../src/shared/protocol.ts';
import { requireLedger } from '../../src/shared/values.ts';
import type { Ledger, Snapshot } from '../../src/shared/types.ts';

async function snapshot(page: Page): Promise<Snapshot> {
  const id = await page.evaluate(key => localStorage.getItem(key), DEVICE_KEY);
  if (!id) throw new Error('浏览器未创建设备标识');
  const response = await page.request.get('/api/ledger', { headers: { 'X-Device-ID': id } });
  expect(response.ok()).toBe(true);
  return decodeSnapshot(await response.json());
}
async function save(page: Page, ledger: Ledger): Promise<void> {
  const before = await snapshot(page);
  const id = await page.evaluate(key => localStorage.getItem(key), DEVICE_KEY);
  if (!id) throw new Error('浏览器未创建设备标识');
  const response = await page.request.put('/api/ledger', {
    headers: { 'X-Device-ID': id, 'X-Request-ID': crypto.randomUUID(), Origin: new URL(page.url()).origin },
    data: { ledger, revision: before.revision, generation: before.generation },
  });
  expect(response.ok()).toBe(true);
}
async function seed(page: Page): Promise<Ledger> {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const now = Date.now() - 1000;
  const session = addMembers(createSession({ title: '编辑原局', cupSize: 2, round: 1, members: [] }, now), [{ name: '甲', pending: 6 }, { name: '乙', pending: 2 }], [], { memberIds: ['alice', 'bob'], eventIds: ['add-alice', 'add-bob'], at: now + 1 });
  const ledger = withLedgerSession({ version: 2, session, step: 1, history: [], knownMembers: [] }, session, {});
  await save(page, ledger);
  await page.reload();
  await expect(page.locator('#session-title')).toHaveText('编辑原局');
  await page.getByTestId('member-alice').click();
  await page.locator('#edit-member-button').click();
  await page.locator('#member-name').fill('甲的新昵称');
  return ledger;
}

for (const scenario of ['new-session', 'changed-member'] as const) {
  test(`过时成员编辑遇到 ${scenario} 不得覆盖新计数，关闭重开后可保存`, async ({ page }) => {
    const original = await seed(page);
    const changed = scenario === 'new-session'
      ? startNextSession(original, { title: '另一页新局', cupSize: 3, members: original.session.members }, Date.now(), 'archive')
      : withLedgerSession(original, addPending(original.session, 'alice', 3, { id: 'other-page-add', at: Date.now() }), {});
    await save(page, changed);
    await page.locator('#save-member').click();
    await expect(page.getByTestId('form-error')).toContainText('另一页面已更新记录');
    await expect(page.locator('#member-name')).toHaveValue('甲的新昵称');
    const before = await snapshot(page);
    await page.locator('#save-member').click();
    await expect(page.getByTestId('form-error')).toContainText(scenario === 'new-session' ? '当前酒局已变更' : '记录已更新');
    expect(await snapshot(page)).toEqual(before);
    expect(requireLedger(before)).toEqual(changed);
    await page.keyboard.press('Escape');
    await expect(page.locator('#edit-dialog')).toHaveCount(0);
    // 切换酒局会清除选择，同局则保留选择。 Switching sessions clears selection; the same session retains it.
    if (scenario === 'new-session') await page.getByTestId('member-alice').click();
    await page.locator('#edit-member-button').click();
    await expect(page.locator('#member-pending')).toHaveValue(scenario === 'new-session' ? '0' : '9');
    await page.locator('#member-name').fill('重新确认昵称');
    await page.locator('#save-member').click();
    await expect(page.locator('#edit-dialog')).toHaveCount(0);
    expect(requireLedger(await snapshot(page)).session.members.find(member => member.id === 'alice')).toMatchObject({ name: '重新确认昵称', pending: scenario === 'new-session' ? 0 : 9 });
  });
}

test('成员编辑冲突只涉及他人时可重试，保留他人的最新计数', async ({ page }) => {
  const original = await seed(page);
  const changed = withLedgerSession(original, addPending(original.session, 'bob', 3, { id: 'other-page-add', at: Date.now() }), {});
  await save(page, changed);
  await page.locator('#save-member').click();
  await expect(page.getByTestId('form-error')).toContainText('另一页面已更新记录');
  await page.locator('#save-member').click();
  await expect(page.locator('#edit-dialog')).toHaveCount(0);
  const saved = requireLedger(await snapshot(page));
  expect(saved.session.members.find(member => member.id === 'alice')).toMatchObject({ name: '甲的新昵称', pending: 6 });
  expect(saved.session.members.find(member => member.id === 'bob')).toMatchObject({ name: '乙', pending: 5 });
});
