/**
 * Living Sky — chord voices, shared by the stream and the figuration (Slice A3).
 *
 * Both layers must agree exactly on what is sounding: the figuration may only
 * play tones that are genuinely in the air, so it cannot afford its own opinion
 * about which stars are up, what pitch they took, or how loud they have swelled.
 * Extracted here so there is one answer rather than two.
 *
 * Pure, like everything else in the mapping layer.
 */

import type { Star } from '../model/index.ts';
import { toHorizon } from './astro.ts';
import { magnitudeToAmplitude } from './sonify.ts';
import { scaleDegrees } from './scales.ts';
import { lstAt, occurrencesInRange, siderealPeriodInPiece } from './skyTime.ts';
import type { ChordStarPlan, SessionPlan } from './session.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Smooth 0→1 ramp, so voices swell rather than switch on. */
const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** How present a star is, from how far above the horizon it has climbed. */
export function horizonFade(altitude: number, fadeDegrees: number): number {
  if (altitude <= 0) return 0;
  return smoothstep(altitude / Math.max(1e-9, fadeDegrees));
}

// ---------------------------------------------------------------- CHORD

/** One continuous stretch during which a star is above the horizon. */
export interface VisibilitySpan {
  start: number;
  end: number;
  /** True when the span begins because the piece began, not because it rose. */
  clamped: boolean;
}

/**
 * The stretches of piece time during which a star is up, overlapping the range.
 *
 * A rising-and-setting star gives one span per sidereal day. A circumpolar star
 * is up forever, so it is cut into segments on an absolute grid — the grid is
 * absolute precisely so the cuts land in the same place regardless of window.
 */
export function visibilitySpans(
  plan: SessionPlan,
  entry: ChordStarPlan,
  from: number,
  to: number,
): VisibilitySpan[] {
  const { times } = entry;
  const spans: VisibilitySpan[] = [];

  if (times.visibility === 'never-rises') return spans;

  if (times.visibility === 'circumpolar') {
    const segment = plan.config.circumpolarSegmentSeconds;
    const firstIndex = Math.floor(Math.max(0, from) / segment);
    const lastIndex = Math.floor(Math.max(0, to - 1e-9) / segment);
    for (let i = firstIndex; i <= lastIndex; i++) {
      spans.push({ start: i * segment, end: (i + 1) * segment, clamped: i === 0 });
    }
    return spans;
  }

  const riseLst = times.riseLst;
  if (riseLst === undefined) return spans;

  const upSeconds = (times.hoursAboveHorizon * 3600) / plan.kappa;
  const period = siderealPeriodInPiece(plan.kappa);

  // Look back one full period so a span that began before the range but is still
  // running (or that starts at 0 because it was already up) is not missed.
  for (const rise of occurrencesInRange(plan.lst0, riseLst, plan.kappa, from - period, to)) {
    const end = rise + upSeconds;
    if (end <= from) continue;
    if (rise >= to) continue;
    spans.push({ start: Math.max(0, rise), end, clamped: rise < 0 });
  }

  // A star already above the horizon at t = 0 must still get a voice, starting
  // at 0. Its rise happened before the piece did.
  if (from <= 0) {
    const alreadyUp = toHorizon(entry.star, plan.observer.latitude, plan.lst0).altitude > 0;
    if (alreadyUp && !spans.some((s) => s.start === 0)) {
      const previousRise =
        occurrencesInRange(plan.lst0, riseLst, plan.kappa, -period, 0).slice(-1)[0] ?? -upSeconds;
      spans.unshift({ start: 0, end: previousRise + upSeconds, clamped: true });
    }
  }

  return spans.filter((s) => s.end > s.start);
}

/**
 * The octave a newly entering voice takes (design §10.2).
 *
 * Sustained voices never move, so common tones are kept automatically — the only
 * voice-leading decision is where an entering voice should sit. It takes the
 * octave, within the weather's register span, that puts it closest to the
 * centroid of what is already sounding. That is the "smallest possible step"
 * mechanism, and it makes the bound testable.
 *
 * The centroid is computed from each sounding star's CANONICAL placement — a
 * pure function of the star — rather than from the octaves previously assigned.
 * Without that the rule would be recursive and no longer window-independent.
 */
export function chooseOctave(plan: SessionPlan, entry: ChordStarPlan, atSeconds: number): number {
  const lst = lstAt(plan.lst0, atSeconds, plan.kappa);

  let total = 0;
  let count = 0;
  for (const other of plan.chordStars) {
    if (toHorizon(other.star, plan.observer.latitude, lst).altitude <= 0) continue;
    total += other.canonicalMidi;
    count++;
  }
  const centroid = count > 0 ? total / count : plan.rootMidi + 12;

  const degrees = scaleDegrees(plan.scale);
  const semitone = degrees[entry.degree % degrees.length] as number;

  let bestOctave = 0;
  let bestDistance = Infinity;
  for (let octave = 0; octave < plan.registerOctaves; octave++) {
    const midi = plan.rootMidi + 12 * octave + semitone;
    const distance = Math.abs(midi - centroid);
    if (distance < bestDistance - 1e-9) {
      bestDistance = distance;
      bestOctave = octave;
    }
  }
  return bestOctave;
}

/**
 * When the opening gesture lets a chord voice in.
 *
 * The brightest star of your sky sounds alone first — that is you. The rest
 * bloom in around it in brightness order until it is one voice inside the whole.
 * Costs almost nothing; it is the moment people remember.
 */
export function gestureStart(plan: SessionPlan, entry: ChordStarPlan, naturalStart: number): number {
  const { config } = plan;
  if (config.mode !== 'birth-sky') return naturalStart;
  if (naturalStart >= config.gatheringSeconds) return naturalStart;
  if (entry.star.id === plan.openingStarId) return 0;

  const others = plan.chordStars.filter((c) => c.star.id !== plan.openingStarId).length;
  const rank = entry.brightnessRank;
  const spread = Math.max(1e-9, config.gatheringSeconds - config.gestureSeconds);
  const staggered = config.gestureSeconds + (spread * rank) / Math.max(1, others);
  return Math.max(naturalStart, staggered);
}

/** When the closing gesture takes a chord voice away, mirroring the opening. */
export function gestureEnd(plan: SessionPlan, entry: ChordStarPlan, naturalEnd: number): number {
  const { config } = plan;
  if (config.mode !== 'birth-sky') return naturalEnd;

  const sessionEnd = config.sessionSeconds;
  if (entry.star.id === plan.openingStarId) return Math.min(naturalEnd, sessionEnd);

  const closeStart = sessionEnd - config.closingSeconds;
  const others = plan.chordStars.filter((c) => c.star.id !== plan.openingStarId).length;
  // Reverse brightness order: the faintest leaves first, the opening star last.
  const rank = entry.brightnessRank;
  const fraction = 1 - rank / Math.max(1, others);
  const cut = closeStart + config.closingSeconds * clamp(fraction, 0, 1) * 0.9;
  return Math.min(naturalEnd, Math.max(closeStart, cut));
}


/** One chord tone that is genuinely in the air at a given moment. */
export interface SoundingTone {
  starId: string;
  star: Star;
  midi: number;
  /** 0..1 — magnitude, shaped by how far the star has climbed. */
  amplitude: number;
  altitude: number;
  azimuth: number;
}

/**
 * Every chord tone actually sounding at `atSeconds`.
 *
 * This is the figuration's entire vocabulary. Because it is derived from the
 * same spans, octaves and horizon fade the CHORD events use, a figuration note
 * can only ever double a pitch that is already in the air — which is what makes
 * the layer on-scale and TRUE by construction rather than by a check.
 */
export function soundingChordTones(plan: SessionPlan, atSeconds: number): SoundingTone[] {
  const degrees = scaleDegrees(plan.scale);
  const sessionEnd = plan.config.mode === 'birth-sky' ? plan.config.sessionSeconds : Infinity;
  const lst = lstAt(plan.lst0, atSeconds, plan.kappa);
  const tones: SoundingTone[] = [];

  for (const entry of plan.chordStars) {
    // The span containing this moment, if any.
    const spans = visibilitySpans(plan, entry, Math.max(0, atSeconds - 1e-6), atSeconds + 1e-6);
    let span = spans.find((s) => s.start <= atSeconds && s.end > atSeconds);
    if (!span) {
      const period = siderealPeriodInPiece(plan.kappa);
      const earlier = visibilitySpans(plan, entry, Math.max(0, atSeconds - period), atSeconds + 1e-6);
      span = earlier.find((s) => s.start <= atSeconds && s.end > atSeconds);
    }
    if (!span) continue;

    const start = gestureStart(plan, entry, span.start);
    if (start > atSeconds) continue;
    const end = Math.min(gestureEnd(plan, entry, span.end), sessionEnd);
    if (end <= atSeconds) continue;

    const here = toHorizon(entry.star, plan.observer.latitude, lst);
    if (here.altitude <= 0) continue;

    const octave = chooseOctave(plan, entry, start);
    const semitone = degrees[entry.degree % degrees.length] as number;
    const lifted =
      entry.times.maxAltitude > plan.config.octaveLiftDegrees && octave + 1 < plan.registerOctaves;
    const midi = clamp(
      Math.round(plan.rootMidi + 12 * (octave + (lifted ? 1 : 0)) + semitone),
      0,
      127,
    );

    const amplitude =
      magnitudeToAmplitude(entry.star.mag) *
      horizonFade(here.altitude, plan.config.horizonFadeDegrees);

    tones.push({
      starId: entry.star.id,
      star: entry.star,
      midi,
      amplitude,
      altitude: here.altitude,
      azimuth: here.azimuth,
    });
  }

  // Low to high, then by id — a total order, so the figuration's choices are
  // reproducible whatever order the catalogue happens to be in.
  tones.sort((a, b) => a.midi - b.midi || (a.starId < b.starId ? -1 : a.starId > b.starId ? 1 : 0));
  return tones;
}

/**
 * Grid on which the sounding-tone set is sampled and remembered, in seconds.
 *
 * One second is far finer than the set actually changes — a star crossing the
 * horizon is at zero amplitude there anyway, so the worst error is inaudible —
 * and it turns tens of thousands of recomputations into a few thousand. The grid
 * is ABSOLUTE, never relative to a window, so slicing cannot change an answer.
 */
const TONE_SAMPLE_SECONDS = 1;

/** `soundingChordTones`, sampled on the absolute grid and memoised. */
export function soundingChordTonesCached(plan: SessionPlan, atSeconds: number): SoundingTone[] {
  const bucket = Math.floor(Math.max(0, atSeconds) / TONE_SAMPLE_SECONDS);
  const cached = plan.toneCache.get(bucket) as SoundingTone[] | undefined;
  if (cached) return cached;
  const computed = soundingChordTones(plan, bucket * TONE_SAMPLE_SECONDS);
  plan.toneCache.set(bucket, computed);
  return computed;
}
