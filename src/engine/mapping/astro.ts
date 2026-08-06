/**
 * Layer 2 — astronomy reduction (pure, deterministic).
 *
 * Standard alt/az reduction, following Meeus, *Astronomical Algorithms*
 * (ch. 7 Julian Day, ch. 12 sidereal time, ch. 13 coordinate transformation).
 * Degrees in, degrees out; radians live only inside the trig calls.
 *
 * The pipeline:
 *   dateISO + timeMinutes − tzOffsetMinutes  →  a UTC instant
 *                                            →  Julian Date
 *                                            →  GMST  (Greenwich mean sidereal time)
 *                                            →  LST   = GMST + longitude
 *                                            →  H     = LST − RA        (hour angle)
 *   sin(alt) = sin(dec)·sin(lat) + cos(dec)·cos(lat)·cos(H)
 *   Az       = atan2(−cos(dec)·sin(H), sin(dec)·cos(lat) − cos(dec)·sin(lat)·cos(H))
 *
 * Nothing here reads a clock, allocates randomness, or touches the DOM. The same
 * `ObserverInput` yields the same sky forever — which is the whole promise of a
 * birth-sky keepsake.
 *
 * Stated simplifications (repeated in the UI and in docs/SPEC.md):
 *   - J2000 coordinates; precession is NOT applied. It drifts ~50"/year, so a
 *     1990s birth date is off by well under half a degree — invisible next to the
 *     ~15°-per-hour error that daylight saving already introduces.
 *   - No atmospheric refraction (~34' at the horizon), no parallax, no proper
 *     motion, no nutation, no aberration.
 *   - Geometric horizon: a star counts as visible when its altitude is > 0.
 */

import type { HorizonStar, ObserverInput, Star } from '../model/index.ts';

const DEG = Math.PI / 180;

/** JD of the J2000.0 epoch: 2000 January 1, 12:00 TT. */
const J2000 = 2451545.0;

const MINUTES_PER_DAY = 1440;

/** Wrap to [0, 360). */
export function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Wrap to [−180, 180) — the natural range for an hour angle. */
export function normalizeHourAngle(degrees: number): number {
  return normalizeDegrees(degrees + 180) - 180;
}

/**
 * Split "YYYY-MM-DD" into its parts.
 *
 * Throws rather than guessing. A malformed date that quietly became "some other
 * day" would produce a plausible-looking sky that is simply not yours, and this
 * project's entire claim is that the structure is true.
 */
function parseDateISO(dateISO: string): { year: number; month: number; day: number } {
  const match = /^(-?\d{4,})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) {
    throw new Error(
      `Cosmophony: dateISO must look like "1993-08-01", but got ${JSON.stringify(dateISO)}.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new Error(`Cosmophony: month ${month} in "${dateISO}" is not between 01 and 12.`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`Cosmophony: day ${day} in "${dateISO}" is not between 01 and 31.`);
  }
  return { year, month, day };
}

/**
 * Julian Date for the UTC instant an `ObserverInput` describes.
 *
 * Meeus ch. 7, Gregorian calendar branch — correct for every date after
 * 1582-10-15, which covers every birth date this app will ever see.
 *
 * `timeMinutes` defaults to 0 (local midnight, per the model contract) and the
 * city's fixed UTC offset is subtracted to reach UTC. The day number is allowed
 * to run fractional and even outside its month: the formula is linear in the day
 * term, so a local time that crosses midnight into the previous or next day
 * resolves correctly without any calendar rollover logic.
 */
export function julianDate(obs: ObserverInput): number {
  const { year, month, day } = parseDateISO(obs.dateISO);

  const localMinutes = obs.timeMinutes ?? 0;
  if (!Number.isFinite(localMinutes)) {
    throw new Error(`Cosmophony: timeMinutes must be a finite number, got ${obs.timeMinutes}.`);
  }
  if (!Number.isFinite(obs.tzOffsetMinutes)) {
    throw new Error(
      `Cosmophony: tzOffsetMinutes must be a finite number, got ${obs.tzOffsetMinutes}.`,
    );
  }

  const utcMinutes = localMinutes - obs.tzOffsetMinutes;
  const dayWithFraction = day + utcMinutes / MINUTES_PER_DAY;

  // January and February count as months 13 and 14 of the previous year.
  const y = month <= 2 ? year - 1 : year;
  const m = month <= 2 ? month + 12 : month;

  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4); // Gregorian correction

  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    dayWithFraction +
    b -
    1524.5
  );
}

/**
 * Greenwich Mean Sidereal Time in degrees, for any instant. Meeus eq. 12.4.
 *
 * Mean, not apparent — nutation (the equation of the equinoxes, under 1.2") is
 * not applied.
 */
export function greenwichMeanSiderealTime(jd: number): number {
  if (!Number.isFinite(jd)) {
    throw new Error(`Cosmophony: julian date must be a finite number, got ${jd}.`);
  }
  const d = jd - J2000;
  const t = d / 36525; // Julian centuries from J2000

  const gmst =
    280.46061837 +
    360.98564736629 * d +
    0.000387933 * t * t -
    (t * t * t) / 38710000;

  return normalizeDegrees(gmst);
}

/** Local Mean Sidereal Time in degrees; longitude is + east. */
export function localSiderealTime(obs: ObserverInput): number {
  if (!Number.isFinite(obs.longitude)) {
    throw new Error(`Cosmophony: longitude must be a finite number, got ${obs.longitude}.`);
  }
  return normalizeDegrees(greenwichMeanSiderealTime(julianDate(obs)) + obs.longitude);
}

/**
 * Reduce one star to the observer's horizon frame.
 *
 * Azimuth is measured from north through east (0 = N, 90 = E, 180 = S, 270 = W).
 * Exported for testing and for the Phase 4 star-field; `starsAboveHorizon` is
 * what callers normally want.
 *
 * At the exact zenith the azimuth is genuinely undefined — every direction is
 * "down". `Math.atan2(0, 0)` returns 0, so the star is reported due north. That
 * is arbitrary but deterministic, and a star within a hair of the zenith has no
 * meaningful compass bearing anyway.
 */
export function toHorizon(star: Star, latitude: number, lst: number): HorizonStar {
  const latRad = latitude * DEG;
  const decRad = star.dec * DEG;
  const hourAngleRad = normalizeHourAngle(lst - star.ra) * DEG;

  const sinAltitude =
    Math.sin(decRad) * Math.sin(latRad) +
    Math.cos(decRad) * Math.cos(latRad) * Math.cos(hourAngleRad);

  // Guard the rounding that can push |sin| a hair past 1 near the zenith.
  const altitude = Math.asin(Math.min(1, Math.max(-1, sinAltitude))) / DEG;

  const azimuth =
    Math.atan2(
      -Math.cos(decRad) * Math.sin(hourAngleRad),
      Math.sin(decRad) * Math.cos(latRad) - Math.cos(decRad) * Math.sin(latRad) * Math.cos(hourAngleRad),
    ) / DEG;

  return { star, altitude, azimuth: normalizeDegrees(azimuth) };
}

/**
 * Every star in the catalogue that is above the observer's horizon, in catalogue
 * order — so identical input yields an identical array, values and ordering both.
 *
 * "Above the horizon" means altitude strictly greater than 0: the geometric
 * horizon, with no refraction correction. A star sitting exactly on the horizon
 * is excluded, which is the conservative choice.
 */
export function starsAboveHorizon(catalog: Star[], obs: ObserverInput): HorizonStar[] {
  if (!Number.isFinite(obs.latitude) || Math.abs(obs.latitude) > 90) {
    throw new Error(
      `Cosmophony: latitude must be between −90 and 90 degrees, got ${obs.latitude}.`,
    );
  }

  // Sidereal time is a property of the moment, not of any one star — compute it
  // once for the whole catalogue rather than ~9,000 times.
  const lst = localSiderealTime(obs);

  const visible: HorizonStar[] = [];
  for (const star of catalog) {
    const horizon = toHorizon(star, obs.latitude, lst);
    if (horizon.altitude > 0) visible.push(horizon);
  }
  return visible;
}
