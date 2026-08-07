/**
 * Living Sky — the windowed stream (design §3).
 *
 * The audio layer asks for a slice of the piece and schedules it; before that
 * slice runs out it asks for the next. Everything is computed from ABSOLUTE
 * piece time, so:
 *
 *   **Partition invariance** — for any split of [0, T) into consecutive windows,
 *   the union of those windows' events equals `renderWindow(0, T)` exactly.
 *
 * That single property is what "never audibly restarts" means operationally.
 * There is no state to reset, window size is a free parameter, and a bug at a
 * boundary is a failing test rather than a listening session.
 *
 * It is achieved by one rule: an event belongs to the window containing its
 * `startSeconds`, where `startSeconds = max(trueEventTime, 0)`. The clamp is what
 * makes window 0 behave like every other window — stars already up when the
 * piece begins get start 0, are emitted exactly once, and never again.
 *
 * Events may extend past `toSeconds`; a chord voice can sustain for tens of
 * minutes.
 */

import type { Star } from '../model/index.ts';
import { toHorizon } from './astro.ts';
import {
  altitudeToTwinkle,
  azimuthToPan,
  colourToTimbre,
  magnitudeToAmplitude,
} from './sonify.ts';
import { scaleDegrees } from './scales.ts';
import { pitchClassName } from './scales.ts';
import { hourAngleAtAltitude } from './skyEvents.ts';
import { DEGREES_PER_SKY_SECOND, lstAt } from './skyTime.ts';
import { measureWeather } from './skyWeather.ts';
import { arcAt, type ChordStarPlan, type SessionPlan } from './session.ts';
import {
  chooseOctave,
  gestureEnd,
  gestureStart,
  horizonFade,
  visibilitySpans,
} from './chordVoices.ts';
import { figurationNotesInRange } from './figuration.ts';
import { horizonAtEvent, phrasesInRange } from './conductor.ts';
import { degreeToMidi } from './motif.ts';
import type {
  AmplitudeBreakpoint,
  MusicalEvent,
  ScoreWindow,
  SkyWeather,
} from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const unsign = (v: number): number => (Object.is(v, -0) ? 0 : v);
const round = (v: number, p: number): number => {
  const f = 10 ** p;
  return unsign(Math.round(v * f) / f);
};

/** Sample the swell of a chord voice across its life. */
function chordEnvelope(
  plan: SessionPlan,
  entry: ChordStarPlan,
  start: number,
  end: number,
  peak: number,
): AmplitudeBreakpoint[] {
  const step = Math.max(1, plan.config.envelopeStepSeconds);
  const points: AmplitudeBreakpoint[] = [];
  const count = Math.max(1, Math.ceil((end - start) / step));

  for (let i = 0; i <= count; i++) {
    const at = start + Math.min(end - start, i * step);
    const altitude = toHorizon(
      entry.star,
      plan.observer.latitude,
      lstAt(plan.lst0, at, plan.kappa),
    ).altitude;
    points.push({
      atSeconds: round(at - start, 3),
      amplitude: round(peak * horizonFade(altitude, plan.config.horizonFadeDegrees), 4),
    });
    if (at >= end) break;
  }
  return points;
}

function chordEvents(plan: SessionPlan, from: number, to: number): MusicalEvent[] {
  const events: MusicalEvent[] = [];
  const degrees = scaleDegrees(plan.scale);
  const sessionEnd = plan.config.mode === 'birth-sky' ? plan.config.sessionSeconds : Infinity;

  for (const entry of plan.chordStars) {
    for (const span of visibilitySpans(plan, entry, from, to)) {
      const start = gestureStart(plan, entry, span.start);
      if (start < from || start >= to) continue;
      if (start >= sessionEnd) continue;

      const end = Math.min(gestureEnd(plan, entry, span.end), sessionEnd);
      if (!(end > start)) continue;

      const octave = chooseOctave(plan, entry, start);
      const semitone = degrees[entry.degree % degrees.length] as number;

      // The octave lift: a star that climbs past the lift altitude is carried up
      // an octave. Octave motion preserves pitch class, so the harmony is
      // untouched and the on-scale guarantee holds by construction.
      const lifted =
        entry.times.maxAltitude > plan.config.octaveLiftDegrees &&
        octave + 1 < plan.registerOctaves;
      const midi = clamp(
        Math.round(plan.rootMidi + 12 * (octave + (lifted ? 1 : 0)) + semitone),
        0,
        127,
      );

      const peak = magnitudeToAmplitude(entry.star.mag);
      const atStart = toHorizon(
        entry.star,
        plan.observer.latitude,
        lstAt(plan.lst0, start, plan.kappa),
      );

      events.push({
        sourceId: entry.star.id,
        role: 'chord',
        midi,
        amplitude: round(peak, 4),
        pan: round(azimuthToPan(atStart.azimuth), 4),
        timbre: colourToTimbre(entry.star.bv),
        twinkle: round(altitudeToTwinkle(Math.max(0, atStart.altitude)), 4),
        startSeconds: round(start, 3),
        durationSeconds: round(end - start, 3),
        envelope: chordEnvelope(plan, entry, start, end, peak),
        origin: {
          kind: span.clamped && start === 0 ? 'visible' : 'rise',
          starId: entry.star.id,
          skySeconds: round(start * plan.kappa, 3),
        },
      });
    }
  }
  return events;
}

// ----------------------------------------------------------------- LEAD

/**
 * The LEAD: the sky speaking, in phrases.
 *
 * Each phrase is statement → answer → rest, built by the Conductor entirely in
 * scale-degree space. Here those degrees become pitches, and each note is given
 * the pan, timbre and twinkle of the star (or the motif's brightest star) at the
 * moment it speaks.
 *
 * The register offset and every development transform are octave- or
 * degree-based, so nothing the grammar does can put an off-scale note in the air.
 */
function leadEvents(plan: SessionPlan, from: number, to: number): MusicalEvent[] {
  const sessionEnd = plan.config.mode === 'birth-sky' ? plan.config.sessionSeconds : Infinity;
  const events: MusicalEvent[] = [];

  for (const phrase of phrasesInRange(plan, from, to)) {
    const subject = phrase.subject;

    // Which star gives the phrase its voice, and what it is anchored to.
    const voiceStar =
      subject.kind === 'constellation'
        ? (plan.motifStars.get(subject.motif.starIds[0] as string) as Star | undefined)
        : subject.star;
    if (!voiceStar) continue;

    // The subject's own note: the scale degree of its culmination altitude,
    // carried up into the lead's register. For a motif the degrees are contour
    // offsets, so they ride on top of that anchor.
    const anchorMaxAltitude =
      subject.kind === 'constellation'
        ? 90 - Math.abs(plan.observer.latitude - subject.motif.meanDec)
        : (plan.chordStars.find((c) => c.star.id === subject.star.id)?.times.maxAltitude ??
          subject.altitude);

    const anchorDegree = Math.round(
      (clamp(anchorMaxAltitude, 0, 90) / 90) * (plan.degreesPerOctave - 1),
    );
    const registerDegrees = plan.config.leadOctaveOffset * plan.degreesPerOctave;

    for (const note of phrase.notes) {
      if (note.startSeconds < from || note.startSeconds >= to) continue;
      if (note.startSeconds >= sessionEnd) continue;

      const midi = degreeToMidi(
        anchorDegree + registerDegrees + note.degree,
        plan.rootMidi,
        plan.scale,
      );

      const here = horizonAtEvent(plan, voiceStar, note.startSeconds);

      // A chime must not ring on past the end of the piece — the closing gesture
      // is supposed to leave one star alone, not one star plus a stray bell.
      const duration = Number.isFinite(sessionEnd)
        ? Math.min(note.durationSeconds, sessionEnd - note.startSeconds)
        : note.durationSeconds;

      const baseGain =
        subject.kind === 'constellation'
          ? magnitudeToAmplitude(voiceStar.mag)
          : magnitudeToAmplitude(subject.star.mag) *
            (subject.kind === 'culmination' ? 1 : subject.kind === 'rise' ? 0.8 : 0.6);

      events.push({
        sourceId: voiceStar.id,
        role: 'lead',
        midi,
        amplitude: round(baseGain * note.gain, 4),
        pan: round(azimuthToPan(here.azimuth), 4),
        timbre: colourToTimbre(voiceStar.bv),
        twinkle: round(altitudeToTwinkle(Math.max(0, here.altitude)), 4),
        startSeconds: round(note.startSeconds, 3),
        durationSeconds: round(Math.max(0.1, duration), 3),
        phraseId: phrase.phraseId,
        ...(subject.kind === 'constellation'
          ? { motifId: subject.motif.constellation }
          : {}),
        origin:
          subject.kind === 'constellation'
            ? {
                kind: 'constellation',
                constellation: subject.motif.constellation,
                starId: voiceStar.id,
                skySeconds: round(subject.skySeconds, 3),
              }
            : {
                kind: subject.kind,
                starId: subject.star.id,
                skySeconds: round(subject.skySeconds, 3),
              },
      });
    }
  }

  return events;
}

// ----------------------------------------------------------- FIGURATION

/**
 * The meso layer: a continuous weave through the chord that is already
 * sounding. Pitches come straight from `soundingChordTones`, so a figuration
 * note can only ever double a tone genuinely in the air.
 */
function figurationEvents(plan: SessionPlan, from: number, to: number): MusicalEvent[] {
  return figurationNotesInRange(plan, from, to).map((note) => ({
    sourceId: note.starId,
    role: 'figuration' as const,
    midi: note.midi,
    amplitude: note.amplitude,
    pan: note.pan,
    timbre: colourToTimbre(
      plan.chordStars.find((c) => c.star.id === note.starId)?.star.bv,
    ),
    twinkle: note.twinkle,
    startSeconds: note.startSeconds,
    durationSeconds: note.durationSeconds,
    ...(note.motifId ? { motifId: note.motifId } : {}),
    origin: {
      kind: (note.motifId ? 'constellation' : 'visible') as 'constellation' | 'visible',
      starId: note.starId,
      ...(note.motifId ? { constellation: note.motifId } : {}),
      skySeconds: round(note.startSeconds * plan.kappa, 3),
    },
  }));
}

// ------------------------------------------------- GROUND and WEATHER

/**
 * The continuous roles, emitted on an absolute grid.
 *
 * A grid rather than "one per window" is what keeps them partition-invariant:
 * tie a continuous layer to window boundaries and the union of two windows would
 * carry two segments where one window carries one.
 */
function continuousEvents(plan: SessionPlan, from: number, to: number): MusicalEvent[] {
  const segment = Math.max(1, plan.config.continuousSegmentSeconds);
  const sessionEnd = plan.config.mode === 'birth-sky' ? plan.config.sessionSeconds : Infinity;
  const events: MusicalEvent[] = [];

  const firstIndex = Math.floor(Math.max(0, from) / segment);
  const lastIndex = Math.floor(Math.max(0, to - 1e-9) / segment);

  for (let i = firstIndex; i <= lastIndex; i++) {
    const start = i * segment;
    if (start < from || start >= to || start >= sessionEnd) continue;
    const end = Math.min(start + segment, sessionEnd);

    const steps = Math.max(1, Math.round(segment / Math.max(1, plan.config.envelopeStepSeconds)));
    const groundCurve: AmplitudeBreakpoint[] = [];
    const weatherCurve: AmplitudeBreakpoint[] = [];
    for (let k = 0; k <= steps; k++) {
      const at = start + ((end - start) * k) / steps;
      const arc = arcAt(plan, at);
      groundCurve.push({
        atSeconds: round(at - start, 3),
        amplitude: round(0.55 + 0.45 * arc.intensity, 4),
      });
      weatherCurve.push({
        atSeconds: round(at - start, 3),
        amplitude: round(arc.intensity, 4),
      });
    }

    const skySeconds = round(start * plan.kappa, 3);

    events.push({
      sourceId: 'ground',
      role: 'ground',
      midi: plan.rootMidi,
      amplitude: 1,
      pan: 0,
      timbre: { warmth: 0.8, brightness: 0.2 },
      twinkle: 0,
      startSeconds: round(start, 3),
      durationSeconds: round(end - start, 3),
      envelope: groundCurve,
      origin: { kind: 'ground', skySeconds },
    });

    events.push({
      sourceId: 'weather',
      role: 'weather',
      midi: plan.rootMidi,
      registerHint: WEATHER_REGISTER_HINT,
      amplitude: 1,
      pan: 0,
      timbre: { warmth: 0.5, brightness: 0.5 },
      twinkle: 0,
      startSeconds: round(start, 3),
      durationSeconds: round(end - start, 3),
      envelope: weatherCurve,
      origin: { kind: 'ground', skySeconds },
    });
  }
  return events;
}

// --------------------------------------------------------------- window

/**
 * The window's weather, sampled on a coarse absolute grid and remembered.
 *
 * A full measurement walks the whole catalogue, and the sky does not change
 * meaningfully inside half a minute of listening. Quantising to an ABSOLUTE grid
 * (never to the window's own start) keeps the value identical however the stream
 * is sliced, so partition invariance is untouched.
 */
const WEATHER_SAMPLE_SECONDS = 30;

function sampledWeather(plan: SessionPlan, pieceSeconds: number): SkyWeather {
  const bucket = Math.floor(pieceSeconds / WEATHER_SAMPLE_SECONDS);
  const cached = plan.weatherCache.get(bucket);
  if (cached) return cached;

  const at = bucket * WEATHER_SAMPLE_SECONDS;
  const measured = measureWeather(
    plan.catalog,
    plan.observer.latitude,
    lstAt(plan.lst0, at, plan.kappa),
  );
  plan.weatherCache.set(bucket, measured);
  return measured;
}

/**
 * How far weather sits above ground, in semitones.
 *
 * Both roles are voiced from the session root, so without this they land in
 * unison. An octave is the smallest separation that reads as a different voice
 * rather than a detuned copy of the same one.
 */
export const WEATHER_REGISTER_HINT = 12;

const ROLE_ORDER: Record<MusicalEvent['role'], number> = {
  ground: 0,
  weather: 1,
  chord: 2,
  figuration: 3,
  lead: 4,
};

/**
 * Everything that STARTS in `[fromSeconds, toSeconds)`.
 *
 * Pure: the same plan and bounds always produce a deep-equal window.
 */
export function renderWindow(
  plan: SessionPlan,
  fromSeconds: number,
  toSeconds: number,
): ScoreWindow {
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds)) {
    throw new Error(
      `Cosmophony: window bounds must be finite, got [${fromSeconds}, ${toSeconds}).`,
    );
  }
  if (toSeconds < fromSeconds) {
    throw new Error(
      `Cosmophony: window end must not precede its start, got [${fromSeconds}, ${toSeconds}).`,
    );
  }

  const from = Math.max(0, fromSeconds);
  const to = Math.max(from, toSeconds);

  const events = [
    ...continuousEvents(plan, from, to),
    ...chordEvents(plan, from, to),
    ...figurationEvents(plan, from, to),
    ...leadEvents(plan, from, to),
  ].sort(
    (a, b) =>
      a.startSeconds - b.startSeconds ||
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      compareIds(a.sourceId, b.sourceId) ||
      a.midi - b.midi,
  );

  const weather = sampledWeather(plan, from);
  const arc = arcAt(plan, from);

  return {
    fromSeconds: round(from, 3),
    toSeconds: round(to, 3),
    events,
    key: `${pitchClassName(plan.rootMidi)} ${plan.scale}`,
    scale: plan.scale,
    rootMidi: plan.rootMidi,
    kappa: round(plan.kappa, 6),
    weather,
    arc,
    meta: {
      objectCount: plan.catalog.length,
      visibleCount: weather.visibleCount,
      label: describeWindow(plan, arc, weather),
    },
  };
}

function describeWindow(
  plan: SessionPlan,
  arc: ScoreWindow['arc'],
  weather: ScoreWindow['weather'],
): string {
  if (weather.visibleCount === 0) return 'no stars above the horizon';
  const pace = `${Math.round(plan.kappa)}× time`;
  const stars = `${weather.visibleCount.toLocaleString('en-US')} stars above the horizon`;
  return `${stars} · ${arc.stage} · ${pace}`;
}

function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

export { DEGREES_PER_SKY_SECOND, hourAngleAtAltitude };
