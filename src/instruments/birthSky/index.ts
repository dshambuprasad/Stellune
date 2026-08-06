/**
 * Instrument #1 — "Birth Sky": your sky as an evolving ambient drone.
 *
 * Built out in Phase 4. Here it exists only to pin the shape: an `Instrument`
 * whose input is an `ObserverInput`, whose score comes from the engine's
 * mapping layer, and whose `mount` draws the calm star-field.
 */

import type { MusicalScore, ObserverInput } from '../../engine/index.ts';
import type { Instrument, InstrumentContext } from '../types.ts';

export const birthSky: Instrument<ObserverInput> = {
  id: 'birth-sky',
  name: 'Birth Sky',

  buildScore(_input: ObserverInput): MusicalScore {
    // Phase 4: load the catalogue, starsAboveHorizon(catalog, input), sonify(...).
    throw new Error('not implemented');
  },

  mount(_container: HTMLElement, _ctx: InstrumentContext): void {
    // Phase 4: the input form, the canvas star-field, the honesty label.
    throw new Error('not implemented');
  },

  unmount(): void {
    throw new Error('not implemented');
  },
};
