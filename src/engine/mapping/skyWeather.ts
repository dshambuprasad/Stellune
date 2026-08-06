/**
 * Living Sky — emotional weather (design §8, Musical Vision §2.3).
 *
 * The sky's own statistics choose the emotional weather. Nothing here is
 * invented: every input is a measurement of what is actually above the horizon,
 * and the three output dials are smooth functions of those measurements — no
 * hard categories, per the Vision.
 *
 * A lonely sky sounds lonely because it *is* lonely, and the numbers say so.
 */

import type { ObserverInput, Star } from '../model/index.ts';
import { toHorizon } from './astro.ts';
import type { ScaleName } from './scales.ts';
import type { SkyWeather } from './types.ts';

const DEG = Math.PI / 180;

/** Linear light from a magnitude. */
const flux = (mag: number): number => 10 ** (-0.4 * mag);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const unsign = (v: number): number => (Object.is(v, -0) ? 0 : v);
const round = (v: number, p: number): number => {
  const f = 10 ** p;
  return unsign(Math.round(v * f) / f);
};

// ---- normalisation references -------------------------------------------
// Tuning constants, chosen against the bundled catalogue: a rich low-latitude
// sky puts roughly 4,300 of the 8,849 stars above the horizon, so these are the
// scale against which "how much is up" is judged.

const REFERENCE_VISIBLE = 3200;
const REFERENCE_BRIGHTNESS = 260;
const BRIGHTEST_FLOOR_MAG = 3.5;
const BRIGHTEST_CEILING_MAG = -1.5;

/** Sky cells for the clustering measure: 12 azimuth × 6 altitude bands. */
const AZIMUTH_CELLS = 12;
const ALTITUDE_CELLS = 6;

/**
 * Measure the sky above an observer at one instant.
 *
 * `lst` is passed rather than derived so a caller sampling many moments does the
 * sidereal arithmetic once.
 */
export function measureWeather(catalog: Star[], latitude: number, lst: number): SkyWeather {
  let visibleCount = 0;
  let integratedBrightness = 0;
  let brightestMag = 99;

  // Brightness-weighted mean direction, accumulated as a vector so it behaves
  // correctly across the azimuth wrap-around.
  let vx = 0;
  let vy = 0;
  let vz = 0;

  const cells = new Map<number, number>();
  const visible: Array<{ altitude: number; azimuth: number }> = [];

  for (const star of catalog) {
    const { altitude, azimuth } = toHorizon(star, latitude, lst);
    if (altitude <= 0) continue;

    visibleCount++;
    const f = flux(star.mag);
    integratedBrightness += f;
    if (star.mag < brightestMag) brightestMag = star.mag;

    const altRad = altitude * DEG;
    const azRad = azimuth * DEG;
    const cosAlt = Math.cos(altRad);
    vx += f * cosAlt * Math.cos(azRad);
    vy += f * cosAlt * Math.sin(azRad);
    vz += f * Math.sin(altRad);

    visible.push({ altitude, azimuth });

    const cell =
      Math.min(AZIMUTH_CELLS - 1, Math.floor((azimuth / 360) * AZIMUTH_CELLS)) * ALTITUDE_CELLS +
      Math.min(ALTITUDE_CELLS - 1, Math.floor((altitude / 90) * ALTITUDE_CELLS));
    cells.set(cell, (cells.get(cell) ?? 0) + 1);
  }

  if (visibleCount === 0) {
    return {
      visibleCount: 0,
      integratedBrightness: 0,
      brightestMag: 99,
      spread: 0,
      clustering: 0,
      density: 0,
      luminosity: 0,
      solitude: 1,
    };
  }

  // Mean angular distance from the brightness centroid.
  const norm = Math.hypot(vx, vy, vz);
  let spread = 0;
  if (norm > 0) {
    const cx = vx / norm;
    const cy = vy / norm;
    const cz = vz / norm;
    let total = 0;
    for (const { altitude, azimuth } of visible) {
      const altRad = altitude * DEG;
      const azRad = azimuth * DEG;
      const cosAlt = Math.cos(altRad);
      const dot =
        cx * cosAlt * Math.cos(azRad) + cy * cosAlt * Math.sin(azRad) + cz * Math.sin(altRad);
      total += Math.acos(clamp(dot, -1, 1)) / DEG;
    }
    spread = total / visible.length;
  }

  // Clustering: the share of visible stars sitting in the densest tenth of the
  // occupied cells. The galactic band genuinely shows up as a concentration of
  // naked-eye stars, so this is an honest Milky Way proxy computed from the
  // catalogue alone — no new data.
  const counts = [...cells.values()].sort((a, b) => b - a);
  const topCells = Math.max(1, Math.round(counts.length * 0.1));
  const inTop = counts.slice(0, topCells).reduce((a, b) => a + b, 0);
  const clustering = clamp(inTop / visibleCount / (topCells / Math.max(1, counts.length)) / 10, 0, 1);

  // ---- the three dials
  const countDial = clamp(visibleCount / REFERENCE_VISIBLE, 0, 1);
  const lightDial = clamp(integratedBrightness / REFERENCE_BRIGHTNESS, 0, 1);
  const density = clamp(0.6 * countDial + 0.4 * lightDial, 0, 1);

  const brightestDial = clamp(
    (BRIGHTEST_FLOOR_MAG - brightestMag) / (BRIGHTEST_FLOOR_MAG - BRIGHTEST_CEILING_MAG),
    0,
    1,
  );
  const luminosity = clamp(0.55 * lightDial + 0.45 * brightestDial, 0, 1);

  return {
    visibleCount,
    integratedBrightness: round(integratedBrightness, 3),
    brightestMag: round(brightestMag, 2),
    spread: round(spread, 2),
    clustering: round(clustering, 4),
    density: round(density, 4),
    luminosity: round(luminosity, 4),
    solitude: round(1 - density, 4),
  };
}

/** Average several weather samples into one, for a session-level decision. */
export function meanWeather(samples: SkyWeather[]): SkyWeather {
  if (samples.length === 0) {
    return {
      visibleCount: 0,
      integratedBrightness: 0,
      brightestMag: 99,
      spread: 0,
      clustering: 0,
      density: 0,
      luminosity: 0,
      solitude: 1,
    };
  }
  const mean = (pick: (w: SkyWeather) => number): number =>
    samples.reduce((total, w) => total + pick(w), 0) / samples.length;

  return {
    visibleCount: Math.round(mean((w) => w.visibleCount)),
    integratedBrightness: round(mean((w) => w.integratedBrightness), 3),
    brightestMag: round(Math.min(...samples.map((w) => w.brightestMag)), 2),
    spread: round(mean((w) => w.spread), 2),
    clustering: round(mean((w) => w.clustering), 4),
    density: round(mean((w) => w.density), 4),
    luminosity: round(mean((w) => w.luminosity), 4),
    solitude: round(mean((w) => w.solitude), 4),
  };
}

/**
 * The scale ladder, ordered from most solitary to most grandiose.
 *
 * All five are already implemented and all are drone-safe (no tritone or minor
 * second against the root).
 */
export const WEATHER_SCALES: readonly ScaleName[] = [
  'minor-pentatonic',
  'aeolian',
  'dorian',
  'major-pentatonic',
  'lydian',
];

/**
 * Pick the session's scale from its mean weather.
 *
 * Chosen ONCE per session and never changed: modulating the scale mid-piece
 * would either force a key change under a sustained drone or produce off-scale
 * notes during the crossfade, which breaks the guarantee outright (design §P5,
 * approved). Within a session only density, register, silence and layer count
 * move — all continuous, all safe.
 */
export function scaleForWeather(weather: SkyWeather): ScaleName {
  const index = clamp(Math.round(weather.luminosity * (WEATHER_SCALES.length - 1)), 0, WEATHER_SCALES.length - 1);
  return WEATHER_SCALES[index] as ScaleName;
}

/** How many octaves the chord may spread over: lonely skies stay small. */
export function registerSpanOctaves(weather: SkyWeather): number {
  return weather.density < 0.35 ? 2 : 3;
}

/** Fraction of each phrase period that must contain no lead note. */
export function silenceBudget(weather: SkyWeather): number {
  return round(0.7 - 0.35 * weather.density, 4);
}

/** Ceiling on lead notes per minute. */
export function noteBudgetPerMinute(weather: SkyWeather): number {
  return round(4 + 8 * weather.density, 4);
}

/** How many chimes the Conductor may place in one phrase period. */
export function notesPerPhrase(weather: SkyWeather): number {
  return weather.density < 0.3 ? 1 : weather.density < 0.7 ? 2 : 3;
}

/** Convenience for a caller that has an observer rather than a latitude + LST. */
export function weatherForObserver(catalog: Star[], observer: ObserverInput, lst: number): SkyWeather {
  return measureWeather(catalog, observer.latitude, lst);
}
