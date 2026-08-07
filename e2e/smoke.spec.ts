import { expect, test, type Page } from '@playwright/test';

import { zoomIn } from './gesture.ts';

/**
 * Phase 4 — the smoke test.
 *
 * Three claims, and only three, because a smoke test that asserts everything
 * fails for reasons that have nothing to do with whether the thing works:
 *
 *   1. it loads and reaches a state where you can press Play;
 *   2. pressing Play starts a real session against a real sky;
 *   3. the canvas is drawing stars, and keeps drawing them.
 *
 * The third is the one that matters. A starfield that renders one frame and
 * stops looks identical in a screenshot to one that is running at 60fps.
 */

/** Bengaluru — the sky every earlier gate in this project was judged on. */
const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };

interface TestHandle {
  screen: string;
  drawnStars: number;
  averageFrameMs: number;
  playing: boolean;
  elapsed: number;
  resetStats(): void;
}

declare global {
  interface Window {
    __cosmophony: TestHandle;
  }
}

async function handle<T>(page: Page, read: (h: TestHandle) => T): Promise<T> {
  return page.evaluate(read as (h: TestHandle) => T, undefined as never, {
    // `read` is serialised, so it must not close over anything.
  }) as Promise<T>;
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(BENGALURU);
});

test('loads, starts a session, and the canvas keeps animating', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(String(error)));

  await page.goto('/');

  // 1 — it becomes usable.
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await expect(page.locator('#play')).toBeEnabled();

  // The sky is already drawn before anything is pressed — the walkthrough's
  // "your real sky fades in", not a splash screen.
  await expect
    .poll(() => page.evaluate(() => window.__cosmophony.drawnStars), { timeout: 15_000 })
    .toBeGreaterThan(200);

  // 2 — Play starts a real session.
  await page.locator('#play').click();
  await expect(app).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });

  // The honesty label's time-compression line carries this session's own number.
  await expect(page.locator('#compression-line')).toContainText(/real sky/);
  // And the status line names the place and counts the stars that are really up.
  await expect(page.locator('#status-line')).toContainText(/stars up/);

  // 3 — it keeps drawing, and the piece keeps moving.
  await page.evaluate(() => window.__cosmophony.resetStats());
  const firstElapsed = await page.evaluate(() => window.__cosmophony.elapsed);
  await page.waitForTimeout(2500);
  const laterElapsed = await page.evaluate(() => window.__cosmophony.elapsed);
  expect(laterElapsed).toBeGreaterThan(firstElapsed + 1.5);

  const stats = await page.evaluate(() => ({
    drawn: window.__cosmophony.drawnStars,
    frameMs: window.__cosmophony.averageFrameMs,
    playing: window.__cosmophony.playing,
  }));
  expect(stats.playing).toBe(true);
  expect(stats.drawn).toBeGreaterThan(200);
  // A frame budget, not a benchmark: 16.7 ms is 60fps and this must stay clear
  // of it on the machines this is developed on.
  expect(stats.frameMs).toBeLessThan(16.7);

  // Pixels actually changed between two frames — the field is moving, not frozen.
  const changed = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#sky');
    if (!canvas) return 0;
    const grab = (): string => canvas.toDataURL('image/png');
    const before = grab();
    await new Promise((r) => setTimeout(r, 700));
    return grab() === before ? 0 : 1;
  });
  expect(changed).toBe(1);

  expect(failures, `page errors: ${failures.join('\n')}`).toHaveLength(0);
});

test('panning and zooming never touch the music', async ({ page, isMobile }) => {
  // THE ONE PRINCIPLE, asserted: "Pan, pinch, zoom, scroll change what you SEE,
  // never what you hear." If a camera gesture ever restarts or reseeks the
  // piece, the elapsed clock will jump and this fails.
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await page.locator('#play').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });

  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.__cosmophony.elapsed);

  const box = await page.locator('#sky').boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 90, { steps: 12 });
  await page.mouse.up();
  // Wheel on the desktop, pinch on the phone — both reach the same handler.
  await zoomIn(page, isMobile ?? false, '#sky', { x: box.width / 2, y: box.height / 2 });
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => window.__cosmophony.elapsed);
  // The clock advanced by roughly the wall time that passed, and did not reset.
  expect(after).toBeGreaterThan(before);
  expect(after - before).toBeLessThan(3);
  expect(await page.evaluate(() => window.__cosmophony.playing)).toBe(true);
});

test('a refused location is explained, not treated as a failure', async ({ page, context }) => {
  await context.clearPermissions();
  await context.setGeolocation({ latitude: 0, longitude: 0 });
  // Deny outright: the app must still reach a playable state.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
          fail({ code: 1, message: 'User denied Geolocation' }),
        watchPosition: () => 0,
        clearWatch: () => undefined,
      },
      configurable: true,
    });
  });

  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await expect(page.locator('#problem')).toBeVisible();
  await expect(page.locator('#problem')).toContainText(/Location is off/);
  // Still playable — a refusal costs you nothing but the guess of a city.
  await expect(page.locator('#play')).toBeEnabled();
});
