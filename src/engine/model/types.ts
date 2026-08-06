/**
 * Layer 1 — data model.
 *
 * Normalized, serializable representations of cosmic objects and the observer.
 * This layer depends on NOTHING: no libraries, no DOM, no other engine layer.
 * Everything here must survive `JSON.parse(JSON.stringify(x))` unchanged.
 */

/** A single star from the HYG catalogue subset. */
export interface Star {
  /** HYG / HIP identifier, as a string. */
  id: string;
  /** Proper name ("Sirius"), if the catalogue has one. */
  name?: string;
  /** Right ascension in DEGREES (J2000). */
  ra: number;
  /** Declination in DEGREES (J2000). */
  dec: number;
  /** Apparent visual magnitude (lower = brighter; Sirius ≈ −1.46). */
  mag: number;
  /** B–V colour index (negative = hot/blue, positive = cool/red). Drives timbre. */
  bv?: number;
  /** Constellation abbreviation, if known. */
  constellation?: string;
}

/** A place and moment to observe from. */
export interface ObserverInput {
  /** Degrees, + north. */
  latitude: number;
  /** Degrees, + east. */
  longitude: number;
  /** Calendar date, "YYYY-MM-DD". */
  dateISO: string;
  /** Minutes since local midnight. `undefined` ⇒ default to local midnight (0). */
  timeMinutes?: number;
  /**
   * Fixed UTC offset in minutes, resolved from the city record.
   * v1 has no DST database — this is a single fixed offset per city, and the UI
   * must say so.
   */
  tzOffsetMinutes: number;
}

/** A star reduced to the observer's local horizon frame. */
export interface HorizonStar {
  star: Star;
  /** Degrees above the horizon; > 0 means visible. */
  altitude: number;
  /** Degrees, 0 = North, 90 = East, increasing clockwise. */
  azimuth: number;
}

/** A city from the bundled GeoNames subset (loaded in Phase 1). */
export interface City {
  name: string;
  /** ISO country code or country name, as bundled. */
  country: string;
  /** Degrees, + north. */
  lat: number;
  /** Degrees, + east. */
  lon: number;
  /** Fixed UTC offset in minutes (no DST in v1). */
  tzOffsetMinutes: number;
}
