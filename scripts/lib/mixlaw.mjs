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
  /**
   * THE MASTER PEAK CEILING. Ratified by HQ, 2026-09-04 (Slice B3, Ruling 1).
   *
   * Not a limiter threshold — there is no master limiter in either path. This is
   * where the MASTER FADER lands the loudest sample, and it outranks the LUFS
   * target because a peak ceiling is a fact about the file and a loudness target
   * is an aim for it. B1.1 inverted that, and what shipped from B1 to B2 was hard
   * clipping: embrace printed at +2.57 dBFS and pulse at +2.96 dBFS, in the live
   * graph as well as offline.
   */
  peakCeilingDbfs: -1.0,
  /**
   * Fail the check if the printed file peaks above this.
   *
   * The same number as the ceiling, because the fader is computed to land on it:
   * this is a STRUCTURAL assertion, not a tolerance. `peakAssertEpsilonDb` exists
   * only so float error in a gain multiply cannot fail a mix that is correct.
   */
  maxPeakDbfs: -1.0,
  peakAssertEpsilonDb: 0.01,
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
/**
 * Widened from 5.0 to 5.5 by HQ ruling, 2026-08-10.
 *
 * Slice B1's chord carve — which serves the ratified EQ lanes — put the sonata
 * lens's quietest chord minute at -5.01 against a +/-5.00 bound. One hundredth
 * of a dB is inside the noise of a bound that was itself derived from an
 * observed ~4.3 dB spread. The ruling widens the bound rather than shallowing
 * the carve, because the carve is doing musical work and the bound was never
 * precise to two decimal places.
 */
export const WINDOW_TOLERANCE_DB = 5.5;
export const WINDOW_SECONDS = 60;

/**
 * Frames quieter than this do not count toward a window's level. Set well below
 * the quietest target (weather, −34 dBFS) so it excludes silence and reverb
 * tails without excluding any role's actual voice.
 */
export const WINDOW_GATE_DBFS = -55;

/**
 * Per-role widening of `WINDOW_TOLERANCE_DB`. Ratified by HQ, 2026-09-04
 * (Slice B3, Ruling 2).
 *
 * CHORD ONLY, and the reason is the chord's alone: it is the layer that carries
 * the sky filling and thinning across an eleven-minute composed arc, so its
 * quietest minute and its fullest minute are supposed to be far apart. Measured
 * on the B2 tonight score the chord's worst window sits 7.8 dB from its own
 * gated average — the arc breathing, not a mix defect. B1.1 diagnosed this and
 * the master peak as one cause; that was wrong, and the correction is ratified.
 *
 * Every other role stays at ±5.5. A bound widened for one role's musical reason
 * is a ruling; a bound widened for all of them is a bound switched off.
 */
export const WINDOW_TOLERANCE_BY_ROLE = { chord: 8.0 };

/** The window bound that applies to a role. */
export function windowToleranceFor(role) {
  return WINDOW_TOLERANCE_BY_ROLE[role] ?? WINDOW_TOLERANCE_DB;
}

/**
 * THE MASTER FADER — one derivation, two consumers.
 *
 * `min(loudness trim, peak-safe trim)`. The offline renderer and the live graph
 * must apply the SAME number or the mix law describes neither of them, so the
 * number is computed here and imported by both: `render-score.mjs` measures
 * `measuredLufs` and `measuredPeakDbfs` and applies this; the live graph reads
 * those two measurements out of `calibration.json` and applies this.
 *
 * −18 LUFS IS A TARGET, NOT AN INVARIANT (HQ, 2026-09-04). When the peak trim is
 * the lower of the two the mix lands under its loudness target, and the honest
 * response is to report the resulting per-lens spread — which `check-mix-law`
 * does — rather than to buy the target back with a master limiter. The B1.1
 * amendment put limiting on transient-carrying stems deliberately; a master
 * brick-wall would put a compressor across the bed by the side door.
 *
 * A missing or non-finite peak measurement means "unknown", and unknown must not
 * silently disable the guard, so it falls back to the loudness trim alone and
 * the caller is expected to say so.
 */
export function masterTrimDb({ lufsTarget, measuredLufs, measuredPeakDbfs }) {
  const loudness = Number.isFinite(measuredLufs) ? lufsTarget - measuredLufs : 0;
  const peakSafe = Number.isFinite(measuredPeakDbfs)
    ? MASTER.peakCeilingDbfs - measuredPeakDbfs
    : Infinity;
  return Math.min(loudness, peakSafe);
}

/**
 * THE SPACE — SLICE B4, 2026-09-11. One place, two paths.
 *
 * `render-score.mjs` had a `SEND` table and `src/engine/audio/mixLaw.ts` had a
 * `SEND_LEVELS` table, written out twice with a comment on the second one
 * saying "these are SEND in render-score.mjs, to the digit". They were, until
 * somebody moved a digit. That is the same defect B3 found in the master fader
 * and closed the same way: the numbers live here, and both paths import them.
 *
 * THE ECHO IS GONE. `delay` was 0.18 on figuration and 0.22 on lead — a literal
 * ping-pong repeat of every note in the two roles that carry the melody. Shambu
 * heard it as "resound"; it had never been put in front of his ear as a choice.
 * Ratified 2026-09-11: zero on every role. The field is kept rather than deleted
 * so that turning an echo back on is one number and not a re-wire, and so the
 * two paths keep sharing the decision either way.
 *
 * THE REVERB IS A ROOM, NOT A HALL. The sends drop by roughly a third across the
 * board (ground 0.22 → 0.06, chord 0.34 → 0.10, figuration 0.16 → 0.07, lead
 * 0.30 → 0.10, weather 0.50 → 0.20) and the tail itself shortens. A handpan in a
 * cathedral is a wash; a handpan in a room is notes.
 */
export const ROLE_SENDS = {
  ground: { reverb: 0.06, delay: 0.0 },
  chord: { reverb: 0.1, delay: 0.0 },
  figuration: { reverb: 0.07, delay: 0.0 },
  lead: { reverb: 0.1, delay: 0.0 },
  weather: { reverb: 0.2, delay: 0.0 },
};

/**
 * THE ROOM ITSELF.
 *
 * The offline reverb is a Schroeder network — four combs into two allpasses —
 * so its "decay" is a comb FEEDBACK COEFFICIENT, while the live graph's
 * `Tone.Reverb` takes an RT60 in SECONDS. Two different quantities that both
 * used to be typed in by hand, which is how the renderer ended up at a 1.5 s
 * tail and the live graph at 8 s from the same ratified word "reverb".
 *
 * So the coefficient is ratified here and the seconds are DERIVED from it by
 * `reverbDecaySeconds()`. Moving `combFeedback` moves both paths at once, in
 * the same direction, by the same amount.
 *
 * decay 0.84 → 0.55 and dampHz 2400 → 1800, ratified 2026-09-11.
 */
export const REVERB = {
  /** Comb feedback. The offline network's `decay`. */
  combFeedback: 0.55,
  /** One-pole lowpass on the tail: a bright reverb on a star field is glare. */
  dampHz: 1800,
  /** Comb delays, ms — the room's dimensions, and the basis of the RT60 below. */
  combDelaysMs: [29.7, 37.1, 41.1, 43.7],
  /** Allpass delays, ms — diffusion, not decay. */
  allpassMs: [5.0, 1.7],
  /** Per-comb damping inside the feedback loop. */
  combDamping: 0.35,
  /** Right-channel offset, ms: the two channels are not the same room corner. */
  spreadMs: 0.9,
  /** Pre-delay, seconds. Live-only; the offline network's first tap is its own. */
  preDelaySeconds: 0.04,
};

/**
 * The RT60 of a comb at `feedback`, in seconds — what the live reverb is set to.
 *
 * A comb of delay T with feedback g loses 20·log10(g) dB per pass, so it falls
 * 60 dB after 3/|log10 g| passes. Averaged over the four comb delays this is the
 * tail the offline network actually produces: 0.84 → ~1.5 s (a hall), 0.55 →
 * ~0.44 s (a room). Derived rather than typed so the live graph cannot drift
 * from the renderer by a factor of five again.
 */
export function reverbDecaySeconds(feedback = REVERB.combFeedback) {
  const g = Math.min(0.999999, Math.max(1e-6, feedback));
  const meanDelaySeconds =
    REVERB.combDelaysMs.reduce((a, b) => a + b, 0) / REVERB.combDelaysMs.length / 1000;
  return (3 * meanDelaySeconds) / -Math.log10(g);
}
