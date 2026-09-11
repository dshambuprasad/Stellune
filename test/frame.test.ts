/**
 * Slice B3 — THE FRAME.
 *
 * HQ's visual review of the shipped B2 build found three things wrong with the
 * screen, and two of them are geometry rather than taste:
 *
 *   · the dome and the control cluster overlap — the `S` cardinal sat behind the
 *     Tonight pill, on desktop and on a phone;
 *   · roughly a third of the desktop viewport was empty margin while the dome
 *     stayed small.
 *
 * A screenshot found both, and a screenshot is not a gate. These are the same
 * two claims stated as arithmetic on `fitViewport`, which is the one function
 * that decides how big the sky is and where it sits. The e2e capture still runs
 * — it is what catches a layout that is geometrically fine and ugly — but it is
 * no longer the only thing standing between this defect and the next release.
 */

import { describe, expect, it } from 'vitest';

import { placeLabels, type LabelCandidate } from '../src/app/starfield.ts';
import {
  CARDINAL_MARGIN_PX,
  CARDINAL_OFFSET_PX,
  CARDINALS,
  createCamera,
  domeBounds,
  fitViewport,
  project,
} from '../src/app/projection.ts';

/** The two viewports `playwright.config.ts` captures, and the shape of the app. */
const DESKTOP = { width: 1440, height: 900 };
const IPHONE = { width: 390, height: 844 };

describe('THE DOME FITS THE SPACE IT IS GIVEN', () => {
  it('reserves room for the cardinal ring, so nothing of the dome is off-frame', () => {
    for (const screen of [DESKTOP, IPHONE]) {
      const view = fitViewport(screen.width, screen.height, 120, 46);
      const bounds = domeBounds(view);
      expect(bounds.left, `${screen.width}px: west mark off the left`).toBeGreaterThanOrEqual(0);
      expect(bounds.right, `${screen.width}px: east mark off the right`).toBeLessThanOrEqual(
        screen.width,
      );
      expect(bounds.top, `${screen.width}px: north mark above the frame`).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the horizon circle and every cardinal clear of the panel and the title', () => {
    // The B2 defect, as a number. `occludedBottom` is the panel's FULL height
    // since B3 — the Tonight pill is opaque and sits at the top of the panel,
    // so a fraction of it was never the right thing to clear.
    const occludedBottom = 120;
    const occludedTop = 46;
    for (const screen of [DESKTOP, IPHONE]) {
      const view = fitViewport(screen.width, screen.height, occludedBottom, occludedTop);
      const bounds = domeBounds(view);
      expect(
        bounds.bottom,
        `${screen.width}px: the southern horizon runs under the controls`,
      ).toBeLessThanOrEqual(screen.height - occludedBottom);
      expect(bounds.top, `${screen.width}px: the northern horizon runs under the title`).
        toBeGreaterThanOrEqual(occludedTop);
    }
  });

  it('draws each cardinal exactly where the fit reserved room for it', () => {
    // The two numbers used to be written twice — `radius + 13` in the painter,
    // an 0.94 inset in the fit — and a dome fitted for one and drawn with the
    // other is precisely how `S` ended up behind a button.
    const view = fitViewport(DESKTOP.width, DESKTOP.height, 120, 46);
    const camera = createCamera();
    const bounds = domeBounds(view);
    for (const { azimuth } of CARDINALS) {
      const rim = project(0, azimuth, view, camera);
      const dx = rim.x - view.cx;
      const dy = rim.y - view.cy;
      const reach = Math.hypot(dx, dy) + CARDINAL_OFFSET_PX;
      expect(reach).toBeLessThanOrEqual(view.radius + CARDINAL_MARGIN_PX);
    }
    expect(bounds.right - bounds.left).toBeCloseTo(2 * (view.radius + CARDINAL_MARGIN_PX), 6);
  });

  it('gives the sky the space the panel is not using, at both breakpoints', () => {
    // Not a beauty standard — a floor. The dome must fill essentially all of the
    // band that is left once the chrome has had its share, so that a small dome
    // can only ever mean chrome that is too big, which is a design decision
    // someone has to make on purpose.
    const bands = [
      { name: 'desktop', screen: DESKTOP, panel: 105, topbar: 46 },
      { name: 'iphone', screen: IPHONE, panel: 223, topbar: 47 },
    ];
    for (const { name, screen, panel, topbar } of bands) {
      const view = fitViewport(screen.width, screen.height, panel, topbar);
      const available = Math.min(screen.width, screen.height - panel - topbar);
      expect(
        (2 * (view.radius + CARDINAL_MARGIN_PX)) / available,
        `${name}: the dome is leaving the free space empty`,
      ).toBeCloseTo(1, 6);
    }
  });

  it('never collapses to nothing when the chrome is taller than the screen', () => {
    // A short landscape phone with the keyboard up. The dome gets small; it does
    // not get negative, and it does not throw.
    const view = fitViewport(568, 320, 400, 80);
    expect(view.radius).toBeGreaterThan(0);
    expect(Number.isFinite(view.cy)).toBe(true);
  });
});

/**
 * A stand-in for `ctx.measureText`. Real metrics need a canvas; what these tests
 * are about is what happens when two words want the same pixels, and a
 * proportional-ish width is enough to make that happen.
 */
const measure = (text: string): number => text.length * 5.5;

/** The box a placed name occupies, recomputed from the placement it was given. */
const boxOf = (p: { label: string; placement: { align: string; x: number; y: number } }) => {
  const w = measure(p.label);
  const left =
    p.placement.align === 'left'
      ? p.placement.x
      : p.placement.align === 'right'
        ? p.placement.x - w
        : p.placement.x - w / 2;
  return { left, right: left + w, top: p.placement.y - 6, bottom: p.placement.y + 6 };
};

function expectNoneOverlap(
  placed: ReadonlyArray<{ label: string; placement: { align: string; x: number; y: number } }>,
): void {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = boxOf(placed[i]!);
      const b = boxOf(placed[j]!);
      const hit = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      expect(hit, `${placed[i]!.label} and ${placed[j]!.label} overprint`).toBe(false);
    }
  }
}

const star = (label: string, x: number, y: number, mag: number): LabelCandidate => ({
  label,
  x,
  y,
  radius: 3,
  mag,
});

describe('THE LABELS DO NOT COLLIDE', () => {
  const FRAME = { width: 1440, height: 900, measure };

  it('leaves names that are nowhere near each other exactly where they were', () => {
    // The common case, and the one a collision fix most easily breaks: a sky of
    // well-separated names must look exactly as it did before.
    const placed = placeLabels(
      [star('Vega', 400, 200, 0.03), star('Altair', 800, 500, 0.76)],
      FRAME,
    );
    expect(placed).toHaveLength(2);
    for (const p of placed) {
      expect(p.placement.align).toBe('left');
      expect(p.placement.x).toBe(p.x + 8);
      expect(p.placement.y).toBe(p.y);
    }
  });

  it('displaces rather than overprints when two bright names crowd', () => {
    // Two stars a few pixels apart. Both names are wanted; neither may be drawn
    // over the other.
    const placed = placeLabels([star('Hadar', 700, 800, 0.61), star('Mimosa', 706, 806, 1.25)], FRAME);
    expect(placed).toHaveLength(2);
    const [brighter, fainter] = placed;
    // The brighter keeps the canonical position; the fainter is the one that moves.
    expect(brighter?.label).toBe('Hadar');
    expect(brighter?.placement.align).toBe('left');
    expect(fainter?.label).toBe('Mimosa');
    expect(
      fainter?.placement.align !== 'left' || fainter?.placement.y !== fainter?.y,
    ).toBe(true);
  });

  it("gives HQ's three southern stars three separate places, none printed over another", () => {
    // The finding, as reported: `Rigil Kentaurus`, `Hadar` and `Mimosa` crowd
    // within a couple of degrees low in the south and all three overprinted in
    // the shipped build. Displacement is enough for three — right, left, above —
    // so all three names survive and all three are readable.
    const placed = placeLabels(
      [
        star('Rigil Kentaurus', 700, 800, -0.27),
        star('Hadar', 704, 803, 0.61),
        star('Mimosa', 697, 806, 1.25),
      ],
      FRAME,
    );
    expect(placed).toHaveLength(3);
    expectNoneOverlap(placed);
    // The brightest keeps the canonical position; the others are what moved.
    expect(placed[0]?.label).toBe('Rigil Kentaurus');
    expect(placed[0]?.placement.align).toBe('left');
  });

  it('drops the faintest when displacement runs out of places', () => {
    // Five names on one pixel: there are four placements, and a name with
    // nowhere clear to go is not drawn. Nothing is squeezed in at half opacity
    // or clipped — a nameless star still reads as a star.
    const crowd = [
      star('Rigil Kentaurus', 700, 500, -0.27),
      star('Hadar', 700, 500, 0.61),
      star('Mimosa', 700, 500, 1.25),
      star('Acrux', 700, 500, 0.76),
      star('Gacrux', 700, 500, 1.63),
    ];
    const placed = placeLabels(crowd, FRAME);
    expect(placed.length).toBeLessThan(crowd.length);
    expectNoneOverlap(placed);
    // And it is the faintest that went.
    const dropped = crowd.filter((c) => !placed.some((p) => p.label === c.label));
    const worstPlaced = Math.max(...placed.map((p) => p.mag));
    for (const gone of dropped) expect(gone.mag).toBeGreaterThan(worstPlaced);
  });

  it('THE LEAD ALWAYS WINS — a standing name yields to the star that is singing', () => {
    // The LEAD's name is already painted when this runs, so its box is reserved
    // first. Sirius is the brightest star in the sky and it still moves.
    const leadBox = { left: 700, right: 780, top: 794, bottom: 806 };
    const withLead = placeLabels([star('Sirius', 690, 800, -1.46)], {
      ...FRAME,
      reserved: [leadBox],
    });
    expect(withLead).toHaveLength(1);
    const p = withLead[0]?.placement;
    const box = {
      left: p?.align === 'left' ? (p?.x ?? 0) : (p?.x ?? 0) - measure('Sirius'),
      top: (p?.y ?? 0) - 6,
    };
    const clear =
      box.left > leadBox.right || box.left + measure('Sirius') < leadBox.left || box.top + 12 <= leadBox.top || box.top >= leadBox.bottom;
    expect(clear, 'a standing name printed over the LEAD').toBe(true);
  });

  it('never places a name off the frame, and drops it rather than clipping it', () => {
    // A star hard against the right rim: the name flips to its left. One so far
    // into the corner that no placement fits is dropped, not truncated.
    const flipped = placeLabels([star('Arcturus', 1430, 400, -0.05)], FRAME);
    expect(flipped[0]?.placement.align).toBe('right');

    const cornered = placeLabels([star('Arcturus', 2, 2, -0.05)], { ...FRAME, width: 40, height: 20 });
    expect(cornered).toHaveLength(0);
  });
});
