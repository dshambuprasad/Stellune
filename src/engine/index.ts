/**
 * The Cosmic Sound Engine — public surface.
 *
 * Three decoupled layers, all UI-independent and unit-testable:
 *
 *   model    → depends on nothing
 *   mapping  → depends only on model      (pure, deterministic, NO Tone, NO DOM)
 *   audio    → depends on model + mapping + Tone.js
 *
 * Nothing flows upward. `instruments/` depend on this surface; `app/` depends on
 * everything. The whole point: adding instrument #2 must require zero edits here.
 */

// Layer 1 — data model
export type { Star, ObserverInput, HorizonStar, City } from './model/index.ts';
export {
  DataError,
  STAR_CATALOG_URL,
  CITIES_URL,
  parseStarCatalog,
  parseCities,
  loadStarCatalog,
  loadCities,
} from './model/index.ts';

// Layer 2 — sonification / mapping
export type {
  MappingConfig,
  TimbreParams,
  MusicalEvent,
  MusicalScore,
} from './mapping/index.ts';
export {
  sonify,
  DEFAULT_MAPPING_CONFIG,
  PITCH_SPAN_OCTAVES,
  altitudeToMidi,
  magnitudeToAmplitude,
  colourToTimbre,
  azimuthToPan,
  altitudeToTwinkle,
  starsAboveHorizon,
  julianDate,
  greenwichMeanSiderealTime,
  localSiderealTime,
  toHorizon,
  normalizeDegrees,
  normalizeHourAngle,
} from './mapping/index.ts';
export type { ScaleName } from './mapping/index.ts';
export { SCALE_NAMES, isScaleName, scaleDegrees, pitchClassName } from './mapping/index.ts';

// Layer 3 — audio synthesis
export type {
  AudioEngine,
  AudioPlan,
  VoicePlan,
  DronePlan,
  ShimmerPlan,
  ChorusPlan,
  AudioStyle,
} from './audio/index.ts';
export {
  createAudioEngine,
  renderOffline,
  planAudio,
  midiToFrequency,
  rootPitchClass,
  timbreToCutoff,
  timbreToPartials,
} from './audio/index.ts';

// Slice A2 — streaming audio
export type { StreamEngine, StreamEngineOptions } from './audio/index.ts';
export { createStreamEngine, renderStreamOffline } from './audio/index.ts';
