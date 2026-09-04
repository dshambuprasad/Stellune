import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zoomIn } from './gesture.ts';

/**
 * Slice B2 — HALT #2, the visual gate.
 *
 * The HQ review gate of 2026-09-01 recorded the first-ever visual review of
 * Phase 4 and it went badly: "4,302 stars render as near-uniform dots — no
 * constellation lines, no bright-star names at rest, weak magnitude hierarchy…
 * noise, no patterns, nothing to recognise". This capture is the before/after
 * for the three changes that answer it, at the two viewports the product is
 * actually used at.
 *
 * ONE SKY, PINNED. Same place, same instant, same camera in every shot, so the
 * only difference between `before` and `after` is the rendering. The sidereal
 * clock is frozen with `page.clock` — a real sky turns, and two captures taken
 * a minute apart would differ by a degree of rotation, which is enough to make
 * a reviewer wonder whether they are comparing the right thing.
 *
 *   B2_SHOT=before npx playwright test b2-ux
 *   B2_SHOT=after  npx playwright test b2-ux
 *
 * `before` is captured by checking out the pre-B2 renderer; nothing in this
 * file changes behaviour, it only names the file.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '..', 'docs');

/** Shambu's own sky. */
const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };

/**
 * The instant every shot is taken at.
 *
 * A fixed UTC moment, so `before` and `after` show the same stars in the same
 * places. Chosen for a night sky over Bengaluru with plenty above the horizon.
 */
const FROZEN = new Date('2026-09-01T16:30:00Z');

const LABEL = process.env.B2_SHOT === 'before' ? 'before' : 'after';

const shot = (page: Page, name: string, project: string): Promise<Buffer> =>
  page.screenshot({ path: path.join(DOCS, `b2-ux-${LABEL}-${name}-${project}.png`) });

test.setTimeout(120_000);

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(BENGALURU);
});

test('the sky, at rest and playing', async ({ page }, testInfo) => {
  const project = testInfo.project.name;

  await page.clock.install({ time: FROZEN });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });

  // The field fades in over a couple of seconds; `setTime` rather than
  // `fastForward` so the sidereal clock lands on exactly the frozen instant in
  // both runs while the reveal animation still completes.
  await page.clock.fastForward(3000);
  await page.waitForTimeout(1200);
  await shot(page, 'rest', project);

  // ---- PLAYING ----------------------------------------------------------
  // Tonight mode, which since B2 opens on Aurora and on the arrival. The sky
  // is the same either way — this is the visual gate, not the ear gate — but
  // the glow-sync halos only exist while something is sounding.
  await page.locator('#play').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });
  await page.waitForTimeout(6000);
  await shot(page, 'playing', project);
});

test('zoomed into one constellation', async ({ page, isMobile }, testInfo) => {
  const project = testInfo.project.name;

  await page.clock.install({ time: FROZEN });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await page.clock.fastForward(3000);
  await page.waitForTimeout(1200);

  // Zoomed, because the figures and the standing names are what a reviewer has
  // to be able to judge and both are small at dome scale. Through the app's own
  // pointer handlers — the same path a finger or a trackpad takes — about a
  // fixed point, so the two runs frame identically.
  const box = await page.locator('#sky').boundingBox();
  const at = { x: (box?.width ?? 400) / 2, y: (box?.height ?? 600) * 0.42 };
  await zoomIn(page, isMobile ?? false, '#sky', at);
  await page.waitForTimeout(800);
  await shot(page, 'zoomed', project);
});
