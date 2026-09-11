/**
 * SLICE B4 — THE PULSE. The sky decides WHICH NOTE; the grid decides WHEN.
 *
 * Four ear reports in a row said the same thing in different words — "no
 * patterns", "nothing to recognise", "it all sounds the same" — and the cause
 * was structural rather than a matter of taste. Every onset in the piece came
 * out of the sky: a figuration slot sounded when its slot time arrived on a
 * cycle whose length was itself a mapping constant, humanised by a random
 * drift, and the note it played was re-picked from the chord by a seeded hash.
 * Nothing recurred, so nothing could be learned, so nothing could be
 * recognised — and a companion you return to nightly is made of the things you
 * recognise.
 *
 * So the two decisions are separated. The sky keeps everything it is good at:
 * WHICH pitches are available, which register they sit in, how bright and how
 * loud they are, where they sit in the stereo field. The grid takes the one
 * decision the sky was never able to make — WHEN.
 *
 *   66 bpm · eighth notes · accent every 4th step, half-accent every 2nd.
 *
 * EVERY NUMBER THE RHYTHM DEPENDS ON IS IN THIS OBJECT, so an ear report of
 * "too fast" or "too even" is answered by moving one number in one file rather
 * than by a redesign. That is the whole reason this module exists as its own
 * file instead of five constants spread through `figuration.ts`.
 *
 * PARTITION INVARIANCE BY CONSTRUCTION. Every function here is a pure function
 * of ABSOLUTE piece time: step `i` begins at `i × STEP_SECONDS`, always, in
 * every window, whatever the stream's slicing. There is no accumulated phase to
 * get out of step, which is what makes the grid safe to put underneath a stream
 * that is computed in pieces.
 *
 * NO HUMANISATION AND NO SWING. Both were considered and both are deliberately
 * absent: he asked for simple. `humanizeSeconds: 0` is stated rather than
 * deleted so that the answer to "it feels mechanical" is a number, and so that
 * nobody has to guess whether the flatness is a choice or an oversight.
 */

/**
 * THE GRID. Tempo, subdivision, accent pattern and cycle order — the four
 * things that decide what the rhythm is — in one ratified object.
 */
export const PULSE = {
  /** Beats per minute. A resting heart rate; slower than any of the sketches. */
  bpm: 66,
  /** Steps per beat: 2 is eighth notes. */
  stepsPerBeat: 2,
  /** Steps per bar: 8 eighths is one bar of 4/4, and one figuration cycle. */
  stepsPerBar: 8,
  /** Accent every Nth step — the downbeat and the half-bar. */
  accentEveryStep: 4,
  /** Half-accent every Nth step — the quarter-note beats between them. */
  halfAccentEveryStep: 2,
  /** What an accent, a half-accent and a plain step do to a note's velocity. */
  accentVelocity: 1.15,
  halfAccentVelocity: 1.06,
  plainVelocity: 1.0,
  /**
   * THE CYCLE ORDER: how far the reading head moves through the pool per step.
   *
   * One. The pool is walked in a FIXED order, one member per grid step, wrapping
   * at the end — which is what makes a repeating figure rather than a sequence
   * of unrelated notes. Taking "the most recent star" or re-picking from the
   * pool at random was the old behaviour and it is exactly what prevented a
   * figure from forming. The pool itself turns over slowly as the sky turns, so
   * the ostinato EVOLVES instead of resetting: this is MUSICAL_VISION §6b's
   * motif-as-ostinato, finally built.
   */
  poolAdvancePerStep: 1,
  /** The lead is quantised to this many steps — a half-bar. Sparse, over the pulse. */
  leadQuantiseSteps: 4,
  /** Deliberately zero. See the header: he asked for simple. */
  humanizeSeconds: 0,
  /** Deliberately zero. Straight eighths, no swing. */
  swingRatio: 0,
} as const;

/** Seconds per grid step. 66 bpm in eighths = 0.4545… s. */
export const STEP_SECONDS = 60 / PULSE.bpm / PULSE.stepsPerBeat;

/** Seconds per bar — also the figuration cycle. */
export const BAR_SECONDS = STEP_SECONDS * PULSE.stepsPerBar;

/** The lead's quantisation interval, in seconds. */
export const LEAD_QUANTISE_SECONDS = STEP_SECONDS * PULSE.leadQuantiseSteps;

/** Which grid step contains an absolute piece time. */
export function stepIndexAt(atSeconds: number): number {
  return Math.floor(Math.max(0, atSeconds) / STEP_SECONDS);
}

/** When a grid step begins, in absolute piece time. */
export function stepStartSeconds(stepIndex: number): number {
  return stepIndex * STEP_SECONDS;
}

/**
 * The velocity multiplier for a step — the accent pattern, and nothing else.
 *
 * Strictly a function of the step's index, so the same bar of the piece is
 * accented the same way however the stream was sliced. `accentEveryStep` is
 * checked first: step 0 of a bar is an accent, not a half-accent.
 */
export function accentAt(stepIndex: number): number {
  const inBar = ((stepIndex % PULSE.stepsPerBar) + PULSE.stepsPerBar) % PULSE.stepsPerBar;
  if (inBar % PULSE.accentEveryStep === 0) return PULSE.accentVelocity;
  if (inBar % PULSE.halfAccentEveryStep === 0) return PULSE.halfAccentVelocity;
  return PULSE.plainVelocity;
}

/**
 * Where the reading head sits in a pool of `size` at step `stepIndex`.
 *
 * Modulo arithmetic on the ABSOLUTE step index, so the head's position is never
 * carried from one window to the next. When the pool changes size — a star sets,
 * another rises — the figure shifts rather than restarting, which is the slow
 * turning-over the ostinato is made of.
 */
export function poolIndexAt(stepIndex: number, size: number): number {
  if (size <= 0) return 0;
  const raw = stepIndex * PULSE.poolAdvancePerStep;
  return ((raw % size) + size) % size;
}

/**
 * Snap a time to the nearest half-bar — the lead's only rhythmic constraint.
 *
 * NEAREST, not floor: a phrase note is a gesture that was going to land near
 * here anyway, and pulling every one of them backwards would drag the lead off
 * the pulse in one direction. The result is a pure function of the note's own
 * absolute time, which is what lets the stream filter windows on the QUANTISED
 * onset and keep partition invariance exactly.
 */
export function quantiseToHalfBar(atSeconds: number): number {
  if (!Number.isFinite(atSeconds)) return atSeconds;
  const snapped = Math.round(atSeconds / LEAD_QUANTISE_SECONDS) * LEAD_QUANTISE_SECONDS;
  return Math.max(0, snapped);
}
