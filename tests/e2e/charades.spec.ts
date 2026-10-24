import { test, expect, type Page } from '@playwright/test';

async function openCharades(page: Page): Promise<void> {
  await page.locator('#mobile-tools').click();
  await page.locator('#tool-charades').click();
  await expect(page.locator('#charades-tool')).toBeVisible();
  await expect(page.locator('#charades-question')).toHaveAttribute('data-question-id', /\S+/);
}

async function questionId(page: Page): Promise<string> {
  const id = await page.locator('#charades-question').getAttribute('data-question-id');
  if (!id) throw new Error('你比划我猜没有显示有效的题目标识');
  return id;
}

test('工具列表展示图标与名称，随机题目不重复且返回和刷新保留设备进度', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const ledgerWrites: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method());
  });
  await page.locator('#mobile-tools').click();
  await expect(page.locator('#tool-dice')).toHaveAccessibleName(/骰子/);
  await expect(page.locator('#tool-charades')).toHaveAccessibleName(/你比划我猜/);
  await expect(page.locator('#tool-dice svg[aria-hidden="true"]').first()).toBeVisible();
  await expect(page.locator('#tool-charades svg[aria-hidden="true"]').first()).toBeVisible();
  await expect(page.locator('#dice-scene')).toHaveCount(0);
  await expect(page.locator('#charades-tool')).toHaveCount(0);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('#tool-dice')).toBeInViewport();
    await expect(page.locator('#tool-charades')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.screenshot({ path: testInfo.outputPath('tools-mobile.png'), fullPage: true });
  await page.locator('#tool-dice').click();
  await expect(page.locator('#dice-scene')).toBeVisible();
  await page.locator('#tools-back').click();
  await expect(page.locator('#tool-charades')).toBeVisible();
  await page.locator('#tool-charades').click();
  await expect(page.locator('#charades-question')).toHaveAttribute('data-question-id', /\S+/);
  await expect(page.locator('#charades-progress')).toHaveAttribute('data-drawn', '1');
  await expect(page.locator('#charades-progress')).toHaveAttribute('data-round', '1');
  await expect(page.locator('#charades-progress')).toContainText(/1\s*[/／]\s*1000/);
  const seen = new Set<string>([await questionId(page)]);
  for (let drawn = 2; drawn <= 6; drawn++) {
    const previous = await questionId(page);
    await page.locator('#charades-next').click();
    await expect(page.locator('#charades-question')).not.toHaveAttribute('data-question-id', previous);
    const current = await questionId(page);
    expect(seen.has(current)).toBe(false);
    seen.add(current);
    await expect(page.locator('#charades-progress')).toHaveAttribute('data-drawn', String(drawn));
  }
  const current = await questionId(page);
  await page.locator('#tools-back').click();
  await page.locator('#tool-charades').click();
  await expect(page.locator('#charades-question')).toHaveAttribute('data-question-id', current);
  await page.locator('#mobile-ledger').click();
  await openCharades(page);
  await expect(page.locator('#charades-question')).toHaveAttribute('data-question-id', current);
  await page.reload();
  await expect(page.locator('#workspace')).toBeVisible();
  await openCharades(page);
  await expect(page.locator('#charades-question')).toHaveAttribute('data-question-id', current);
  await expect(page.locator('#charades-progress')).toHaveAttribute('data-drawn', '6');
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('#charades-next')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath('charades-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#charades-next')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: testInfo.outputPath('charades-desktop.png'), fullPage: true });
  await page.locator('#tools-back').click();
  await expect(page.locator('#tool-dice')).toBeInViewport();
  await expect(page.locator('#tool-charades')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('tools-desktop.png'), fullPage: true });
  expect(ledgerWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test('离线下一题保留当前题，重新连接后恢复进度并继续出题', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await openCharades(page);
  const current = await questionId(page);
  await context.setOffline(true);
  await page.locator('#charades-next').click();
  await expect(page.locator('#charades-error')).toBeVisible();
  await expect(page.locator('#charades-question')).toHaveAttribute('data-question-id', current);
  await expect(page.locator('#charades-progress')).toHaveAttribute('data-drawn', '1');
  await expect(page.locator('#charades-next')).toBeDisabled();
  await context.setOffline(false);
  await page.locator('#charades-retry').click();
  await expect(page.locator('#charades-error')).toHaveCount(0);
  await expect(page.locator('#charades-question')).toHaveAttribute('data-question-id', current);
  await expect(page.locator('#charades-progress')).toHaveAttribute('data-drawn', '1');
  await page.locator('#charades-next').click();
  await expect(page.locator('#charades-question')).not.toHaveAttribute('data-question-id', current);
  await expect(page.locator('#charades-progress')).toHaveAttribute('data-drawn', '2');
  expect(errors).toEqual([]);
});

test('同设备多页冲突保留原题，重新连接同步服务端当前题且不跳过题目', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  await openCharades(page);
  const first = await questionId(page);
  const second = await context.newPage();
  second.on('pageerror', error => errors.push(error.message));
  await second.goto('/');
  await expect(second.locator('#workspace')).toBeVisible();
  await openCharades(second);
  await expect(second.locator('#charades-question')).toHaveAttribute('data-question-id', first);
  await page.locator('#charades-next').click();
  await expect(page.locator('#charades-question')).not.toHaveAttribute('data-question-id', first);
  const current = await questionId(page);
  await second.locator('#charades-next').click();
  await expect(second.locator('#charades-error')).toBeVisible();
  await expect(second.locator('#charades-question')).toHaveAttribute('data-question-id', first);
  await expect(second.locator('#charades-progress')).toHaveAttribute('data-drawn', '1');
  await second.locator('#charades-retry').click();
  await expect(second.locator('#charades-error')).toHaveCount(0);
  await expect(second.locator('#charades-question')).toHaveAttribute('data-question-id', current);
  await expect(second.locator('#charades-progress')).toHaveAttribute('data-drawn', '2');
  await second.locator('#charades-next').click();
  await expect(second.locator('#charades-question')).not.toHaveAttribute('data-question-id', current);
  expect(await questionId(second)).not.toBe(first);
  await expect(second.locator('#charades-progress')).toHaveAttribute('data-drawn', '3');
  expect(errors).toEqual([]);
});
