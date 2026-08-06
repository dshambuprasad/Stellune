/**
 * Slice B0 — THE MIX LAW, as executable numbers.
 *
 * Ratified in the BUILD_LOG entry of 2026-08-07, after stem forensics showed
 * the HQ v1 render had inverted the hierarchy: the chord bed sat at −7.6 dBFS
 * while figuration — the layer carrying the motion — sat at −42.6, i.e. 35 dB
 * under the bed and perceptually nonexistent. Shambu heard "a continuous
 * background note… sounds like noise… other notes on top", and he was right.
 *
 * The law is stated as MEASURED STEADY-STATE STEM LEVELS, so this module is
 * the single place the renderer and the checker both read it from.
 *
 *   motion in front, vastness behind.
 */

/** Steady-state stem targets, dBFS RMS. */
export const STEM_TARGETS_DBFS = {
  figuration: -19,
  lead: -21,
  ground: -23,
  chord: -25,
  weather: -34,
};

/** How far a measured stem may sit from its target before the check fails. */
export const STEM_TOLERANCE_DB = 1.0;

/**
 * Figuration must lead the bed — "motion in front, vastness behind". The law's
 * prose says "3–5 dB ABOVE the combined bed", and that is the relationship the
 * law exists to protect, so the checker asserts it against each bed layer:
 * figuration sits 4 dB over ground and 6 dB over chord by the ratified numbers.
 *
 * NOTE, measured, for whoever re-ratifies this: read literally as a POWER SUM
 * of ground and chord, the ratified targets put figuration only ~1.9 dB over
 * the combined bed, not 3–5 (−23 and −25 sum to −20.9; −19 is 1.9 above that).
 * The absolute stem numbers are the operative law and are asserted exactly; the
 * combined-bed margin is measured and reported, not enforced, because tightening
 * it would mean changing the ratified targets — Shambu's call, not the tool's.
 */
export const FIGURATION_OVER_LAYER_DB = { ground: 4, chord: 6, tolerance: 1.0 };

/**
 * Per-role shaping the law mandates, applied before the stem trims.
 *
 * `concurrencyNormalise` — divide by sqrt(N) of simultaneously-sounding voices
 *   in that role. The v1 render summed ~20 chord voices raw; that is the whole
 *   reason the bed swallowed everything else.
 * `velocityCompress`     — raise the event amplitude to this power. Figuration
 *   velocities are magnitude-derived and mostly faint; sqrt-compression brings
 *   the quiet motion up without flattening it.
 */
export const ROLE_SHAPING = {
  ground: { concurrencyNormalise: false, velocityCompress: 1 },
  chord: { concurrencyNormalise: true, velocityCompress: 1 },
  figuration: { concurrencyNormalise: false, velocityCompress: 0.5 },
  lead: { concurrencyNormalise: false, velocityCompress: 0.75 },
  weather: { concurrencyNormalise: true, velocityCompress: 1 },
};

/**
 * WEATHER MUST NOT SOUND IN UNISON WITH GROUND.
 *
 * The A3 score emits both roles on midi 45 for the entire session: two roles
 * stacked on one pitch is the "continuous note", and their mutual detune-beat
 * is the "noise" Shambu heard. The engine-side fix (weather events carrying a
 * distinct register hint) belongs to the mapping stream; until it lands, the
 * renderer transposes weather up an octave and voices it as a whisper, and the
 * checker asserts the separation rather than trusting it.
 */
export const WEATHER_OCTAVE_SHIFT = 12;
export const WEATHER_MIN_SEPARATION_SEMITONES = 12;

/** Master-bus guards. */
export const MASTER = {
  /** The 38 Hz highpass from the v2 render — clears sub-rumble under the drone. */
  highpassHz: 38,
  /** Where the look-ahead limiter catches peaks. */
  limiterCeilingDbfs: -1.0,
  /** Fail the check if the printed file peaks above this. */
  maxPeakDbfs: -0.3,
  /**
   * The limiter may catch transients; it may not sit on the music. Fail if it
   * is holding the master down by more than 1 dB for more than this fraction
   * of the render, or if any single catch exceeds `maxLimitingDb`.
   *
   * The renderer already pulls the master fader down to the ceiling, so the
   * limiter should be doing almost nothing. When it IS busy, something upstream
   * is wrong — an instrument mis-levelled, a role mis-shaped — and that is the
   * failure this bound is here to surface.
   */
  maxLimiterBusyFraction: 0.005,
  maxLimitingDb: 3.0,
};

/**
 * How far a single 60-second window inside the steady state may sit from its
 * target. Deliberately much wider than STEM_TOLERANCE_DB, because the piece is
 * SUPPOSED to breathe: the chord bed thickens by ~4 dB as the sky fills and the
 * lead grows toward the night's true climax. Measured on the A3 birth score the
 * real spread is ~4.3 dB, so this bound allows the composed arc while still
 * catching the failure it exists for — the v1 render had figuration sitting
 * 23 dB under its target, which this would have caught in every window.
 */
export const WINDOW_TOLERANCE_DB = 5.0;
export const WINDOW_SECONDS = 60;

/**
 * Frames quieter than this do not count toward a window's level. Set well below
 * the quietest target (weather, −34 dBFS) so it excludes silence and reverb
 * tails without excluding any role's actual voice.
 */
export const WINDOW_GATE_DBFS = -55;
