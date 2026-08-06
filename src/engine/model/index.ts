/**
 * Layer 1 — data model: public surface.
 *
 * Dependency rule: this layer imports nothing. Not Tone, not the DOM, not
 * `mapping` or `audio`. If an import ever appears here that is not a relative
 * path inside `model/`, the architecture has been broken.
 */

export type { Star, ObserverInput, HorizonStar, City } from './types.ts';

export {
  DataError,
  STAR_CATALOG_URL,
  CITIES_URL,
  parseStarCatalog,
  parseCities,
  loadStarCatalog,
  loadCities,
} from './load.ts';
