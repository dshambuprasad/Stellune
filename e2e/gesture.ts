import type { Page } from '@playwright/test';

/**
 * Phase 4 — zooming the sky the way each device actually does it.
 *
 * Mobile WebKit has no wheel, which is not a gap in the harness — it is the
 * truth about phones. So the tests pinch there and wheel on the desktop, and
 * both land on the same pointer-event handlers the app really uses
 * (`src/app/gestures.ts` is written against Pointer Events precisely so that a
 * mouse, a trackpad, a pen and two fingers all take one path).
 */

/** A two-finger pinch about a point, dispatched as real PointerEvents. */
export async function pinch(
  page: Page,
  selector: string,
  centre: { x: number; y: number },
  factor: number,
  steps = 8,
): Promise<void> {
  await page.evaluate(
    async ({ selector, centre, factor, steps }) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`no element for ${selector}`);
      const rect = element.getBoundingClientRect();
      const cx = rect.left + centre.x;
      const cy = rect.top + centre.y;
      const startGap = 60;

      const fire = (type: string, id: number, x: number, y: number): void => {
        element.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      };

      // setPointerCapture on a synthetic pointer id throws in some engines; the
      // handler guards for it, but stub it here so the gesture is not aborted.
      const target = element as HTMLElement & { setPointerCapture(id: number): void };
      const realCapture = target.setPointerCapture?.bind(target);
      const realRelease = target.releasePointerCapture?.bind(target);
      const realHas = target.hasPointerCapture?.bind(target);
      target.setPointerCapture = () => undefined;
      target.releasePointerCapture = () => undefined;
      (target as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;

      fire('pointerdown', 1, cx - startGap, cy);
      fire('pointerdown', 2, cx + startGap, cy);
      for (let i = 1; i <= steps; i++) {
        const gap = startGap * (1 + (factor - 1) * (i / steps));
        fire('pointermove', 1, cx - gap, cy);
        fire('pointermove', 2, cx + gap, cy);
        await new Promise((r) => setTimeout(r, 16));
      }
      fire('pointerup', 1, cx - startGap * factor, cy);
      fire('pointerup', 2, cx + startGap * factor, cy);

      if (realCapture) target.setPointerCapture = realCapture;
      if (realRelease) target.releasePointerCapture = realRelease;
      if (realHas) (target as unknown as { hasPointerCapture: unknown }).hasPointerCapture = realHas;
    },
    { selector, centre, factor, steps },
  );
}

/** Zoom in about a point, using whichever gesture this device supports. */
export async function zoomIn(
  page: Page,
  isMobile: boolean,
  selector: string,
  at: { x: number; y: number },
  amount = 3,
): Promise<void> {
  if (isMobile) {
    await pinch(page, selector, at, amount);
    return;
  }
  const box = await page.locator(selector).boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + at.x, box.y + at.y);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(60);
  }
}
