/**
 * Living Sky — constellation motifs and development transforms (design §7).
 *
 * A constellation's internal geometry never changes: Orion keeps the same shape
 * from every place on Earth, on every date, for a human lifetime. So a motif is
 * *discovered* in the data rather than authored — it is a path through the
 * constellation's brightest stars, with the contour taken from how high each
 * star sits in the figure and the rhythm from how far apart they are.
 *
 * **Wording matters.** This is "a path through its brightest stars", NOT a stick
 * figure. We have no asterism-line data and no permissively-licensed source has
 * been verified, so we must not claim the cultural figure (design §P1, ruled).
 *
 * ---
 *
 * THE ON-SCALE GUARANTEE, AND WHY IT SURVIVES DEVELOPMENT
 *
 * Every transform here operates on **scale-degree indices**, never on semitones.
 * A degree is an unbounded integer position on the scale's ladder; it becomes a
 * pitch only at the very end, through `degreeToMidi`. Inversion in semitone space
 * would break the guarantee instantly — inverting a minor third gives a major
 * sixth, which need not be in the scale. Inversion in degree space *cannot*:
 * `2·pivot − d` is an integer, and every integer is a rung on the ladder.
 */

import type { Star } from '../model/index.ts';
import { scaleDegrees } from './scales.ts';

const DEG = Math.PI / 180;

/** Great-circle separation between two stars, in degrees. */
export function angularSeparation(a: Star, b: Star): number {
  const cosine =
    Math.sin(a.dec * DEG) * Math.sin(b.dec * DEG) +
    Math.cos(a.dec * DEG) * Math.cos(b.dec * DEG) * Math.cos((a.ra - b.ra) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, cosine))) / DEG;
}

// ------------------------------------------------------- degree arithmetic

/**
 * A scale-degree index → a MIDI pitch on the configured ladder.
 *
 * Accepts ANY integer, positive or negative. Out-of-range results are folded by
 * whole octaves rather than clamped, because folding preserves the pitch class
 * and clamping would not — a clamp is exactly how an off-scale note would sneak
 * in at the edges.
 */
export function degreeToMidi(degree: number, rootMidi: number, scale: string): number {
  const degrees = scaleDegrees(scale);
  const n = degrees.length;

  const octave = Math.floor(degree / n);
  const index = ((degree % n) + n) % n;
  let midi = rootMidi + 12 * octave + (degrees[index] as number);

  while (midi > 127) midi -= 12;
  while (midi < 0) midi += 12;
  return midi;
}

/** Move a figure up or down the ladder by whole degrees. */
export function transposeDegrees(sequence: number[], steps: number): number[] {
  return sequence.map((d) => d + steps);
}

/**
 * Turn a figure upside down about a pivot.
 *
 * Used when a star or a constellation is **setting**: the phrase descends
 * because the thing it describes is literally going down.
 */
export function invertDegrees(sequence: number[], pivot?: number): number[] {
  const centre = pivot ?? sequence[0] ?? 0;
  return sequence.map((d) => 2 * centre - d);
}

/** Stretch (k > 1) or compress (k < 1) a figure's rhythm. */
export function scaleGaps(gaps: number[], factor: number): number[] {
  return gaps.map((g) => g * factor);
}

/** Shift by whole octaves — always a whole number of degrees, so still on-scale. */
export function shiftOctaves(sequence: number[], octaves: number, degreesPerOctave: number): number[] {
  return sequence.map((d) => d + octaves * degreesPerOctave);
}

// ------------------------------------------------------------ the motif

export interface Motif {
  constellation: string;
  /** The path, in playing order. */
  starIds: string[];
  /** Scale-degree offsets, relative to the figure's own centre. */
  degrees: number[];
  /** Onset gaps between consecutive notes, in seconds at unit tempo. */
  gaps: number[];
  /** Total angular length of the path, degrees — how spread the figure is. */
  pathLength: number;
  /** Mean right ascension of the group (vector mean; handles the 0/360 wrap). */
  meanRa: number;
  meanDec: number;
  /** Combined brightness, for salience. */
  totalFlux: number;
}

/** Contour range: how many degrees above and below centre the figure may reach. */
const CONTOUR_RANGE = 3;
/** Seconds per degree of angular separation, before any augmentation. */
const SECONDS_PER_DEGREE = 0.16;
const MIN_GAP_SECONDS = 0.45;
const MAX_GAP_SECONDS = 2.6;

const MOTIF_MAG_LIMIT = 3;
const MOTIF_MAX_STARS = 5;
const MOTIF_MIN_STARS = 3;

function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The exact shortest open path through the stars — brute-forced, not heuristic.
 *
 * With five nodes there are 120 orderings, so the optimum is simply computed.
 * A greedy nearest-neighbour walk was tried first and produced ugly 17–26°
 * closing jumps (measured on Orion, Ursa Major and Scorpius); the exact path
 * removes them.
 */
function shortestPath(stars: Star[]): { path: Star[]; length: number } {
  const n = stars.length;
  let best: number[] | null = null;
  let bestLength = Infinity;

  const permute = (remaining: number[], current: number[]): void => {
    if (remaining.length === 0) {
      let length = 0;
      for (let i = 1; i < current.length; i++) {
        length += angularSeparation(
          stars[current[i - 1] as number] as Star,
          stars[current[i] as number] as Star,
        );
      }
      const key = current.map((i) => (stars[i] as Star).id).join(',');
      const bestKey = best?.map((i) => (stars[i] as Star).id).join(',') ?? '';
      if (length < bestLength - 1e-9 || (Math.abs(length - bestLength) < 1e-9 && key < bestKey)) {
        bestLength = length;
        best = [...current];
      }
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      const rest = [...remaining];
      const [taken] = rest.splice(i, 1);
      permute(rest, [...current, taken as number]);
    }
  };

  permute([...Array(n).keys()], []);
  const order = (best ?? [...Array(n).keys()]) as number[];
  const path = order.map((i) => stars[i] as Star);

  // Orient from the brighter end, so the figure opens on its strongest star.
  const first = path[0] as Star;
  const last = path[path.length - 1] as Star;
  if (last.mag < first.mag) path.reverse();

  return { path, length: bestLength };
}

/**
 * Derive one constellation's motif, or `null` if it has too few bright stars.
 *
 * Measured on the bundled catalogue: of 89 constellations present, 31 have three
 * or more stars brighter than magnitude 3 and only 20 have four or more. Motifs
 * are therefore an occasional guest, not a constant presence — which is the
 * Beethoven dose the Vision asks for.
 *
 * Everything here is computed in RA/Dec, so the result is **identical from every
 * place on Earth and on every date**. That is the property the identity claim
 * rests on.
 */
export function deriveMotif(catalog: Star[], constellation: string): Motif | null {
  const members = catalog
    .filter((s) => s.constellation === constellation && s.mag < MOTIF_MAG_LIMIT)
    .sort((a, b) => a.mag - b.mag || compareIds(a.id, b.id));

  if (members.length < MOTIF_MIN_STARS) return null;

  const chosen = members.slice(0, MOTIF_MAX_STARS);
  const { path, length } = shortestPath(chosen);

  // Contour: higher in the figure sounds higher. Declination is measured from
  // the celestial equator, so "up" means the same thing everywhere.
  const decs = path.map((s) => s.dec);
  const centre = decs.reduce((a, b) => a + b, 0) / decs.length;
  const halfSpan = Math.max(1e-9, (Math.max(...decs) - Math.min(...decs)) / 2);
  const degrees = path.map((s) => {
    const d = Math.round(((s.dec - centre) / halfSpan) * CONTOUR_RANGE);
    return Object.is(d, -0) ? 0 : d;
  });

  // Rhythm: stars further apart on the sky are further apart in time.
  const gaps = path.slice(1).map((s, i) => {
    const separation = angularSeparation(path[i] as Star, s);
    return Math.min(MAX_GAP_SECONDS, Math.max(MIN_GAP_SECONDS, separation * SECONDS_PER_DEGREE));
  });

  // Vector mean of right ascension, so a group straddling 0h behaves.
  let sx = 0;
  let sy = 0;
  for (const s of path) {
    sx += Math.cos(s.ra * DEG);
    sy += Math.sin(s.ra * DEG);
  }
  const meanRa = ((Math.atan2(sy, sx) / DEG) + 360) % 360;

  return {
    constellation,
    starIds: path.map((s) => s.id),
    degrees,
    gaps,
    pathLength: round(length, 4),
    meanRa: round(meanRa, 6),
    meanDec: round(centre, 6),
    totalFlux: round(
      path.reduce((total, s) => total + 10 ** (-0.4 * s.mag), 0),
      6,
    ),
  };
}

/** Every constellation that can carry a motif, in a stable order. */
export function deriveAllMotifs(catalog: Star[]): Motif[] {
  const names = [...new Set(catalog.map((s) => s.constellation).filter(Boolean))].sort() as string[];
  const motifs: Motif[] = [];
  for (const name of names) {
    const motif = deriveMotif(catalog, name);
    if (motif) motifs.push(motif);
  }
  return motifs;
}

function round(v: number, p: number): number {
  const f = 10 ** p;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
