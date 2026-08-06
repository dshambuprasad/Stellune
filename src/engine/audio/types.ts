/**
 * Layer 3 — audio synthesis: the contract.
 *
 * This is the ONLY layer allowed to import Tone.js (added in Phase 3) or touch
 * Web Audio. It consumes a `MusicalScore` and makes sound; it never decides
 * what the music should be.
 */

import type { MusicalScore } from '../mapping/index.ts';

export interface AudioEngine {
  /** Build (or rebuild) the voice graph for a score. Safe to call repeatedly. */
  load(score: MusicalScore): void;
  /**
   * Start the loop. MUST be called from a user gesture — it calls `Tone.start()`
   * to unlock the browser's audio context.
   */
  play(): Promise<void>;
  /** Stop sounding, but keep the graph loaded. */
  stop(): void;
  /** Tear the graph down and release every node. */
  dispose(): void;
  /** Per-voice levels / analyser data, for driving the star-field glow. */
  getLevels(): Float32Array;
}
