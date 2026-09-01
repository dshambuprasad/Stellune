/**
 * Slice B2 — loading the constellation stick figures.
 *
 * `public/data/constellations.lines.json` is built by `scripts/build-data.mjs`
 * from d3-celestial's Western line set (BSD-3-Clause, pinned by commit; the
 * notice and the provenance are in `public/data/ATTRIBUTION.md`). Every vertex
 * was resolved to a star in our own subset at build time, so a figure is a list
 * of catalogue ids and the renderer draws between the points it has just drawn
 * the stars at.
 *
 * THIS LOADER NEVER FAILS THE BOOT. The star catalogue is the app — without it
 * there is no sky and `loadStarCatalog` is right to throw. The figures are a
 * drawing over the sky. A deploy that served a stale `public/data`, a CDN that
 * dropped one file out of three, a browser with a poisoned cache: none of those
 * should turn into an error message in front of someone who came to look at the
 * stars. The sky simply appears without its lines, and the console says why.
 *
 * That asymmetry is deliberate and is the same rule `verifyLensCatalogue` and
 * `loadCalibration` already follow: fail loudly for what is load-bearing, and
 * degrade quietly for what is decoration.
 */

import type { ConstellationFigure } from './starfield.ts';

/** Where the bundled figures live, relative to the page. */
export const CONSTELLATION_LINES_URL = 'data/constellations.lines.json';

interface FigureFile {
  constellations?: unknown;
}

/**
 * Validate loosely but honestly.
 *
 * A malformed entry is dropped rather than thrown on, for the reason above —
 * but it is dropped, not coerced. A figure with one endpoint is not drawn as a
 * dot; it is not a figure.
 */
function parseFigures(payload: unknown): ConstellationFigure[] {
  const file = payload as FigureFile | null;
  const raw = file && Array.isArray(file.constellations) ? file.constellations : [];
  const figures: ConstellationFigure[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, lines } = entry as { id?: unknown; lines?: unknown };
    if (typeof id !== 'string' || !Array.isArray(lines)) continue;

    const kept: string[][] = [];
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      const ids = line.filter((value): value is string => typeof value === 'string');
      if (ids.length >= 2) kept.push(ids);
    }
    if (kept.length > 0) figures.push({ id, lines: kept });
  }
  return figures;
}

/**
 * Fetch the figures, or return none.
 *
 * Returns an empty array on any failure. The caller draws whatever it gets.
 */
export async function loadConstellationFigures(
  url = CONSTELLATION_LINES_URL,
): Promise<ConstellationFigure[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(
        `Stellune: constellation figures unavailable (${response.status}); ` +
          `the sky will render without its lines.`,
      );
      return [];
    }
    return parseFigures(await response.json());
  } catch (cause) {
    console.warn(
      `Stellune: constellation figures could not be read (${(cause as Error).message}); ` +
        `the sky will render without its lines.`,
    );
    return [];
  }
}
