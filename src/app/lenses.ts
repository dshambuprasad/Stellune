/**
 * Phase 4 — the five mood lenses, as the UI knows them.
 *
 * The instruments themselves are Slice B0's (`public/samples/lenses.json`) and
 * the wiring that makes them sound is B1's. What Phase 4 owns is the *choice*:
 * five named lenses, one picker, and the rule that picking one changes timbre
 * and nothing else — same stars, same notes, same times.
 *
 * The titles and palettes below mirror MUSICAL_VISION §5. They are duplicated
 * here rather than fetched from the sample bundle on purpose: the picker has to
 * render before any audio asset has loaded, and a lens list that arrives late
 * would mean a screen that visibly assembles itself. The names are checked
 * against the bundle at startup (`verifyLensCatalogue`) so the two cannot drift
 * silently.
 */

import type { AudioStyle } from '../engine/index.ts';

export type LensId = 'aurora' | 'embrace' | 'sonata' | 'pulse' | 'ground';

export interface Lens {
  id: LensId;
  title: string;
  /** The reference this lens is an homage to. */
  homage: string;
  /** One line, shown under the picker. */
  palette: string;
}

export const LENSES: readonly Lens[] = [
  {
    id: 'aurora',
    title: 'Aurora',
    homage: 'Sigur Rós',
    palette: 'Bowed strings, glass and chimes. Huge, slow swells.',
  },
  {
    id: 'embrace',
    title: 'Embrace',
    homage: 'Cigarettes After Sex',
    palette: 'Felt piano over a warm cello bed. The closest, most intimate lens.',
  },
  {
    id: 'sonata',
    title: 'Sonata',
    homage: 'Beethoven',
    palette: 'Felt piano and chamber strings. The most composed lens.',
  },
  {
    id: 'pulse',
    title: 'Pulse',
    homage: 'Kid A',
    palette: 'FM keys, bowed metal, glass. The electronic lens.',
  },
  {
    id: 'ground',
    title: 'Ground',
    homage: 'handpan hours',
    palette: 'Handpan, log drum and bells over a deep drone. Endless background.',
  },
] as const;

/** Defaults per MUSICAL_VISION §5, held until Shambu says otherwise. */
export const DEFAULT_LENS_BIRTH: LensId = 'aurora';
export const DEFAULT_LENS_TONIGHT: LensId = 'ground';

export function lensById(id: string): Lens | null {
  return LENSES.find((lens) => lens.id === id) ?? null;
}

export function isLensId(value: string): value is LensId {
  return LENSES.some((lens) => lens.id === value);
}

/**
 * THE B1 SEAM.
 *
 * Today the streaming engine's only timbral dial is `AudioStyle` — 'lush' or
 * 'subtle' — so that is the honest extent of what a lens can change right now:
 * how much air and shimmer sits around the voices. The sampled instruments that
 * make Aurora sound like strings and Ground sound like a handpan are built and
 * measured (Slice B0) but are not wired into the live stream yet; that is B1
 * task #2, and it replaces this function.
 *
 * Deliberately NOT hidden behind a friendlier name: a reader should be able to
 * see exactly how far the lens currently reaches.
 */
export function audioStyleForLens(lens: LensId): AudioStyle {
  switch (lens) {
    case 'aurora':
    case 'ground':
      // The two lenses built on huge sustained space.
      return 'lush';
    case 'embrace':
    case 'sonata':
    case 'pulse':
      // The three that want the voices closer and drier.
      return 'subtle';
  }
}

/**
 * Cross-check the UI's lens list against the sample bundle B0 built.
 *
 * Returns the names that disagree, or an empty array. Called once at startup
 * and reported to the console only — a mismatch is a build-time problem for a
 * developer, never something to put in front of someone listening to a sky.
 */
export async function verifyLensCatalogue(baseUrl = './samples'): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/lenses.json`);
    if (!response.ok) return [];
    const data = (await response.json()) as { lenses?: Record<string, unknown> };
    const bundled = new Set(Object.keys(data.lenses ?? {}));
    if (bundled.size === 0) return [];
    const problems: string[] = [];
    for (const lens of LENSES) {
      if (!bundled.has(lens.id)) problems.push(`UI has "${lens.id}", the sample bundle does not`);
    }
    for (const id of bundled) {
      if (!isLensId(id)) problems.push(`the sample bundle has "${id}", the UI does not`);
    }
    return problems;
  } catch {
    // Offline, or the bundle is not deployed. Not a user-facing failure.
    return [];
  }
}
