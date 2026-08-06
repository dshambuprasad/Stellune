/**
 * Layer 2 — sonification: the heart.
 *
 * Same (input, config) ⇒ identical score, always. No Tone.js, no DOM, no clock,
 * no `Math.random()`.
 *
 * Every mapping below is physically honest, and that is exactly what makes the
 * result lovely rather than arbitrary:
 *
 *   altitude  → pitch      higher in the sky sounds higher, then quantized to
 *                          the scale so the chord is always consonant
 *   magnitude → amplitude  brighter is louder, on a decibel scale — which is
 *                          what a magnitude already is
 *   B–V       → timbre     hot blue stars glassier, cool red stars warmer
 *   azimuth   → pan        the east-west component of the direction you'd face
 *   altitude  → twinkle    derived from airmass; low stars really do scintillate
 *
 * v1 is a static birth-moment chord: every voice starts at 0 and sustains for
 * the whole loop, breathing via the audio layer's slow LFOs. Advancing the sky so
 * stars rise and set across the loop is a roadmap item, not this.
 */

import type { HorizonStar } from '../model/index.ts';
import { pitchClassName, scaleDegrees } from './scales.ts';
import type { MappingConfig, MusicalEvent, MusicalScore, TimbreParams } from './types.ts';

/** The default mood: one tweakable constant, per the locked decisions. */
export const DEFAULT_MAPPING_CONFIG: MappingConfig = {
  scale: 'minor-pentatonic',
  rootMidi: 45, // A2
  maxVoices: 8,
  loopSeconds: 18,
  seed: 1,
};

// ------------------------------------------------------- tuning constants
// The artistic dials. Everything else follows from the data.

/** How many octaves the sky's altitude range spans, from the root upward. */
export const PITCH_SPAN_OCTAVES = 3;

/**
 * Magnitudes mapped to the loudest and quietest voices. Sirius is −1.44 and the
 * bundled catalogue stops at 6.5, so this covers the whole naked-eye range.
 */
const MAG_LOUDEST = -1.5;
const MAG_FAINTEST = 6.5;

/**
 * Dynamic range across that magnitude span, in decibels.
 *
 * A magnitude IS a logarithmic measure of flux, so mapping magnitude linearly to
 * decibels is the physically faithful choice. Untouched, the 8-magnitude span
 * would be ~32 dB (4 dB per magnitude); 24 dB is a gentle compression, so the
 * faintest star still whispers at about 6% amplitude instead of vanishing.
 */
const DYNAMIC_RANGE_DB = 24;

/** B–V bounds for the timbre ramp: hot blue-white through cool deep red. */
const BV_HOT = -0.4;
const BV_COOL = 2.0;

/**
 * B–V assumed when the catalogue has none (about 40 of 8,849 stars). Roughly
 * solar — a neutral, mid-warmth voice rather than an accidental extreme.
 */
const BV_DEFAULT = 0.65;

/**
 * Stereo width. Full ±1 hard-panning sounds unnatural on headphones and pushes a
 * due-east star entirely out of one ear; 0.85 keeps the compass legible while
 * leaving the image whole.
 */
const PAN_WIDTH = 0.85;

/**
 * Airmass at which twinkle reaches full depth — sec(z) = 5 is an altitude of
 * about 11.5°. Scintillation grows with the amount of atmosphere a star is seen
 * through, and below roughly this altitude it is dramatic to the naked eye.
 */
const TWINKLE_MAX_AIRMASS = 5;

// -------------------------------------------------------------- utilities

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Normalise -0 to 0 so deep-equality between runs is never surprised. */
const unsign = (value: number): number => (Object.is(value, -0) ? 0 : value);

/** Round to `places` decimals, keeping scores stable and diffable. */
const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return unsign(Math.round(value * factor) / factor);
};

// ------------------------------------------------------- the mappings

/**
 * Altitude → a MIDI pitch that is always a member of the scale.
 *
 * The horizon-to-zenith sweep is divided into `PITCH_SPAN_OCTAVES` octaves of
 * scale degrees and the altitude picks the nearest step, so a pitch off the scale
 * is not merely unlikely — it is unrepresentable.
 *
 * Two stars at the same altitude land on the same pitch. That is left alone
 * rather than nudged apart: they really are at the same height, the unison is
 * consonant by construction, and their different pans and timbres turn the
 * doubling into a natural chorus.
 */
export function altitudeToMidi(altitude: number, rootMidi: number, scale: string): number {
  const degrees = scaleDegrees(scale);
  const steps = degrees.length * PITCH_SPAN_OCTAVES;

  const normalized = clamp(altitude, 0, 90) / 90;
  const step = Math.round(normalized * (steps - 1));

  const octave = Math.floor(step / degrees.length);
  const degree = degrees[step % degrees.length] as number;

  return clamp(Math.round(rootMidi + 12 * octave + degree), 0, 127);
}

/**
 * Apparent magnitude → amplitude in 0..1, brightest at 1.
 *
 * Equal magnitude steps become equal decibel steps, which is both physically
 * true and perceptually even.
 */
export function magnitudeToAmplitude(mag: number): number {
  const brightness = clamp((MAG_FAINTEST - mag) / (MAG_FAINTEST - MAG_LOUDEST), 0, 1);
  const decibels = -DYNAMIC_RANGE_DB * (1 - brightness);
  return 10 ** (decibels / 20);
}

/** B–V colour index → timbre. Hot stars are bright and glassy, cool stars warm. */
export function colourToTimbre(bv: number | undefined): TimbreParams {
  const index = bv ?? BV_DEFAULT;
  const warmth = clamp((index - BV_HOT) / (BV_COOL - BV_HOT), 0, 1);
  return { warmth: round(warmth, 4), brightness: round(1 - warmth, 4) };
}

/**
 * Azimuth → stereo position in −1..1.
 *
 * `sin(azimuth)` is precisely the east-west component of the direction you would
 * face to look at the star: due east is +1, due west is −1, and north and south
 * sit in the middle, which is exactly right — a star straight ahead or behind has
 * no left-right bias. The sine also compresses the image naturally near the
 * meridian rather than needing an arbitrary curve.
 */
export function azimuthToPan(azimuth: number): number {
  return PAN_WIDTH * Math.sin(azimuth * (Math.PI / 180));
}

/**
 * Altitude → twinkle depth in 0..1, from airmass.
 *
 * Airmass ≈ 1/sin(altitude): the amount of atmosphere the starlight crosses. At
 * the zenith it is 1 and the star is steady; near the horizon it climbs steeply
 * and the star scintillates. Depth reaches full at `TWINKLE_MAX_AIRMASS`.
 */
export function altitudeToTwinkle(altitude: number): number {
  const sinAltitude = Math.sin(clamp(altitude, 0, 90) * (Math.PI / 180));
  if (sinAltitude <= 0) return 1;
  const airmass = 1 / sinAltitude;
  return clamp((airmass - 1) / (TWINKLE_MAX_AIRMASS - 1), 0, 1);
}

// ------------------------------------------------------------- validation

function validateConfig(config: MappingConfig): void {
  // Throws on a bad scale name, with the available names listed.
  scaleDegrees(config.scale);

  if (!Number.isFinite(config.rootMidi) || config.rootMidi < 0 || config.rootMidi > 127) {
    throw new Error(
      `Cosmophony: rootMidi must be a MIDI note between 0 and 127, got ${config.rootMidi}.`,
    );
  }
  if (!Number.isFinite(config.maxVoices)) {
    throw new Error(`Cosmophony: maxVoices must be a finite number, got ${config.maxVoices}.`);
  }
  if (!Number.isFinite(config.loopSeconds) || config.loopSeconds <= 0) {
    throw new Error(
      `Cosmophony: loopSeconds must be greater than 0, got ${config.loopSeconds}.`,
    );
  }
  if (config.seed !== undefined && !Number.isFinite(config.seed)) {
    throw new Error(`Cosmophony: seed must be a finite number when given, got ${config.seed}.`);
  }
}

// ------------------------------------------------------------------ sonify

/**
 * Turn a sky into a score.
 *
 * Takes the `maxVoices` brightest stars above the horizon and gives each a
 * sustained, scale-quantized voice. Never throws on the shape of the sky — a
 * polar winter with nothing up, or three stars where eight were asked for, are
 * ordinary skies and produce ordinary (smaller) scores. It DOES throw on an
 * impossible config, because that is a bug rather than a sky.
 *
 * Determinism: the only ordering is by magnitude with the catalogue id as
 * tiebreaker, so two stars of exactly equal brightness can never swap places
 * between runs.
 *
 * `config.seed` is accepted and validated but unused: nothing in the birth-sky
 * mapping needs a random choice — every value is derived from the star itself.
 * It stays in the contract for instruments that do need one.
 */
export function sonify(stars: HorizonStar[], config: MappingConfig): MusicalScore {
  validateConfig(config);

  const visible = stars.filter((entry) => entry.altitude > 0);

  const chosen = [...visible]
    .sort((a, b) => a.star.mag - b.star.mag || compareIds(a.star.id, b.star.id))
    .slice(0, Math.max(0, Math.floor(config.maxVoices)));

  const events: MusicalEvent[] = chosen.map((entry) => ({
    sourceId: entry.star.id,
    role: 'chord',
    midi: altitudeToMidi(entry.altitude, config.rootMidi, config.scale),
    amplitude: round(magnitudeToAmplitude(entry.star.mag), 4),
    pan: round(azimuthToPan(entry.azimuth), 4),
    timbre: colourToTimbre(entry.star.bv),
    twinkle: round(altitudeToTwinkle(entry.altitude), 4),
    startSeconds: 0,
    durationSeconds: config.loopSeconds,
    // A snapshot has no elapsed sky: everything here is "what was visible at
    // the instant", which is exactly what `visible` means.
    origin: { kind: 'visible', starId: entry.star.id, skySeconds: 0 },
  }));

  return {
    events,
    key: `${pitchClassName(config.rootMidi)} ${config.scale}`,
    loopSeconds: config.loopSeconds,
    meta: {
      objectCount: stars.length,
      visibleCount: visible.length,
      label: describeSky(events.length, visible.length),
    },
  };
}

/** Numeric where possible (HYG ids are numeric strings), lexical as a backstop. */
function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * An honest one-line summary of what is actually sounding.
 *
 * Deliberately says nothing about place or date: this layer does not know them,
 * and inventing a label here would be the layer overstepping. The instrument
 * prefixes the place and date for display.
 */
function describeSky(voiceCount: number, visibleCount: number): string {
  if (visibleCount === 0) return 'no stars above the horizon';
  const stars = `${visibleCount.toLocaleString('en-US')} star${visibleCount === 1 ? '' : 's'}`;
  if (voiceCount === 0) return `${stars} above the horizon, none sounding`;
  if (voiceCount === visibleCount) {
    return `${stars} above the horizon, all sounding`;
  }
  return `the ${voiceCount} brightest of ${stars} above the horizon`;
}
