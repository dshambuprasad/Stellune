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

// ---------------------------------------------------------------------------
// Living Sky — the evolving stream (Slices A1a–A4)
//
// Re-exported here because `app/` depends on this surface, not on the layers:
// the harness and the star field both need to prepare a session and render a
// window, and neither should have to know which module inside `mapping/` those
// live in.
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
  SessionPlan,
  ChordStarPlan,
} from './mapping/index.ts';
export {
  DEFAULT_LIVING_SKY_CONFIG,
  resolveConfig,
  prepareSession,
  arcAt,
  renderWindow,
  WEATHER_REGISTER_HINT,
  measureWeather,
  meanWeather,
  scaleForWeather,
} from './mapping/index.ts';

export type { MovementPlan, Movement, FormPosition, PatternName } from './mapping/index.ts';
export { planMovements, formAt, PATTERN_VOCABULARY } from './mapping/index.ts';

// Slice B0/B1 — sampled instruments, mood lenses, and the live player.
export type {
  LensConfig,
  SampleManifest,
  SampledStream,
  SampledStreamOptions,
  MixCalibration,
} from './audio/index.ts';
export {
  LENS_ROLES,
  createSampledStream,
  createSampledStreamFromUrl,
  loadSampleCatalogue,
  loadCalibration,
  masteringFor,
  eqLaneFor,
  validateEqLanes,
  isCalibrated,
} from './audio/index.ts';
