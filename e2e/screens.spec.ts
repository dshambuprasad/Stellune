import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zoomIn } from './gesture.ts';

/**
 * Phase 4 — the evidence run.
 *
 * Captures every state the screen can be in, at both viewports, straight into
 * `docs/`. These are not visual-regression baselines; they are what the review
 * gate looks at. Each one is a real session against a real sky — nothing here
 * is mocked except where a state is otherwise unreachable, and that is called
 * out both here and in the filename.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '..', 'docs');

const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };

declare global {
  interface Window {
    __cosmophony: {
      screen: string;
      drawnStars: number;
      averageFrameMs: number;
      playing: boolean;
      elapsed: number;
      lead: string | null;
      leadLabel: string | null;
      leadScreen: { x: number; y: number } | null;
      resetStats(): void;
    };
  }
}

// The evidence run waits on the engine's own schedule for a lead phrase, and
// leads are sparse by design (the Conductor holds a strict note budget). Give
// it room rather than making the capture flaky.
test.setTimeout(150_000);

const shot = (page: Page, name: string, project: string): Promise<Buffer> =>
  page.screenshot({ path: path.join(DOCS, `phase4-${name}-${project}.png`) });

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(BENGALURU);
});

test('capture every state', async ({ page, isMobile }, testInfo) => {
  const project = testInfo.project.name;

  // ---- LOADING ---------------------------------------------------------
  // Held open by delaying the catalogue, which is exactly what a slow
  // connection does. The screen has to say something honest while it waits.
  // Delay only the FIRST fetch: unrouting while a handler is still in flight
  // races with it, and a one-shot flag is simpler than trying to win that race.
  let delayed = false;
  await page.route('**/stars.hyg.subset.json', async (route) => {
    if (!delayed) {
      delayed = true;
      await new Promise((r) => setTimeout(r, 2500));
    }
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'loading');
  await page.waitForTimeout(400);
  await shot(page, 'loading', project);

  // ---- READY (located) --------------------------------------------------
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await page.waitForTimeout(2400); // let the field finish fading in
  await shot(page, 'ready', project);

  // ---- PLAYING + GLOW-SYNC ---------------------------------------------
  await page.locator('#play').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });
  // Long enough for the opening gesture to bloom into the full sky, so the
  // halos in the shot are real sounding stars and not an empty opening.
  await page.waitForTimeout(9000);
  await shot(page, 'playing', project);

  // GLOW-SYNC, framed on the star that is actually speaking.
  //
  // Waits for a lead phrase, then zooms about that star's own screen position
  // rather than the middle of the canvas — zooming to the centre used to walk
  // straight past the one thing the shot exists to show.
  await expect
    .poll(() => page.evaluate(() => window.__cosmophony.lead), { timeout: 60_000 })
    .not.toBeNull();
  const lead = await page.evaluate(() => window.__cosmophony.leadScreen);
  if (lead) await zoomIn(page, isMobile ?? false, '#sky', lead);
  await page.waitForTimeout(500);
  await shot(page, 'playing-zoomed', project);

  // ---- BIRTH SKY, with the city autocomplete open -----------------------
  // Reload first: the camera deliberately keeps its zoom across mode changes
  // (it belongs to the eye, not the session), which is right for the product
  // but makes for a confusing screenshot of a form.
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await page.locator('button[data-mode="birth-sky"]').click();
  await page.locator('#city-input').fill('');
  await page.locator('#city-input').type('beng', { delay: 40 });
  await page.waitForTimeout(400);
  await shot(page, 'birth-sky', project);
});

test('session complete', async ({ page }, testInfo) => {
  const project = testInfo.project.name;

  // The birth-sky session is eleven minutes long by design. Rather than wait
  // for it, the page clock is fast-forwarded — the session's own logic runs
  // untouched, it simply finds that more time has passed than really has.
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });

  await page.locator('button[data-mode="birth-sky"]').click();
  await page.locator('#city-input').fill('');
  await page.locator('#city-input').type('Bengaluru', { delay: 20 });
  await page.waitForTimeout(300);
  await page.locator('.city-option').first().click();
  await page.locator('#play').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });

  await page.clock.fastForward('12:00');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'complete', { timeout: 20_000 });
  await page.waitForTimeout(300);
  await shot(page, 'complete', project);
});

test('no location, and a sky with nothing up', async ({ page, context }, testInfo) => {
  const project = testInfo.project.name;

  // ---- NO GEOLOCATION ---------------------------------------------------
  await context.clearPermissions();
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
  await page.waitForTimeout(2200);
  await shot(page, 'no-geolocation', project);

  // ---- NO STARS UP ------------------------------------------------------
  // FORCED. With the full 8,849-star bundle there is no place and moment on
  // Earth where nothing is above the horizon, so this state cannot be reached
  // honestly with real data — but the code path is real and a person on a
  // future roadmap rung (a tight field of view, a filtered catalogue) can hit
  // it. Here the catalogue is replaced with four far-southern stars and the
  // observer stands at the north pole, so the sky really is empty.
  // A FRESH page: the denial above was installed with addInitScript, which
  // sticks to that page for every later navigation. Reusing it would leave the
  // observer wherever the no-location fallback guessed, and the shot would
  // quietly be of a different place than the one it claims.
  const polar = await context.newPage();
  await polar.route('**/stars.hyg.subset.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        { id: '1', name: 'Acrux', ra: 186.65, dec: -63.09, mag: 0.77, bv: -0.24, constellation: 'Cru' },
        { id: '2', name: 'Mimosa', ra: 191.93, dec: -59.68, mag: 1.25, bv: -0.24, constellation: 'Cru' },
        { id: '3', name: 'Gacrux', ra: 187.79, dec: -57.11, mag: 1.59, bv: 1.6, constellation: 'Cru' },
        { id: '4', name: 'Imai', ra: 183.79, dec: -58.75, mag: 2.79, bv: -0.19, constellation: 'Cru' },
      ]),
    });
  });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 89.9, longitude: 0 });
  await polar.goto('/');
  await expect(polar.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await polar.locator('#play').click();
  await expect(polar.locator('#problem')).toBeVisible({ timeout: 20_000 });
  await expect(polar.locator('#problem')).toContainText(/above the horizon/);
  await polar.waitForTimeout(300);
  await shot(polar, 'no-stars-up-forced', project);
  await polar.close();
});
