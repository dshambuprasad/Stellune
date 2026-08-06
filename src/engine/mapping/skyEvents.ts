/**
 * Living Sky — true-event detection (design §4).
 *
 * Rise, culmination and set have exact closed-form solutions in sidereal time.
 * No numerical root-finding, no sampling, no tolerance parameters:
 *
 *     cos H = (sin A − sin dec · sin lat) / (cos dec · cos lat)
 *
 * is the hour angle at which a star sits at altitude A. Setting A = 0 gives the
 * horizon (rise at −H, set at +H); culmination is always H = 0. The same formula
 * answers "when does this star cross 55°", which is what the octave lift needs.
 *
 * Everything here is pure and O(1) per star.
 */

import type { Star } from '../model/index.ts';
import { normalizeDegrees } from './astro.ts';

const DEG = Math.PI / 180;

/** How a star behaves from a given latitude, over a whole sidereal day. */
export type StarVisibility = 'never-rises' | 'circumpolar' | 'rises-and-sets';

export interface StarEventTimes {
  visibility: StarVisibility;
  /** Highest altitude this star ever reaches from here: 90 − |lat − dec|. */
  maxAltitude: number;
  /** Sidereal time of culmination — always defined; equals the star's RA. */
  culminationLst: number;
  /** Sidereal time of rising. Absent when circumpolar or never up. */
  riseLst?: number;
  /** Sidereal time of setting. Absent when circumpolar or never up. */
  setLst?: number;
  /** Hours above the horizon per sidereal day. 24 when circumpolar. */
  hoursAboveHorizon: number;
}

/**
 * The hour angle, in degrees, at which a star crosses altitude `altitudeDeg`.
 *
 * Returns `null` when the star never reaches that altitude (or never drops to
 * it). The result is the positive solution; the star is at that altitude at both
 * −H and +H, descending and ascending respectively.
 */
export function hourAngleAtAltitude(
  declination: number,
  latitude: number,
  altitudeDeg: number,
): number | null {
  const cosDec = Math.cos(declination * DEG);
  const cosLat = Math.cos(latitude * DEG);
  const denominator = cosDec * cosLat;

  // At a pole, or looking at the pole star itself, the denominator vanishes: the
  // star's altitude never changes, so there is no crossing.
  if (Math.abs(denominator) < 1e-12) return null;

  const cosH =
    (Math.sin(altitudeDeg * DEG) - Math.sin(declination * DEG) * Math.sin(latitude * DEG)) /
    denominator;

  if (!Number.isFinite(cosH) || cosH > 1 || cosH < -1) return null;
  return Math.acos(cosH) / DEG;
}

/**
 * Everything that ever happens to one star, from one latitude.
 *
 * Measured behaviour of the three regimes, for stars brighter than magnitude 2.5
 * (see the design note §P7): at the equator all 92 rise and set; from London 45
 * rise and set, 21 are circumpolar and 26 never appear; at latitude 89.5° only
 * ONE rises and sets. That is why culmination — which every visible star has, in
 * every regime — is the load-bearing event and rise/set are colour.
 */
export function starEventTimes(star: Star, latitude: number): StarEventTimes {
  const maxAltitude = 90 - Math.abs(latitude - star.dec);
  const culminationLst = normalizeDegrees(star.ra);

  // Minimum altitude, reached at the anti-meridian: −90 + |lat + dec|.
  const minAltitude = -90 + Math.abs(latitude + star.dec);

  if (maxAltitude <= 0) {
    return { visibility: 'never-rises', maxAltitude, culminationLst, hoursAboveHorizon: 0 };
  }
  if (minAltitude > 0) {
    return { visibility: 'circumpolar', maxAltitude, culminationLst, hoursAboveHorizon: 24 };
  }

  const h0 = hourAngleAtAltitude(star.dec, latitude, 0);
  if (h0 === null) {
    // Degenerate geometry (an observer exactly at a pole, or a star exactly at
    // one): treat as circumpolar if it is up at all, which `maxAltitude` decided.
    return { visibility: 'circumpolar', maxAltitude, culminationLst, hoursAboveHorizon: 24 };
  }

  return {
    visibility: 'rises-and-sets',
    maxAltitude,
    culminationLst,
    riseLst: normalizeDegrees(star.ra - h0),
    setLst: normalizeDegrees(star.ra + h0),
    hoursAboveHorizon: (2 * h0) / 15,
  };
}

/** One real thing the sky did, at one moment of the piece. */
export interface SkyEvent {
  kind: 'rise' | 'culmination' | 'set';
  star: Star;
  /** Absolute piece time, seconds. */
  pieceSeconds: number;
  /** Sky time elapsed since the session origin, seconds. */
  skySeconds: number;
  /** Altitude at the event: 0 for rise and set, the maximum at culmination. */
  altitude: number;
}
