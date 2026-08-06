/**
 * Layer 2 — sonification / mapping: public surface.
 *
 * DEPENDENCY RULE (enforced by `test/boundaries.test.ts`): this layer may import
 * ONLY from `../model`. Importing Tone.js, touching the DOM or Web Audio, or
 * reading the clock here is a build failure — it would destroy determinism and
 * make the heart of the project untestable.
 */

export type {
  MappingConfig,
  TimbreParams,
  MusicalEvent,
  MusicalScore,
} from './types.ts';

export {
  sonify,
  DEFAULT_MAPPING_CONFIG,
  PITCH_SPAN_OCTAVES,
  altitudeToMidi,
  magnitudeToAmplitude,
  colourToTimbre,
  azimuthToPan,
  altitudeToTwinkle,
} from './sonify.ts';

export {
  starsAboveHorizon,
  julianDate,
  greenwichMeanSiderealTime,
  localSiderealTime,
  toHorizon,
  normalizeDegrees,
  normalizeHourAngle,
} from './astro.ts';

export type { ScaleName } from './scales.ts';
export { SCALE_NAMES, isScaleName, scaleDegrees, pitchClassName } from './scales.ts';

// ---------------------------------------------------------------------------
// Living Sky — the evolving stream (docs/LIVING_SKY_DESIGN.md, Slice A1a)
// ---------------------------------------------------------------------------

export type {
  VoiceRole,
  EventOrigin,
  AmplitudeBreakpoint,
  SessionMode,
  ArcStage,
  ArcState,
  SkyWeather,
  ScoreWindow,
  LivingSkyConfig,
} from './types.ts';

export {
  SIDEREAL_DAY_SECONDS,
  DEGREES_PER_SKY_SECOND,
  skySecondsAt,
  siderealPeriodInPiece,
  lstAt,
  sessionLst0,
  firstTimeAtLst,
  occurrencesInRange,
} from './skyTime.ts';

export type { StarVisibility, StarEventTimes, SkyEvent } from './skyEvents.ts';
export { hourAngleAtAltitude, starEventTimes } from './skyEvents.ts';

export {
  measureWeather,
  meanWeather,
  scaleForWeather,
  registerSpanOctaves,
  silenceBudget,
  noteBudgetPerMinute,
  notesPerPhrase,
  WEATHER_SCALES,
} from './skyWeather.ts';

export type { SessionPlan, ChordStarPlan } from './session.ts';
export {
  DEFAULT_LIVING_SKY_CONFIG,
  resolveConfig,
  prepareSession,
  solveKappa,
  paceComfort,
  arcAt,
  degreeForMaxAltitude,
  canonicalMidiForMaxAltitude,
} from './session.ts';

export type { Motif } from './motif.ts';
export {
  angularSeparation,
  degreeToMidi,
  transposeDegrees,
  invertDegrees,
  scaleGaps,
  shiftOctaves,
  deriveMotif,
  deriveAllMotifs,
} from './motif.ts';

export type { MotifEvent, PhraseSubject, PhraseNote, Phrase } from './conductor.ts';
export {
  eventsInRange,
  motifEventsInRange,
  salience,
  phraseBounds,
  noteAllowance,
  phraseForIndex,
  phrasesInRange,
  subjectKey,
} from './conductor.ts';

export { renderWindow } from './stream.ts';

// Slice A3 — the FIGURATION layer
export type { SoundingTone } from './chordVoices.ts';
export { soundingChordTones, soundingChordTonesCached } from './chordVoices.ts';
export type { FigurationSlot, FigurationNote } from './figuration.ts';
export {
  cycleSeconds,
  cycleIndexAt,
  cycleStartSeconds,
  activeCountAt,
  patternAt,
  figurationNotesInRange,
  noteRateAt,
} from './figuration.ts';
