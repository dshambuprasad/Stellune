/**
 * Living Sky — the time model (design §2).
 *
 * One number connects listening time to sky time: κ (kappa), the compression, in
 * sky-seconds per listening-second. Everything downstream depends only on local
 * sidereal time, and LST advances linearly, so the whole model is arithmetic —
 * exact, O(1), and pure. No clock is ever read here; the session's origin instant
 * arrives from the app layer inside an `ObserverInput`.
 */

import type { ObserverInput } from '../model/index.ts';
import { localSiderealTime, normalizeDegrees } from './astro.ts';

/** A sidereal day in seconds — how long the sky takes to come back around. */
export const SIDEREAL_DAY_SECONDS = 86164.0905;

/** Degrees of sky rotation per second of sky time. */
export const DEGREES_PER_SKY_SECOND = 360 / SIDEREAL_DAY_SECONDS;

/** Sky-seconds elapsed after `pieceSeconds` of listening. */
export function skySecondsAt(pieceSeconds: number, kappa: number): number {
  return pieceSeconds * kappa;
}

/** How long one full sky rotation lasts, in listening seconds. */
export function siderealPeriodInPiece(kappa: number): number {
  return SIDEREAL_DAY_SECONDS / kappa;
}

/** Local sidereal time, in degrees, after `pieceSeconds` of listening. */
export function lstAt(lst0: number, pieceSeconds: number, kappa: number): number {
  return normalizeDegrees(lst0 + skySecondsAt(pieceSeconds, kappa) * DEGREES_PER_SKY_SECOND);
}

/** The session's starting sidereal time — the one place the observer is read. */
export function sessionLst0(observer: ObserverInput): number {
  return localSiderealTime(observer);
}

/**
 * The first listening time at or after 0 when local sidereal time equals
 * `targetLst`. Every later occurrence is one sidereal period further on.
 */
export function firstTimeAtLst(lst0: number, targetLst: number, kappa: number): number {
  const degreesToGo = normalizeDegrees(targetLst - lst0);
  return degreesToGo / DEGREES_PER_SKY_SECOND / kappa;
}

/**
 * Every listening time in `[from, to)` at which local sidereal time equals
 * `targetLst`.
 *
 * This is the workhorse behind partition invariance: occurrences are computed
 * from absolute piece time and a fixed origin, never from where a window happens
 * to begin, so the same event lands at the same instant no matter how the stream
 * is sliced.
 */
export function occurrencesInRange(
  lst0: number,
  targetLst: number,
  kappa: number,
  from: number,
  to: number,
): number[] {
  if (!(to > from)) return [];

  const period = siderealPeriodInPiece(kappa);
  const first = firstTimeAtLst(lst0, targetLst, kappa);

  const times: number[] = [];
  // Step back one period first: an occurrence slightly before `first` can still
  // be the one that lands inside the range when `from` is negative.
  const startIndex = Math.ceil((from - first) / period);
  for (let n = startIndex; ; n++) {
    const t = first + n * period;
    if (t >= to) break;
    if (t >= from) times.push(t);
    // Guard against a pathological period; never loop forever.
    if (times.length > 100000) break;
  }
  return times;
}
