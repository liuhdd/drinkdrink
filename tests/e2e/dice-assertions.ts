import { expect, type Page } from '@playwright/test';

export async function expectUnobscuredDice(page: Page, count: number): Promise<void> {
  await expect.poll(() => page.locator('#dice-scene').evaluate((scene, diceCount) => {
    const pointerEvents = scene.style.pointerEvents;
    scene.style.pointerEvents = 'auto';
    try {
      return Array.from({ length: diceCount }, (_, index) => {
        const face = scene.querySelector(`[data-testid="dice-${index}"] [data-face="top"]`);
        if (!face) throw new Error(`骰子 ${index} 缺少用于检查遮挡的顶面`);
        const bounds = face.getBoundingClientRect();
        return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
      });
    } finally { scene.style.pointerEvents = pointerEvents; }
  }, count)).toEqual(Array.from({ length: count }, (_, index) => `dice-${index}`));
}
