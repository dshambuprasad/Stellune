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
