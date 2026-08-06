/**
 * The plug-in contract.
 *
 * An instrument is a thin experience on top of the engine: it knows how to turn
 * its own kind of input into a `MusicalScore`, and how to draw itself. It must
 * never reach past the engine's public surface.
 *
 * The architecture is proven in Phase 6 by the fact that adding the orrery
 * instrument requires touching only `instruments/orrery/` — zero edits to
 * `engine/`.
 */

import type { AudioEngine, MappingConfig, MusicalScore } from '../engine/index.ts';

/** What the app shell hands an instrument when it mounts. */
export interface InstrumentContext {
  /** The shared audio engine; the instrument loads its score into this. */
  audio: AudioEngine;
  /** The active mapping config (mood, key, voice count, loop length). */
  config: MappingConfig;
}

export interface Instrument<TInput = unknown> {
  /** Stable id, e.g. "birth-sky". */
  id: string;
  /** Display name, e.g. "Birth Sky". */
  name: string;
  /** Pure: input → score, via the engine's mapping layer. */
  buildScore(input: TInput): MusicalScore;
  /** Thin UI/visual. The only place an instrument touches the DOM. */
  mount(container: HTMLElement, ctx: InstrumentContext): void;
  /** Release listeners, animation frames, and DOM nodes. */
  unmount(): void;
}
