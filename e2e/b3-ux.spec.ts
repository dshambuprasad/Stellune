import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zoomIn } from './gesture.ts';

/**
 * Slice B3 — HALT, the visual gate.
 *
 * THE SAME SKY AS B2, SO THE FRAME IS THE ONLY THING THAT CHANGED. Same place,
 * same frozen instant, same camera, same two viewports as `b2-ux.spec.ts` — so
 * `docs/b3-ux-*.png` sits beside `docs/b2-ux-after-*.png` and any difference
 * between them is the layout and the labels, not a sky that has turned.
 *
 * The three defects HQ found in the shipped build, and what these shots are for:
 *
 *   (a) the dome and the controls overlapped — `S` sat behind the Tonight pill.
 *       Asserted, not eyeballed: the dome's own geometry is read out of the
 *       running app and checked against the panel's real rectangle.
 *   (b) a third of the desktop viewport was empty margin while the dome stayed
 *       small. The panel is a band now; the assertion is that the dome fills the
 *       space the band leaves.
 *   (c) bright stars near the horizon collided their labels. That one is a
 *       picture, because "legible" is a thing a person judges — but the sky is
 *       pinned so the same three southern stars are in the same three places.
 *
 *   npx playwright test b3-ux              — assert the frame law
 *   B3_SHOT=1 npx playwright test b3-ux    — …and re-take the committed pictures
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '..', 'docs');

/** Shambu's own sky. Identical to B2's. */
const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };

/** The instant every shot is taken at. Identical to B2's. */
const FROZEN = new Date('2026-09-01T16:30:00Z');

/**
 * B3's GATE IS CLOSED, AND ITS EVIDENCE IS COMMITTED — Slice B4.
 *
 * Exactly the rule B3 wrote for B2's spec, applied to B3's own. This file writes
 * over `docs/b3-ux-*.png`, the pictures HQ reviewed and ruled on; running the
 * e2e suite for an unrelated reason (B4 ran it to confirm the longer honesty
 * text had not shrunk the dome) silently rewrote them with the current build's
 * layout, and it had to be undone from git a second time. A rule that has to be
 * remembered is not a rule.
 *
 * The ASSERTIONS are the reason to run it, and they still run — the frame law is
 * checked, the screenshots are simply not re-taken unless asked:
 *
 *   B3_SHOT=1 npx playwright test b3-ux
 */
const RETAKE = Boolean(process.env.B3_SHOT);

const shot = (page: Page, name: string, project: string): Promise<Buffer> =>
  page.screenshot(
    RETAKE ? { path: path.join(DOCS, `b3-ux-${name}-${project}.png`) } : {},
  );

interface DomeGeometry {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius: number;
}

/**
 * The frame's rule, checked against the app that is actually running.
 *
 * `CARDINAL_MARGIN_PX` is restated here rather than imported: this file is the
 * gate, and a gate that imports the number it is checking would pass whatever
 * the source happened to say. `test/frame.test.ts` is where the two are tied
 * together.
 */
const CARDINAL_MARGIN_PX = 24;

async function assertTheFrame(page: Page, where: string): Promise<void> {
  const dome = (await page.evaluate(
    () => (window as unknown as { __cosmophony: { dome: unknown } }).__cosmophony.dome,
  )) as DomeGeometry;
  const panel = await page.locator('#panel').boundingBox();
  expect(panel, `${where}: no panel`).not.toBeNull();

  const reach = dome.radius + CARDINAL_MARGIN_PX;

  // (a) NOTHING OCCLUDES THE HORIZON CIRCLE OR ITS CARDINALS.
  expect(
    dome.cy + reach,
    `${where}: the southern horizon and its S mark run under the controls`,
  ).toBeLessThanOrEqual((panel?.y ?? 0) + 0.5);
  expect(dome.cx - reach, `${where}: the west mark is off the left of the frame`).toBeGreaterThanOrEqual(-0.5);
  expect(dome.cx + reach, `${where}: the east mark is off the right of the frame`).toBeLessThanOrEqual(
    dome.width + 0.5,
  );
  expect(dome.cy - reach, `${where}: the north mark is above the frame`).toBeGreaterThanOrEqual(-0.5);

  // (b) AND IT TAKES THE SPACE THAT LEAVES IT. A dome that clears the panel by
  // sitting in a corner would pass the check above; this is the other half.
  const shortSide = Math.min(dome.width, dome.height);
  expect(
    (2 * reach) / shortSide,
    `${where}: the dome is small for the screen it is on`,
  ).toBeGreaterThan(0.75);
}

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

  await page.clock.fastForward(3000);
  await page.waitForTimeout(1200);
  await assertTheFrame(page, `${project} at rest`);
  await shot(page, 'rest', project);

  // ---- PLAYING ----------------------------------------------------------
  await page.locator('#play').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });
  await page.waitForTimeout(6000);
  // The panel grows a progress row when a session starts, and the dome has to
  // have moved out of its way — a frame that is only correct at rest is not.
  await assertTheFrame(page, `${project} playing`);
  await shot(page, 'playing', project);
});

test('zoomed into one constellation', async ({ page, isMobile }, testInfo) => {
  const project = testInfo.project.name;

  await page.clock.install({ time: FROZEN });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'ready', { timeout: 30_000 });
  await page.clock.fastForward(3000);
  await page.waitForTimeout(1200);

  // The same gesture, through the app's own pointer handlers, about the same
  // fixed point as B2, so the two zoomed shots frame identically.
  const box = await page.locator('#sky').boundingBox();
  const at = { x: (box?.width ?? 400) / 2, y: (box?.height ?? 600) * 0.42 };
  await zoomIn(page, isMobile ?? false, '#sky', at);
  await page.waitForTimeout(800);
  await shot(page, 'zoomed', project);
});
