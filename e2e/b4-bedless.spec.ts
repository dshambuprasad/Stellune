import { expect, test } from '@playwright/test';

/**
 * SLICE B4 — THE BEDLESS LENS, IN THE BROWSER.
 *
 * The ruling is that a lens may declare no bed at all, and that a role it does
 * not declare is ABSENT: not scheduled, not silenced, not gained to zero. Unit
 * tests assert that on the schedule, which is shared by both paths — but the
 * live graph is the path that has five role chains, a calibration file keyed by
 * role, and meters that read them. A lens missing three of those five is
 * exactly the shape that throws on a missing key at the ninetieth second of a
 * session, in the one place no unit test can look.
 *
 * So this plays it. Ground, the real sampler, a real Web Audio graph, for long
 * enough to be past the arrival and into the steady state — and the assertion is
 * that nothing threw and the piece is still running.
 */

test.setTimeout(120_000);

test('the bedless Ground lens plays in the live graph', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });

  await page.goto('/');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });

  await page.locator('button[data-lens="ground"]').click();
  await page.locator('#play').click();
  await expect(app).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });

  // Past the 18 s opening gesture and the 30 s figuration entry: the stretch
  // where a missing ground chain would be reached for if it were reached for.
  await page.waitForTimeout(35_000);

  const state = await page.evaluate(() => ({
    playing: window.__cosmophony.playing,
    elapsed: window.__cosmophony.elapsed,
  }));

  expect(failures.filter((text) => !/favicon|manifest/i.test(text))).toEqual([]);
  expect(state.playing).toBe(true);
  expect(state.elapsed).toBeGreaterThan(30);
});
