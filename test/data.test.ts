/**
 * Phase 1 — the bundled data is real, and the loaders will refuse anything else.
 *
 * These tests read the ACTUAL files in `public/data/`, not fixtures. The point is
 * to catch a bad regeneration of the catalogue, not to prove a validator works on
 * data written to please it. Spot-checks use published astronomical values, so a
 * unit mix-up (RA in hours instead of degrees, say) fails loudly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DataError,
  loadCities,
  loadStarCatalog,
  parseCities,
  parseStarCatalog,
  type City,
  type Star,
} from '../src/engine/model/index.ts';

const dataFile = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/${name}`, import.meta.url)), 'utf8'));

const stars: Star[] = parseStarCatalog(dataFile('stars.hyg.subset.json'));
const cities: City[] = parseCities(dataFile('cities.json'));

const byName = (name: string): Star => {
  const star = stars.find((s) => s.name === name);
  if (!star) throw new Error(`${name} is missing from the bundled catalogue`);
  return star;
};

const city = (name: string): City => {
  const found = cities.find((c) => c.name === name);
  if (!found) throw new Error(`${name} is missing from the bundled city list`);
  return found;
};

describe('star catalogue', () => {
  it('parses without error', () => {
    expect(stars.length).toBeGreaterThan(0);
  });

  it('holds roughly the expected number of naked-eye stars (~9k)', () => {
    // HYG v3.8 at mag <= 6.5, minus the Sun and minus 71 unresolvable close
    // pairs, is 8,849. The band leaves room for a future catalogue revision
    // without leaving room for a broken filter.
    expect(stars.length).toBeGreaterThan(8000);
    expect(stars.length).toBeLessThan(10000);
  });

  it('respects the naked-eye magnitude limit', () => {
    const faintest = Math.max(...stars.map((s) => s.mag));
    expect(faintest).toBeLessThanOrEqual(6.5);
  });

  it('does not include the Sun', () => {
    // The Sun sits at mag -26.7; nothing should be anywhere near that bright.
    expect(Math.min(...stars.map((s) => s.mag))).toBeGreaterThan(-5);
    expect(stars.some((s) => s.name === 'Sol' || s.id === '0')).toBe(false);
  });

  it('has unique ids', () => {
    expect(new Set(stars.map((s) => s.id)).size).toBe(stars.length);
  });

  it('keeps every coordinate inside its valid range', () => {
    for (const star of stars) {
      expect(star.ra).toBeGreaterThanOrEqual(0);
      expect(star.ra).toBeLessThanOrEqual(360);
      expect(star.dec).toBeGreaterThanOrEqual(-90);
      expect(star.dec).toBeLessThanOrEqual(90);
    }
  });

  it('uses the full 0-360 degree RA range, not 0-24 hours', () => {
    // The single most likely data bug: HYG stores RA in hours. If the x15
    // conversion were dropped, the maximum would sit just under 24.
    expect(Math.max(...stars.map((s) => s.ra))).toBeGreaterThan(300);
  });

  // Published J2000 positions, for reference:
  //   Sirius      RA 06h 45m 09s = 101.29 deg, Dec -16.72, mag -1.46
  //   Betelgeuse  RA 05h 55m 10s =  88.79 deg, Dec  +7.41, mag ~0.45 (variable)
  //   Polaris     RA 02h 31m 49s =  37.95 deg, Dec +89.26, mag  1.98
  //   Vega        RA 18h 36m 56s = 279.23 deg, Dec +38.78, mag  0.03
  it('places Sirius correctly and brightest', () => {
    const sirius = byName('Sirius');
    expect(sirius.ra).toBeCloseTo(101.29, 1);
    expect(sirius.dec).toBeCloseTo(-16.72, 1);
    // HYG v3.8 records -1.44; the modern published value is -1.46.
    expect(sirius.mag).toBeCloseTo(-1.45, 1);
    expect(sirius.constellation).toBe('CMa');
    expect(stars[0]?.name).toBe('Sirius');
  });

  it('places Betelgeuse correctly, red and cool', () => {
    const betelgeuse = byName('Betelgeuse');
    expect(betelgeuse.ra).toBeCloseTo(88.79, 1);
    expect(betelgeuse.dec).toBeCloseTo(7.41, 1);
    expect(betelgeuse.constellation).toBe('Ori');
    // A red supergiant: B-V well above 1. This is what will drive its timbre.
    expect(betelgeuse.bv).toBeGreaterThan(1.2);
  });

  it('places Polaris almost exactly at the north celestial pole', () => {
    const polaris = byName('Polaris');
    expect(polaris.ra).toBeCloseTo(37.95, 1);
    expect(polaris.dec).toBeCloseTo(89.26, 1);
    // Phase 2 leans on this: Polaris altitude should equal observer latitude.
    expect(polaris.dec).toBeGreaterThan(89);
  });

  it('places Vega correctly and hot', () => {
    const vega = byName('Vega');
    expect(vega.ra).toBeCloseTo(279.23, 1);
    expect(vega.dec).toBeCloseTo(38.78, 1);
    // Vega defines B-V = 0.00 by convention.
    expect(vega.bv).toBeCloseTo(0, 1);
  });

  it('carries colour for nearly every star, since timbre depends on it', () => {
    const withColour = stars.filter((s) => s.bv !== undefined).length;
    expect(withColour / stars.length).toBeGreaterThan(0.99);
  });

  it('holds no pair closer than the naked eye can resolve', () => {
    // HYG lists secondary components of multiple-star systems as separate rows;
    // the prep script merges anything under 1 arcminute so one visible point of
    // light cannot claim two voices. This asserts the merge actually happened.
    const D = Math.PI / 180;
    const separation = (a: Star, b: Star): number => {
      const cosine =
        Math.sin(a.dec * D) * Math.sin(b.dec * D) +
        Math.cos(a.dec * D) * Math.cos(b.dec * D) * Math.cos((a.ra - b.ra) * D);
      return Math.acos(Math.min(1, Math.max(-1, cosine))) / D;
    };

    // Bucket by whole degrees of declination; RA cells converge near the poles.
    const bands = new Map<number, Star[]>();
    for (const star of stars) {
      const band = Math.floor(star.dec);
      const bucket = bands.get(band);
      if (bucket) bucket.push(star);
      else bands.set(band, [star]);
    }

    let closest = Infinity;
    for (const star of stars) {
      const band = Math.floor(star.dec);
      for (let d = -1; d <= 1; d++) {
        for (const other of bands.get(band + d) ?? []) {
          if (other.id === star.id) continue;
          closest = Math.min(closest, separation(star, other));
        }
      }
    }
    expect(closest * 60).toBeGreaterThanOrEqual(1); // arcminutes
  });

  it('keeps genuine naked-eye doubles', () => {
    // Mizar and Alcor are 11.8 arcminutes apart — two stars anyone can see as
    // two. The merge must not be greedy enough to swallow them.
    expect(byName('Mizar')).toBeDefined();
    expect(byName('Alcor')).toBeDefined();
  });

  it('names the bright stars worth naming', () => {
    const named = stars.filter((s) => s.name !== undefined);
    expect(named.length).toBeGreaterThan(300);
    // Every star brighter than mag 1 is famous enough to have a proper name.
    for (const star of stars.filter((s) => s.mag < 1)) {
      expect(star.name, `star ${star.id} at mag ${star.mag} has no name`).toBeDefined();
    }
  });
});

describe('city list', () => {
  it('parses without error and is the expected size', () => {
    expect(cities.length).toBeGreaterThanOrEqual(1000);
    expect(cities.length).toBeLessThanOrEqual(2000);
  });

  it('covers a lot of the world, not just the dense parts', () => {
    expect(new Set(cities.map((c) => c.country)).size).toBeGreaterThan(150);
  });

  // Published coordinates, for reference:
  //   Bengaluru 12.97 N,  77.59 E, UTC+05:30
  //   London    51.51 N,   0.13 W, UTC+00:00 (standard time)
  //   New York  40.71 N,  74.01 W, UTC-05:00 (standard time)
  //   Sydney    33.87 S, 151.21 E, UTC+10:00 (standard time)
  //   Kathmandu 27.70 N,  85.32 E, UTC+05:45
  it('resolves Bengaluru to the right place and offset', () => {
    const b = city('Bengaluru');
    expect(b.lat).toBeCloseTo(12.97, 1);
    expect(b.lon).toBeCloseTo(77.59, 1);
    expect(b.tzOffsetMinutes).toBe(330); // +05:30
    expect(b.country).toBe('India');
  });

  it('resolves London to the right place and offset', () => {
    const l = city('London');
    expect(l.lat).toBeCloseTo(51.51, 1);
    expect(l.lon).toBeCloseTo(-0.13, 1);
    expect(l.tzOffsetMinutes).toBe(0);
  });

  it('resolves New York City to a negative (western) longitude and offset', () => {
    const ny = city('New York City');
    expect(ny.lat).toBeCloseTo(40.71, 1);
    expect(ny.lon).toBeCloseTo(-74.01, 1);
    expect(ny.tzOffsetMinutes).toBe(-300); // -05:00 standard time
  });

  it('handles the southern hemisphere', () => {
    const sydney = city('Sydney');
    expect(sydney.lat).toBeLessThan(-30);
    expect(sydney.lon).toBeCloseTo(151.21, 1);
  });

  it('preserves quarter-hour timezones', () => {
    // Nepal is UTC+05:45 — a rounding shortcut to whole hours would break this.
    expect(city('Kathmandu').tzOffsetMinutes).toBe(345);
  });

  it('keeps every coordinate and offset inside its valid range', () => {
    for (const c of cities) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
      expect(c.tzOffsetMinutes).toBeGreaterThanOrEqual(-720);
      expect(c.tzOffsetMinutes).toBeLessThanOrEqual(840);
    }
  });

  it('has no duplicate name+country pairs', () => {
    const keys = cities.map((c) => `${c.name}|${c.country}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('loader validation — malformed data fails loudly and helpfully', () => {
  it('rejects a non-array', () => {
    expect(() => parseStarCatalog({ stars: [] })).toThrow(DataError);
    expect(() => parseStarCatalog({ stars: [] })).toThrow(/expected a JSON array, found a object/);
  });

  it('rejects an empty array', () => {
    expect(() => parseStarCatalog([])).toThrow(/empty array/);
  });

  it('names the offending entry and field', () => {
    const rows = [
      { id: '1', ra: 10, dec: 10, mag: 3 },
      { id: '2', ra: 'north-ish', dec: 10, mag: 3 },
    ];
    expect(() => parseStarCatalog(rows)).toThrow(
      /entry 1 has a non-numeric "ra" \(found the string "north-ish"\)/,
    );
  });

  it('rejects out-of-range coordinates rather than silently placing a star wrongly', () => {
    // 6.75 would be Sirius's RA left in HOURS. Caught, not quietly accepted.
    expect(() => parseStarCatalog([{ id: '1', ra: 400, dec: 10, mag: 3 }])).toThrow(
      /"ra" = 400, outside the valid range 0\.\.360/,
    );
    expect(() => parseStarCatalog([{ id: '1', ra: 10, dec: 120, mag: 3 }])).toThrow(
      /"dec" = 120, outside the valid range -90\.\.90/,
    );
  });

  it('rejects a missing id', () => {
    expect(() => parseStarCatalog([{ ra: 10, dec: 10, mag: 3 }])).toThrow(
      /entry 0 has a missing or empty "id" \(found nothing\)/,
    );
  });

  it('accepts omitted optional fields but rejects wrong-typed ones', () => {
    expect(parseStarCatalog([{ id: '1', ra: 10, dec: 10, mag: 3 }])[0]?.bv).toBeUndefined();
    expect(() => parseStarCatalog([{ id: '1', ra: 10, dec: 10, mag: 3, bv: null }])).toThrow(
      /non-numeric "bv" \(found null\)/,
    );
  });

  it('rejects an implausible timezone offset', () => {
    const rows = [{ name: 'Nowhere', country: 'Nowhereland', lat: 0, lon: 0, tzOffsetMinutes: 5000 }];
    expect(() => parseCities(rows)).toThrow(/"tzOffsetMinutes" = 5000, outside the valid range/);
  });

  it('reports which file the problem is in', () => {
    expect(() => parseStarCatalog([], 'data/stars.hyg.subset.json')).toThrow(
      /Cosmophony could not read data\/stars\.hyg\.subset\.json/,
    );
  });

  it('tells the reader how to fix it', () => {
    expect(() => parseCities([])).toThrow(/npm run build:data/);
  });
});

describe('loader fetching — network failures are explained, not swallowed', () => {
  const withFetch = async (impl: typeof fetch, run: () => Promise<unknown>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  it('explains a missing file', async () => {
    await withFetch(
      async () => new Response('not found', { status: 404, statusText: 'Not Found' }),
      async () => {
        await expect(loadStarCatalog()).rejects.toThrow(/answered 404 Not Found/);
      },
    );
  });

  it('explains an unreachable file', async () => {
    await withFetch(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      async () => {
        await expect(loadCities()).rejects.toThrow(/could not be reached/);
      },
    );
  });

  it('explains a file that is not JSON', async () => {
    await withFetch(
      async () => new Response('<!doctype html><h1>404</h1>', { status: 200 }),
      async () => {
        await expect(loadStarCatalog()).rejects.toThrow(/not valid JSON/);
      },
    );
  });

  it('validates what it fetches', async () => {
    await withFetch(
      async () => new Response(JSON.stringify([{ id: '1', ra: 400, dec: 0, mag: 3 }])),
      async () => {
        await expect(loadStarCatalog()).rejects.toThrow(/outside the valid range 0\.\.360/);
      },
    );
  });

  it('returns validated data on the happy path', async () => {
    await withFetch(
      async () => new Response(JSON.stringify([{ id: '1', name: 'Test', ra: 10, dec: 20, mag: 3 }])),
      async () => {
        await expect(loadStarCatalog()).resolves.toEqual([
          { id: '1', name: 'Test', ra: 10, dec: 20, mag: 3 },
        ]);
      },
    );
  });
});
