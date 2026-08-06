/**
 * Layer 1 — loading and validating the bundled data.
 *
 * Two halves on purpose:
 *   - `parseStarCatalog` / `parseCities` are PURE: unknown JSON in, typed data
 *     out, or a `DataError` explaining exactly what was wrong and where. They
 *     can be tested against the real bundled files without a browser.
 *   - `loadStarCatalog` / `loadCities` are the thin fetch wrappers around them.
 *
 * Still dependency-free: `fetch` is a global, not an import, so the model layer
 * keeps its "depends on nothing" guarantee.
 *
 * Validation is deliberately strict. Bad star data does not crash loudly at load
 * time — it produces a star sitting in the wrong part of the sky, which is a
 * silent lie. The whole promise of this project is that the structure is true,
 * so a malformed catalogue must fail immediately and say why.
 */

import type { City, Star } from './types.ts';

/** Where the bundled data lives, relative to the page. */
export const STAR_CATALOG_URL = 'data/stars.hyg.subset.json';
export const CITIES_URL = 'data/cities.json';

/** A load or validation failure, phrased for a human. */
export class DataError extends Error {
  readonly source: string;

  constructor(source: string, detail: string) {
    super(`Cosmophony could not read ${source}: ${detail}`);
    this.name = 'DataError';
    this.source = source;
  }
}

const REGENERATE = 'Re-run `npm run build:data` to regenerate the bundled data.';

// ------------------------------------------------------------ field helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Describe a bad value briefly enough to be useful in an error message. */
function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function requireArray(raw: unknown, source: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new DataError(source, `expected a JSON array, found ${describe(raw)}. ${REGENERATE}`);
  }
  if (raw.length === 0) {
    throw new DataError(source, `the file is an empty array — there is no data to load. ${REGENERATE}`);
  }
  return raw;
}

function requireRecord(entry: unknown, source: string, index: number): Record<string, unknown> {
  if (!isRecord(entry)) {
    throw new DataError(source, `entry ${index} should be an object, found ${describe(entry)}. ${REGENERATE}`);
  }
  return entry;
}

function requireNumber(
  entry: Record<string, unknown>,
  field: string,
  source: string,
  index: number,
  min: number,
  max: number,
): number {
  const value = entry[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataError(
      source,
      `entry ${index} has a non-numeric "${field}" (found ${describe(value)}). ${REGENERATE}`,
    );
  }
  if (value < min || value > max) {
    throw new DataError(
      source,
      `entry ${index} has "${field}" = ${value}, outside the valid range ${min}..${max}. ${REGENERATE}`,
    );
  }
  return value;
}

function optionalNumber(
  entry: Record<string, unknown>,
  field: string,
  source: string,
  index: number,
): number | undefined {
  const value = entry[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataError(
      source,
      `entry ${index} has a non-numeric "${field}" (found ${describe(value)}). ` +
        `Omit the field entirely if it is unknown. ${REGENERATE}`,
    );
  }
  return value;
}

function requireString(
  entry: Record<string, unknown>,
  field: string,
  source: string,
  index: number,
): string {
  const value = entry[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new DataError(
      source,
      `entry ${index} has a missing or empty "${field}" (found ${describe(value)}). ${REGENERATE}`,
    );
  }
  return value;
}

function optionalString(
  entry: Record<string, unknown>,
  field: string,
  source: string,
  index: number,
): string | undefined {
  const value = entry[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new DataError(
      source,
      `entry ${index} has a non-string "${field}" (found ${describe(value)}). ${REGENERATE}`,
    );
  }
  return value.length > 0 ? value : undefined;
}

// -------------------------------------------------------------------- stars

/**
 * Validate raw JSON into a star catalogue.
 *
 * Ranges checked: RA is 0..360 DEGREES (the prep script converts from HYG's
 * hours), Dec is −90..90, magnitude is −30..30, B–V is −1..6.
 */
export function parseStarCatalog(raw: unknown, source = STAR_CATALOG_URL): Star[] {
  const rows = requireArray(raw, source);
  const stars: Star[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const entry = requireRecord(rows[i], source, i);
    const star: Star = {
      id: requireString(entry, 'id', source, i),
      ra: requireNumber(entry, 'ra', source, i, 0, 360),
      dec: requireNumber(entry, 'dec', source, i, -90, 90),
      mag: requireNumber(entry, 'mag', source, i, -30, 30),
    };

    const name = optionalString(entry, 'name', source, i);
    if (name !== undefined) star.name = name;

    const bv = optionalNumber(entry, 'bv', source, i);
    if (bv !== undefined) {
      if (bv < -1 || bv > 6) {
        throw new DataError(
          source,
          `entry ${i} has "bv" = ${bv}, outside the plausible B–V range −1..6. ${REGENERATE}`,
        );
      }
      star.bv = bv;
    }

    const constellation = optionalString(entry, 'constellation', source, i);
    if (constellation !== undefined) star.constellation = constellation;

    stars[i] = star;
  }

  return stars;
}

// ------------------------------------------------------------------- cities

/** Validate raw JSON into a city list. */
export function parseCities(raw: unknown, source = CITIES_URL): City[] {
  const rows = requireArray(raw, source);
  const cities: City[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const entry = requireRecord(rows[i], source, i);
    cities[i] = {
      name: requireString(entry, 'name', source, i),
      country: requireString(entry, 'country', source, i),
      lat: requireNumber(entry, 'lat', source, i, -90, 90),
      lon: requireNumber(entry, 'lon', source, i, -180, 180),
      // Real offsets span −12:00 to +14:00.
      tzOffsetMinutes: requireNumber(entry, 'tzOffsetMinutes', source, i, -720, 840),
    };
  }

  return cities;
}

// ------------------------------------------------------------------ fetching

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new DataError(
      url,
      `the file could not be reached — check that the app is served with its ` +
        `public/data folder alongside it. (${(cause as Error).message})`,
    );
  }

  if (!response.ok) {
    throw new DataError(url, `the server answered ${response.status} ${response.statusText}.`);
  }

  try {
    return await response.json();
  } catch (cause) {
    throw new DataError(url, `the file is not valid JSON. (${(cause as Error).message}) ${REGENERATE}`);
  }
}

/** Fetch and validate the bundled star catalogue. */
export async function loadStarCatalog(url = STAR_CATALOG_URL): Promise<Star[]> {
  return parseStarCatalog(await fetchJson(url), url);
}

/** Fetch and validate the bundled city list. */
export async function loadCities(url = CITIES_URL): Promise<City[]> {
  return parseCities(await fetchJson(url), url);
}
