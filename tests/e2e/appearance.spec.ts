import { test, expect, type Page } from '@playwright/test';
import { APPEARANCE_STORAGE_KEY } from '../../src/client/appearance-storage.ts';
import { DEFAULT_APPEARANCE, parseAppearanceSettings, type AppearanceColors, type AppearanceSettings } from '../../src/shared/appearance.ts';
import { expectUnobscuredDice } from './dice-assertions.ts';

async function storedAppearance(page: Page): Promise<AppearanceSettings> {
  const raw = await page.evaluate(key => localStorage.getItem(key), APPEARANCE_STORAGE_KEY);
  if (raw === null) throw new Error('浏览器尚未保存外观设置');
  return parseAppearanceSettings(JSON.parse(raw));
}

async function openAppearance(page: Page): Promise<void> {
  await page.locator('#settings-button').click();
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await expect(page.locator('#settings-session')).toBeVisible();
  await page.locator('#settings-appearance').click();
  await expect(page.locator('#appearance-settings')).toBeVisible();
  await expect(page.locator('#appearance-title')).toBeFocused();
}

async function leaveAppearance(page: Page): Promise<void> {
  await page.locator('#appearance-back').click();
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await page.locator('#menu-dialog [data-slot="dialog-close"]').click();
  await page.locator('#session-title').hover();
}

interface Rgba { red: number; green: number; blue: number; alpha: number; }

// 用浏览器原生画布解析实际 CSS 颜色，避免依赖 oklab/rgb 的序列化格式。 Parse computed CSS colors with native canvas rather than depending on oklab/rgb serialization.
function cssColors(values: readonly string[]): Rgba[] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建用于读取界面颜色的画布');
  return values.map(value => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return { red: pixel[0]!, green: pixel[1]!, blue: pixel[2]!, alpha: pixel[3]! };
  });
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const luminance = (color: Rgba): number => {
    const channels = [color.red, color.green, color.blue].map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  return (Math.max(luminance(first), luminance(second)) + 0.05) / (Math.min(luminance(first), luminance(second)) + 0.05);
}

async function renderedTextContrast(page: Page, textSelector: string, backgroundSelector: string): Promise<number> {
  const text = page.locator(textSelector);
  await text.scrollIntoViewIfNeeded();
  const foreground = (await page.evaluate(cssColors, [await text.evaluate(element => getComputedStyle(element).color)]))[0]!;
  const textBox = await text.boundingBox();
  const backgroundBox = await page.locator(backgroundSelector).boundingBox();
  if (!textBox || !backgroundBox) throw new Error(`无法读取配色检查区域尺寸：${textSelector} / ${backgroundSelector}`);
  // 读取正文旁的真实合成像素，包含毛玻璃与下层内容。 Sample the rendered background beside the text, including blur and underlying content.
  const screenshot = await page.screenshot({ clip: { x: backgroundBox.x + backgroundBox.width - 3, y: textBox.y + textBox.height / 2, width: 1, height: 1 }, animations: 'disabled', caret: 'hide', scale: 'css' });
  const background = await page.evaluate(async base64 => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    if (!response.ok) throw new Error(`无法解码配色检查截图：HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建用于读取实际底色的画布');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return { red: pixel[0]!, green: pixel[1]!, blue: pixel[2]!, alpha: pixel[3]! };
  }, screenshot.toString('base64'));
  return contrastRatio(foreground, background);
}

function expectSameRgb(actual: Rgba, expected: Rgba): void {
  for (const channel of ['red', 'green', 'blue'] as const) {
    expect(Math.abs(actual[channel] - expected[channel]), `${channel}通道应与目标底色一致`).toBeLessThanOrEqual(1);
  }
}

async function expectNewDialogPalette(page: Page, colors: AppearanceColors): Promise<void> {
  await page.locator('#settings-button').click();
  await page.locator('#settings-session').click();
  await page.locator('#new-session-button').click();
  await expect(page.locator('#new-dialog')).toBeVisible();
  await page.locator('#new-dialog [data-slot="dialog-title"]').hover();
  const styles = await page.locator('[data-slot="dialog-overlay"]').evaluate(overlay => {
    const dialog = document.getElementById('new-dialog');
    const primary = document.getElementById('confirm-new-session');
    if (!dialog || !primary) throw new Error('新局弹窗或确认按钮不存在，无法检查实际配色');
    return [getComputedStyle(overlay).backgroundColor, getComputedStyle(document.body).backgroundColor, getComputedStyle(dialog).backgroundColor, getComputedStyle(primary).backgroundColor];
  });
  const actual = await page.evaluate(cssColors, [...styles, colors.surface, colors.accent]);
  expectSameRgb(actual[0]!, actual[1]!);
  expect(Math.abs(actual[0]!.alpha - 255 * 0.7)).toBeLessThanOrEqual(1);
  expectSameRgb(actual[2]!, actual[4]!);
  expect(actual[2]!.alpha).toBe(102);
  await expect(page.locator('#new-dialog')).toHaveCSS('backdrop-filter', 'blur(16px)');
  expectSameRgb(actual[3]!, actual[5]!);
  await page.locator('#new-dialog [data-slot="dialog-close"]').click();
}

test('外观设置在真实浏览器立即应用、分区覆盖并持久保存，恢复设置不写入账本', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const ledgerWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method());
  });
  const member = page.locator('#members-grid [data-select-member]').first();
  const id = await member.getAttribute('data-select-member');
  if (!id) throw new Error('体验酒局缺少可选成员标识');
  const list = page.locator('#members-grid');

  await openAppearance(page);
  await expect(page.locator('#appearance-page')).toHaveValue('global');
  await page.locator('#appearance-font-scale-number').fill('125');
  await page.locator('#appearance-radius-scale-number').fill('150');
  await page.locator('#appearance-opacity-number').fill('70');
  await page.locator('#appearance-blur-number').fill('12');
  await page.locator('#appearance-button-scale-number').fill('120');
  await page.locator('#appearance-preset-blue').click();
  await page.locator('#appearance-color-accent-hex').fill('#6a3dc2');
  await page.locator('#appearance-preview-add').click();
  const customized = await storedAppearance(page);
  expect(customized.global).toMatchObject({
    fontScale: 125, radiusScale: 150, surfaceOpacity: 70, blur: 12, buttonScale: 120,
    colors: { background: '#f3f7fc', accent: '#6a3dc2' },
  });
  expect(customized.regions).toEqual({});
  await leaveAppearance(page);
  await expect(member).toHaveCSS('font-size', '20px');
  await expect(list).toHaveCSS('border-top-left-radius', '21px');
  await expect(list).toHaveCSS('background-color', /\/ 0\.7\)$/);
  await expect(list).toHaveCSS('backdrop-filter', 'blur(12px)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 247, 252)');
  await member.click();
  await expect(page.locator('#drink-button')).toHaveCSS('background-color', 'rgb(106, 61, 194)');
  await expect.poll(() => page.locator('#drink-button').evaluate(button => Number.parseFloat(getComputedStyle(button).height))).toBeCloseTo(57.6, 1);

  await openAppearance(page);
  await page.locator('#appearance-page').selectOption('ledger');
  await page.locator('#appearance-region').selectOption('members');
  await expect(page.locator('#appearance-customize-region')).not.toBeChecked();
  await expect(page.locator('#appearance-font-scale-number')).toBeDisabled();
  await page.locator('#appearance-customize-region').check();
  expect((await storedAppearance(page)).regions.members).toEqual(customized.global);
  await page.locator('#appearance-font-scale-number').fill('150');
  await page.locator('#appearance-radius-scale-number').fill('50');
  await page.locator('#appearance-opacity-number').fill('40');
  await page.locator('#appearance-blur-number').fill('4');
  await page.locator('#appearance-color-accent-hex').fill('#24734e');
  await leaveAppearance(page);
  await expect(member).toHaveCSS('font-size', '24px');
  await expect(list).toHaveCSS('border-top-left-radius', '7px');
  await expect(list).toHaveCSS('background-color', /\/ 0\.4\)$/);
  await expect(list).toHaveCSS('backdrop-filter', 'blur(4px)');
  await expect(page.locator('#drink-button')).toHaveCSS('background-color', 'rgb(106, 61, 194)');
  await page.locator('#mobile-ranking').click();
  await expect(page.locator('#ranking-view [data-appearance-region="ranking"]')).toHaveCSS('font-size', '20px');
  await page.locator('#mobile-history').click();
  await expect(page.locator('#history-panel')).toHaveCSS('border-top-left-radius', '21px');
  await expect(page.locator('#history-panel')).toHaveCSS('backdrop-filter', 'blur(12px)');
  const beforeReload = await storedAppearance(page);
  await page.reload();
  await expect(member).toHaveCSS('font-size', '24px');
  await expect(list).toHaveCSS('border-top-left-radius', '7px');
  expect(await storedAppearance(page)).toEqual(beforeReload);

  await openAppearance(page);
  await page.locator('#appearance-page').selectOption('ledger');
  await page.locator('#appearance-region').selectOption('members');
  await expect(page.locator('#appearance-customize-region')).toBeChecked();
  await page.locator('#appearance-reset-region').click();
  await expect(page.locator('#appearance-customize-region')).not.toBeChecked();
  expect((await storedAppearance(page)).regions).toEqual({});
  await leaveAppearance(page);
  await expect(member).toHaveCSS('font-size', '20px');
  await expect(list).toHaveCSS('border-top-left-radius', '21px');

  await openAppearance(page);
  await page.locator('#appearance-reset-all').click();
  expect(await storedAppearance(page)).toEqual(DEFAULT_APPEARANCE);
  await leaveAppearance(page);
  await expect(member).toHaveCSS('font-size', '16px');
  await expect(list).toHaveCSS('border-top-left-radius', '14px');
  await expect(list).toHaveCSS('backdrop-filter', 'none');
  await member.click();
  await expect(page.locator('#drink-button')).toHaveCSS('height', '48px');
  await expect(page.locator('#drink-button')).toHaveCSS('background-color', 'rgb(187, 66, 0)');
  expect(ledgerWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test('新局弹窗遮罩跟随页面底色，保留半透明表面与独立强调色', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const ledgerWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method());
  });
  for (const preset of ['ios', 'dark']) {
    await openAppearance(page);
    await page.locator('#appearance-opacity-number').fill('40');
    await page.locator('#appearance-blur-number').fill('16');
    await page.locator(`#appearance-preset-${preset}`).click();
    const settings = await storedAppearance(page);
    await leaveAppearance(page);
    await expectNewDialogPalette(page, settings.global.colors);
  }
  await openAppearance(page);
  await page.locator('#appearance-page').selectOption('settings');
  await page.locator('#appearance-region').selectOption('new-session');
  await page.locator('#appearance-customize-region').check();
  await page.locator('#appearance-color-accent-hex').fill('#24734e');
  const settings = await storedAppearance(page);
  const customized = settings.regions['new-session'];
  if (!customized) throw new Error('开启新一局弹窗的独立外观设置未保存');
  expect(customized.colors.accent).toBe('#24734e');
  expect(settings.global.colors.accent).toBe('#ffad70');
  await leaveAppearance(page);
  await expectNewDialogPalette(page, customized.colors);
  expect(ledgerWrites).toEqual([]);
});

test('新局弹窗跟随全站配色，保留旧成员弹窗设置并支持独立调整', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const ledgerWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method());
  });
  await openAppearance(page);
  await page.locator('#appearance-preset-cream').click();
  await page.locator('#appearance-page').selectOption('settings');
  await page.locator('#appearance-region').selectOption('member-dialog');
  await page.locator('#appearance-customize-region').check();
  await page.locator('#appearance-preset-ios').click();
  const original = (await storedAppearance(page)).regions['member-dialog'];
  if (!original) throw new Error('成员弹窗的独立外观设置未保存');
  await leaveAppearance(page);
  await page.locator('#settings-button').click();
  await page.locator('#settings-session').click();
  await page.locator('#new-session-button').click();
  await expect(page.locator('#confirm-new-session')).toHaveCSS('background-color', 'rgb(187, 66, 0)');
  await page.locator('#keep-members').check();
  await expect(page.locator('#keep-members')).toHaveCSS('background-color', 'rgb(187, 66, 0)');
  expect((await storedAppearance(page)).regions['member-dialog']).toEqual(original);
  await page.locator('#new-dialog [data-slot="dialog-close"]').click();

  await openAppearance(page);
  await page.locator('#appearance-page').selectOption('settings');
  await page.locator('#appearance-region').selectOption('new-session');
  await page.locator('#appearance-customize-region').check();
  await page.locator('#appearance-preset-mint').click();
  const customized = await storedAppearance(page);
  await leaveAppearance(page);
  await page.locator('#settings-button').click();
  await page.locator('#settings-session').click();
  await page.locator('#new-session-button').click();
  await expect(page.locator('#confirm-new-session')).toHaveCSS('background-color', 'rgb(36, 115, 78)');
  await page.locator('#new-dialog [data-slot="dialog-close"]').click();
  await page.reload();
  await expect(page.locator('#workspace')).toBeVisible();
  expect(await storedAppearance(page)).toEqual(customized);
  expect((await storedAppearance(page)).regions['member-dialog']).toEqual(original);
  await page.locator('#settings-button').click();
  await page.locator('#settings-session').click();
  await page.locator('#new-session-button').click();
  await expect(page.locator('#confirm-new-session')).toHaveCSS('background-color', 'rgb(36, 115, 78)');
  expect(ledgerWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test('各配色预设的系统栏、错误文字与头像选中色圈保持一致', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const ledgerWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method());
  });
  const member = page.locator('#members-grid [data-select-member]').first();
  const id = await member.getAttribute('data-select-member');
  if (!id) throw new Error('体验酒局缺少可选成员标识');
  const checkError = async (): Promise<void> => {
    await page.locator('#settings-button').click();
    await page.locator('#settings-session').click();
    await page.locator('#new-session-button').click();
    await page.locator('#new-session-name').fill(' ');
    await page.locator('#confirm-new-session').click();
    await expect(page.locator('#session-form [data-testid="form-error"]')).toBeVisible();
    expect(await renderedTextContrast(page, '#session-form [data-testid="form-error"]', '#session-form'), '新局错误文字在实际弹窗底色上应清晰可读').toBeGreaterThanOrEqual(4.5);
    await page.locator('#new-dialog [data-slot="dialog-close"]').click();
  };
  for (const preset of ['cream', 'ios', 'blue', 'mint', 'dark']) {
    await openAppearance(page);
    await page.locator(`#appearance-preset-${preset}`).click();
    const settings = await storedAppearance(page);
    await leaveAppearance(page);
    expect(await page.locator('meta[name="theme-color"]').evaluateAll(elements => elements.map(element => element.getAttribute('content'))), `${preset} 浏览器系统栏应采用全站底色且元数据不重复`).toEqual([settings.global.colors.background]);
    await checkError();
    await member.click();
    await page.locator('#session-title').hover();
    expect(await renderedTextContrast(page, `[data-select-member="${id}"] .text-muted-foreground`, `[data-select-member="${id}"]`), `${preset} 选中人物卡片的待喝文字应清晰可读`).toBeGreaterThanOrEqual(4.5);
    await page.locator('#edit-member-button').click();
    const styles = await page.locator('#color-picker label:has(input:checked)').evaluate(label => {
      const dialog = document.getElementById('edit-dialog');
      const remove = document.getElementById('delete-member');
      if (!dialog || !remove) throw new Error('编辑弹窗或移除按钮不存在，无法检查配色');
      return [getComputedStyle(label).getPropertyValue('--tw-ring-offset-color'), getComputedStyle(dialog).backgroundColor, getComputedStyle(remove).color, getComputedStyle(remove).backgroundColor];
    });
    const actual = await page.evaluate(cssColors, styles);
    for (const channel of ['red', 'green', 'blue'] as const) expect(Math.abs(actual[0]![channel] - actual[1]![channel]), `${preset} 头像选中色圈间隔应采用弹窗底色：${channel}`).toBeLessThanOrEqual(1);
    expect(contrastRatio(actual[2]!, actual[3]!), `${preset} 移除按钮文字应保持清晰可读`).toBeGreaterThanOrEqual(4.5);
    await page.locator('#edit-dialog [data-slot="dialog-close"]').click();
    await member.click();
  }
  for (const preset of ['ios', 'dark']) {
    await openAppearance(page);
    await page.locator(`#appearance-preset-${preset}`).click();
    await page.locator('#appearance-opacity-number').fill('40');
    await page.locator('#appearance-blur-number').fill('16');
    await leaveAppearance(page);
    await checkError();
  }
  expect(ledgerWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test('极值外观下编辑器清晰可读，矮屏六颗骰子和游戏操作不遮挡导航', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 319, height: 515 });
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const ledgerWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method());
  });
  await openAppearance(page);
  await page.locator('#appearance-font-scale-number').fill('150');
  await page.locator('#appearance-radius-scale-number').fill('200');
  await page.locator('#appearance-opacity-number').fill('40');
  await page.locator('#appearance-blur-number').fill('16');
  await page.locator('#appearance-button-scale-number').fill('130');
  await page.locator('#appearance-preset-dark').click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(28, 32, 40)');
  await expect(page.locator('#appearance-settings')).toHaveCSS('background-color', 'rgb(255, 250, 243)');
  await expect(page.locator('#appearance-title')).toHaveCSS('color', 'rgb(48, 34, 28)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(319);
  await leaveAppearance(page);
  await page.locator('#mobile-tools').click();
  await page.locator('#tool-dice').click();
  await page.locator('#dice-count-toggle').click();
  await page.locator('#dice-count-6').click();
  await page.locator('#dice-count-done').click();
  await page.locator('#dice-shake').click();
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-phase', 'settled');
  await page.locator('#dice-gesture').press('End');
  await expect(page.locator('#dice-scene')).toHaveAttribute('data-lift', '180');
  await expectUnobscuredDice(page, 6);
  const [scene, shake, navigation] = await Promise.all([
    page.locator('#dice-scene').boundingBox(), page.locator('#dice-shake').boundingBox(), page.locator('#mobile-navigation').boundingBox(),
  ]);
  if (!scene || !shake || !navigation) throw new Error('极值外观下骰子场景、摇骰按钮或底部导航没有可用的布局尺寸');
  expect(scene.y).toBeGreaterThanOrEqual(0);
  expect(scene.y + scene.height).toBeLessThan(shake.y);
  expect(shake.y + shake.height).toBeLessThan(navigation.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(319);
  await page.locator('#tools-back').click();
  await page.locator('#tool-charades').click();
  await expect(page.locator('#charades-next')).toBeEnabled();
  const next = await page.locator('#charades-next').boundingBox();
  if (!next) throw new Error('极值外观下下一题按钮没有可用的布局尺寸');
  expect(next.y + next.height).toBeLessThan(navigation.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(319);
  expect(ledgerWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test('损坏的本地外观设置显示错误并保留原记录，显式恢复后可以继续使用', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
  const ledgerWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ledger' && request.method() !== 'GET') ledgerWrites.push(request.method());
  });
  const corrupted = '{"version":1,"global":{"fontScale":"large"}}';
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: APPEARANCE_STORAGE_KEY, raw: corrupted });
  await page.reload();
  await expect(page.locator('#appearance-load-error')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), APPEARANCE_STORAGE_KEY)).toBe(corrupted);
  await page.locator('#appearance-open-recovery').click();
  await expect(page.locator('#appearance-error')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), APPEARANCE_STORAGE_KEY)).toBe(corrupted);
  await page.locator('#appearance-error-reset').click();
  await expect(page.locator('#appearance-error')).toHaveCount(0);
  expect(await storedAppearance(page)).toEqual(DEFAULT_APPEARANCE);
  await leaveAppearance(page);
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#appearance-load-error')).toHaveCount(0);
  expect(ledgerWrites).toEqual([]);
});
