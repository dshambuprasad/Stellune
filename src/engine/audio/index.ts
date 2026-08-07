/**
 * Layer 3 — audio synthesis: public surface.
 *
 * Tone.js is imported in `engine.ts` and nowhere else in the project. The pure
 * half (`voicing.ts`) is exported too, so the sound-design decisions can be
 * inspected and tested without a browser.
 */

export type { AudioEngine } from './types.ts';
export { createAudioEngine, renderOffline } from './engine.ts';

export type { AudioPlan, VoicePlan, DronePlan, ShimmerPlan, ChorusPlan, AudioStyle } from './voicing.ts';
export {
  planAudio,
  midiToFrequency,
  rootPitchClass,
  timbreToCutoff,
  timbreToPartials,
} from './voicing.ts';

// Slice A2 — the streaming scheduler over a Living Sky session.
export type { StreamEngine, StreamEngineOptions } from './streamEngine.ts';
export { createStreamEngine, renderStreamOffline } from './streamEngine.ts';

// Slice B0 — the sampled instruments and the mood-lens contract.
export type {
  LensConfig,
  LensDefinition,
  LensVoicing,
  ShadingConfig,
  SampleManifest,
  InstrumentEntry,
  SampleEntry,
  ChosenVoice,
  EqLane,
  MasteringConfig,
} from './samplerLenses.ts';
export {
  LENS_ROLES,
  MASTERING_DEFAULTS,
  chooseVoice,
  eqLaneFor,
  instrumentsForLens,
  masteringFor,
  shadingTiltDb,
  validateEqLanes,
  validateLensConfig,
} from './samplerLenses.ts';
export { SamplerBank, loadSampleCatalogue, lensPayloadBytes, preferredFormat } from './samplerBank.ts';

// Slice B1 — the live sampled player, and the laws it plays under.
export type { SampledStream, SampledStreamOptions } from './sampledStream.ts';
export { createSampledStream, createSampledStreamFromUrl } from './sampledStream.ts';
export type { MixCalibration, LensCalibration } from './mixLaw.ts';
export {
  DEFAULT_CALIBRATION,
  SEND_LEVELS,
  STEM_TARGETS_DBFS,
  STEM_TOLERANCE_DB,
  ROLE_SHAPING,
  isCalibrated,
  loadCalibration,
} from './mixLaw.ts';
