import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __cosmophony: { averageFrameMs: number; drawnStars: number; resetStats(): void };
  }
}

/**
 * Phase 4 — the frame budget, measured rather than claimed.
 *
 * Reports the average frame time and how many stars were drawn to produce it,
 * for both viewports. Kept separate from the smoke test so a slow machine
 * reports a number rather than failing a build.
 */
test('frame budget', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 12.9716, longitude: 77.5946 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await page.locator('#play').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => window.__cosmophony.resetStats());
  await page.waitForTimeout(4000);
  const full = await page.evaluate(() => ({
    frameMs: window.__cosmophony.averageFrameMs,
    drawn: window.__cosmophony.drawnStars,
  }));

  // …and again with the low-power path engaged.
  await page.locator('#low-power').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__cosmophony.resetStats());
  await page.waitForTimeout(4000);
  const low = await page.evaluate(() => ({
    frameMs: window.__cosmophony.averageFrameMs,
    drawn: window.__cosmophony.drawnStars,
  }));

  console.log(
    `[${testInfo.project.name}] full: ${full.frameMs.toFixed(2)} ms/frame over ` +
      `${full.drawn} stars · low power: ${low.frameMs.toFixed(2)} ms/frame over ${low.drawn} stars`,
  );
  expect(full.frameMs).toBeLessThan(16.7);
  expect(low.drawn).toBeLessThan(full.drawn);
});
