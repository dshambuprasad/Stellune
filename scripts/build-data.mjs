#!/usr/bin/env node
/**
 * build-data — regenerate the bundled cosmic + city data from their sources.
 *
 *   node scripts/build-data.mjs          # use cached downloads if present
 *   node scripts/build-data.mjs --fresh  # re-download everything
 *
 * Writes:
 *   public/data/stars.hyg.subset.json   naked-eye stars (mag <= 6.5)
 *   public/data/cities.json             ~1500 world cities with fixed UTC offsets
 *   public/data/ATTRIBUTION.md          sources, licences, access date, checksums
 *
 * Zero dependencies — plain Node (fetch, zlib, crypto). Raw downloads are cached
 * in scripts/.cache/ (gitignored); only the small derived subsets are committed.
 *
 * Deterministic: same inputs produce byte-identical output. Every ordering has an
 * explicit tiebreaker, and ATTRIBUTION.md records the SHA-256 of each source file
 * so a rerun can prove it used the same data.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache');
const OUT = join(ROOT, 'public', 'data');

const FRESH = process.argv.includes('--fresh');

/**
 * Sources. HYG v3.8 is the final v3-series release of the catalogue the build
 * plan specifies; the repo's CURRENT/ folder has since moved to v4.x.
 */
/**
 * The d3-celestial revision the constellation figures are taken from.
 *
 * Last upstream change to `data/constellations.lines.json` was 2020-03-20.
 */
const CONSTELLATION_SOURCE_COMMIT = 'd2e20e104b86429d90ac8227a5b021262b45d75a';

const SOURCES = {
  stars: {
    url: 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v38.csv.gz',
    file: 'hyg_v38.csv.gz',
    home: 'https://github.com/astronexus/HYG-Database',
    licence: 'CC BY-SA 2.5',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/2.5/',
  },
  cities: {
    url: 'https://download.geonames.org/export/dump/cities15000.zip',
    file: 'cities15000.zip',
    home: 'https://download.geonames.org/export/dump/',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  timezones: {
    url: 'https://download.geonames.org/export/dump/timeZones.txt',
    file: 'timeZones.txt',
  },
  countries: {
    url: 'https://download.geonames.org/export/dump/countryInfo.txt',
    file: 'countryInfo.txt',
  },
  /**
   * The Western constellation stick figures (Slice B2).
   *
   * PINNED BY COMMIT, not by branch. The URL names an immutable revision, so
   * "re-run the build" cannot quietly re-draw the sky — a line set is a
   * *drawing*, upstream is free to redraw it, and a keepsake generated last
   * year should still show the Orion it showed last year.
   *
   * THE LICENCE MATTERS AND SO DOES WHICH FILE. d3-celestial is BSD-3-Clause,
   * which this project can ship with attribution. Its *Chinese* skyculture
   * files are NOT: they derive from Stellarium and are GPL, which would reach
   * the whole bundle. This build takes `constellations.lines.json` — the
   * Western set — and nothing else from the repository.
   */
  constellationLines: {
    url:
      'https://raw.githubusercontent.com/ofrohn/d3-celestial/' +
      `${CONSTELLATION_SOURCE_COMMIT}/data/constellations.lines.json`,
    file: 'constellations.lines.json',
    home: 'https://github.com/ofrohn/d3-celestial',
    licence: 'BSD-3-Clause',
    licenceUrl: 'https://opensource.org/licenses/BSD-3-Clause',
    commit: CONSTELLATION_SOURCE_COMMIT,
    copyright: 'Copyright (c) 2015, Olaf Frohn',
  },
};

/** Naked-eye limit, per the build plan. */
const MAG_LIMIT = 6.5;
/**
 * Merge radius for close pairs, in degrees. 1 arcminute is roughly the
 * resolving power of the unaided eye; this is the naked-eye catalogue, so
 * anything tighter is one point of light and must not become two voices.
 * Comfortably below real naked-eye doubles — Mizar and Alcor are 11.8' apart.
 */
const MERGE_ARCMIN = 1;
/** How many cities to bundle. */
const CITY_TARGET = 1500;

// ---------------------------------------------------------------- utilities

const log = (msg) => process.stdout.write(`${msg}\n`);

async function download(source) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, source.file);
  if (existsSync(path) && !FRESH) {
    log(`  cached  ${source.file}`);
    return readFileSync(path);
  }
  log(`  fetch   ${source.url}`);
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(
      `Download failed: ${source.url} returned ${res.status} ${res.statusText}. ` +
        `If the source has moved or become gated, stop and record it in docs/BUILD_LOG.md ` +
        `rather than substituting another dataset.`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Round to `places`, normalising -0 to 0 so output is byte-stable. */
function round(value, places) {
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Minimal RFC-4180 CSV row splitter — HYG quotes names containing commas. */
function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Extract one file from a ZIP archive.
 *
 * Reads the central directory rather than scanning for local headers, because a
 * local header may carry zeroed sizes when a data descriptor is used. Handles
 * stored (0) and deflated (8) entries — everything GeoNames actually ships.
 */
function unzipEntry(buffer, wantedName) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive: no end-of-central-directory record.');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);

  for (let n = 0; n < entryCount; n++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) {
      throw new Error('Corrupt ZIP: bad central-directory signature.');
    }
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    if (name === wantedName) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(start, start + compressedSize);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw);
      throw new Error(`Unsupported ZIP compression method ${method} for "${name}".`);
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`"${wantedName}" not found inside the archive.`);
}

/** Stable JSON: one object per line, so diffs are readable in git. */
function writeJsonLines(path, rows) {
  const body = rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n');
  writeFileSync(path, `[\n${body}\n]\n`);
}

// ------------------------------------------------------------------- stars

function buildStars(csvText) {
  const lines = csvText.split('\n');
  const header = splitCsvLine(lines[0]);
  const col = (name) => {
    const index = header.indexOf(name);
    if (index < 0) {
      throw new Error(
        `HYG column "${name}" is missing — the catalogue format changed. ` +
          `Header was: ${header.join(', ')}`,
      );
    }
    return index;
  };

  const iId = col('id');
  const iProper = col('proper');
  const iRa = col('ra');
  const iDec = col('dec');
  const iMag = col('mag');
  const iCi = col('ci');
  const iCon = col('con');

  const stars = [];
  let skippedSun = 0;
  let skippedUnusable = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const f = splitCsvLine(line);

    const id = f[iId];
    // HYG carries the Sun as id 0 at mag -26.7. Including it would swamp every
    // other voice and it is not part of "the stars above you" — dropped here,
    // and recorded in ATTRIBUTION.md.
    if (id === '0') {
      skippedSun++;
      continue;
    }

    const mag = Number(f[iMag]);
    if (!Number.isFinite(mag) || mag > MAG_LIMIT) continue;

    // HYG stores right ascension in HOURS (0-24). The model wants DEGREES.
    const raHours = Number(f[iRa]);
    const dec = Number(f[iDec]);
    if (!Number.isFinite(raHours) || !Number.isFinite(dec)) {
      skippedUnusable++;
      continue;
    }

    const star = {
      id,
      ra: round(raHours * 15, 4),
      dec: round(dec, 4),
      mag: round(mag, 2),
    };

    const name = f[iProper]?.trim();
    if (name) star.name = name;

    const bv = Number(f[iCi]);
    if (f[iCi]?.trim() && Number.isFinite(bv)) star.bv = round(bv, 2);

    const con = f[iCon]?.trim();
    if (con) star.constellation = con;

    stars.push(star);
  }

  // Brightest first; id as tiebreaker so reruns are byte-identical.
  stars.sort((a, b) => a.mag - b.mag || Number(a.id) - Number(b.id));

  const { kept, merged } = mergeClosePairs(stars);

  // Reorder keys into the Star interface's declared order.
  const ordered = kept.map((s) => {
    const out = { id: s.id };
    if (s.name !== undefined) out.name = s.name;
    out.ra = s.ra;
    out.dec = s.dec;
    out.mag = s.mag;
    if (s.bv !== undefined) out.bv = s.bv;
    if (s.constellation !== undefined) out.constellation = s.constellation;
    return out;
  });

  return { stars: ordered, skippedSun, skippedUnusable, merged };
}

/** Angular separation between two stars, in degrees. */
function angularSeparation(a, b) {
  const D = Math.PI / 180;
  const cosine =
    Math.sin(a.dec * D) * Math.sin(b.dec * D) +
    Math.cos(a.dec * D) * Math.cos(b.dec * D) * Math.cos((a.ra - b.ra) * D);
  return Math.acos(Math.min(1, Math.max(-1, cosine))) / D;
}

/**
 * Collapse pairs the naked eye cannot resolve, keeping the brighter member.
 *
 * HYG includes secondary components of multiple-star systems as separate rows —
 * Capella's companion, for instance, sits 0.003 degrees from Capella. Left in,
 * the "brightest N stars above the horizon" selection would spend two voices on
 * one visible point of light, which is both musically wasteful and a small lie
 * about what someone would actually see.
 *
 * `stars` must already be sorted brightest-first, so the greedy keep is
 * deterministic and always retains the brighter member of a pair.
 *
 * Buckets by whole degrees of declination (checking the three adjacent bands)
 * rather than by an RA grid, because RA cells converge near the poles — where
 * several of these pairs actually live.
 */
function mergeClosePairs(stars) {
  const radius = MERGE_ARCMIN / 60;
  const bands = new Map();
  const kept = [];
  const merged = [];

  for (const star of stars) {
    const band = Math.floor(star.dec);
    let tooClose = null;

    for (let d = -1; d <= 1 && !tooClose; d++) {
      for (const other of bands.get(band + d) ?? []) {
        if (angularSeparation(star, other) < radius) {
          tooClose = other;
          break;
        }
      }
    }

    if (tooClose) {
      merged.push({ dropped: star, keptWith: tooClose });
      continue;
    }

    kept.push(star);
    const bucket = bands.get(band);
    if (bucket) bucket.push(star);
    else bands.set(band, [star]);
  }

  return { kept, merged };
}

// ------------------------------------------------- constellation figures

/**
 * Turn d3-celestial's line GeoJSON into polylines of OUR star ids.
 *
 * WHY IDS AND NOT COORDINATES. The upstream file gives each vertex as a
 * position. Drawn from positions, the lines would land *near* the stars this
 * app renders rather than *on* them — HYG and d3-celestial round differently,
 * and the merge-close-pairs step has already moved a few of our stars to a
 * primary component. A line that misses its star by two pixels reads as a
 * mistake at any zoom. So every vertex is resolved to a catalogue star here, at
 * build time, and the renderer draws between the very positions it has just
 * drawn the stars at. Wrong-by-construction becomes impossible.
 *
 * THE SUBSET RULE. A polyline survives only if EVERY one of its vertices
 * resolves. A partial figure is worse than no figure: a stick man missing a leg
 * is not a fainter stick man, it is a wrong one. A constellation with no
 * surviving polyline is dropped entirely.
 *
 * The match radius is `MERGE_ARCMIN`, the same 1 arcminute this build already
 * uses to decide that two catalogue rows are one point of light — which is the
 * principled number here too, because that is exactly the ambiguity being
 * resolved. Measured on the pinned revision the fit is far tighter than it
 * needs to be: half the vertices land on their star exactly, 99% within 7
 * arcseconds, the worst at 31.
 */
function buildConstellationLines(geojson, stars) {
  const D = Math.PI / 180;
  const toVec = (raDeg, decDeg) => {
    const r = raDeg * D;
    const d = decDeg * D;
    return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
  };

  // A coarse 2-degree bucket grid. Brute force is 893 x 8,849 dot products,
  // which is fine, but this build is already slow enough to be run impatiently.
  const CELL = 2;
  const grid = new Map();
  const cellKey = (raDeg, decDeg) =>
    `${Math.floor((((raDeg % 360) + 360) % 360) / CELL)}:${Math.floor((decDeg + 90) / CELL)}`;
  for (const star of stars) {
    const key = cellKey(star.ra, star.dec);
    const bucket = grid.get(key);
    if (bucket) bucket.push(star);
    else grid.set(key, [star]);
  }

  const limitDeg = MERGE_ARCMIN / 60;
  const nearest = (raDeg, decDeg) => {
    const v = toVec(raDeg, decDeg);
    const cx = Math.floor((((raDeg % 360) + 360) % 360) / CELL);
    const cy = Math.floor((decDeg + 90) / CELL);
    const lanes = Math.ceil(360 / CELL);
    let best = null;
    let bestDeg = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${(((cx + dx) % lanes) + lanes) % lanes}:${cy + dy}`);
        if (!bucket) continue;
        for (const star of bucket) {
          const w = toVec(star.ra, star.dec);
          const dot = Math.min(1, Math.max(-1, v[0] * w[0] + v[1] * w[1] + v[2] * w[2]));
          const deg = Math.acos(dot) / D;
          if (deg < bestDeg) {
            bestDeg = deg;
            best = star;
          }
        }
      }
    }
    return bestDeg <= limitDeg ? { star: best, deg: bestDeg } : null;
  };

  const constellations = [];
  let vertices = 0;
  let resolved = 0;
  let worstArcsec = 0;
  const droppedPolylines = [];
  const droppedConstellations = [];

  for (const feature of geojson.features ?? []) {
    const id = feature.id;
    const geometry = feature.geometry ?? {};
    const source =
      geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : geometry.type === 'LineString'
          ? [geometry.coordinates]
          : [];

    const lines = [];
    for (const polyline of source) {
      const ids = [];
      let complete = true;
      for (const [lon, lat] of polyline) {
        // d3-celestial writes right ascension as a longitude in [-180, 180].
        const ra = ((lon % 360) + 360) % 360;
        vertices++;
        const hit = nearest(ra, lat);
        if (!hit) {
          complete = false;
          continue;
        }
        resolved++;
        if (hit.deg * 3600 > worstArcsec) worstArcsec = hit.deg * 3600;
        // Two vertices can land on the same star once close pairs are merged;
        // a zero-length segment is nothing to draw.
        if (ids[ids.length - 1] !== hit.star.id) ids.push(hit.star.id);
      }
      if (!complete) {
        droppedPolylines.push(id);
        continue;
      }
      if (ids.length >= 2) lines.push(ids);
    }

    if (lines.length === 0) droppedConstellations.push(id);
    else constellations.push({ id, lines });
  }

  constellations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    constellations,
    stats: {
      vertices,
      resolved,
      worstArcsec: Math.round(worstArcsec * 10) / 10,
      polylines: constellations.reduce((n, c) => n + c.lines.length, 0),
      droppedPolylines,
      droppedConstellations,
    },
  };
}

// ------------------------------------------------------------------ cities

function parseTimezoneOffsets(text) {
  const offsets = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('CountryCode')) continue;
    const f = line.split('\t');
    // CountryCode, TimeZoneId, GMT offset, DST offset, rawOffset
    const zone = f[1]?.trim();
    const rawOffset = Number(f[4]);
    if (!zone || !Number.isFinite(rawOffset)) continue;
    // rawOffset is in hours and can be fractional (5.5 for India, 5.75 for Nepal).
    offsets.set(zone, Math.round(rawOffset * 60));
  }
  return offsets;
}

function parseCountryNames(text) {
  const names = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split('\t');
    const iso = f[0]?.trim();
    const name = f[4]?.trim();
    if (iso && name) names.set(iso, name);
  }
  return names;
}

function buildCities(citiesText, tzOffsets, countryNames) {
  let all = [];
  let missingZone = 0;

  for (const line of citiesText.split('\n')) {
    if (!line.trim()) continue;
    const f = line.split('\t');
    const geonameId = Number(f[0]);
    const name = f[1]?.trim();
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    const iso = f[8]?.trim();
    const population = Number(f[14]) || 0;
    const zone = f[17]?.trim();

    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || !iso) continue;

    const tzOffsetMinutes = tzOffsets.get(zone);
    if (tzOffsetMinutes === undefined) {
      missingZone++;
      continue;
    }

    all.push({
      geonameId,
      name,
      country: countryNames.get(iso) ?? iso,
      iso,
      lat: round(lat, 4),
      lon: round(lon, 4),
      tzOffsetMinutes,
      population,
    });
  }

  const considered = all.length;

  // Deterministic ranking: biggest first, geonameId breaks ties.
  all.sort((a, b) => b.population - a.population || a.geonameId - b.geonameId);

  // Collapse same-name-same-country cities, keeping the most populous. GeoNames
  // genuinely holds several distinct Suzhous in China and two Gorakhpurs in
  // India; the bundled record has no admin-region field to tell them apart, so
  // two identical-looking rows in the picker would be worse than one. Anyone
  // needing the smaller one can enter latitude/longitude by hand.
  const seenNames = new Set();
  const duplicates = [];
  const unique = [];
  for (const city of all) {
    const key = `${city.name}|${city.iso}`;
    if (seenNames.has(key)) {
      duplicates.push(city);
      continue;
    }
    seenNames.add(key);
    unique.push(city);
  }
  all = unique;

  // Every country gets its largest city, so the picker is usable everywhere on
  // Earth and not just in the dense parts of it; then fill by global population.
  const chosen = new Map();
  const seenCountries = new Set();
  for (const city of all) {
    if (!seenCountries.has(city.iso)) {
      seenCountries.add(city.iso);
      chosen.set(city.geonameId, city);
    }
  }
  for (const city of all) {
    if (chosen.size >= CITY_TARGET) break;
    chosen.set(city.geonameId, city);
  }

  const cities = [...chosen.values()]
    .sort((a, b) => b.population - a.population || a.geonameId - b.geonameId)
    .map((c) => ({
      name: c.name,
      country: c.country,
      lat: c.lat,
      lon: c.lon,
      tzOffsetMinutes: c.tzOffsetMinutes,
    }));

  return {
    cities,
    countryCount: seenCountries.size,
    considered,
    missingZone,
    duplicatesDropped: duplicates.length,
  };
}

// -------------------------------------------------------------- attribution

function writeAttribution(facts) {
  const md = `# Data sources & attribution

<!-- GENERATED by scripts/build-data.mjs — do not edit by hand.
     Re-run \`npm run build:data\` to regenerate, and the access date below
     updates with it. This file exists so the honesty claim is never stale. -->

All three bundled datasets are free and openly licensed, and **all three
require attribution**. None is public domain — see the licences below.

**Accessed: ${facts.accessDate}**

---

## Stars — HYG Database v3.8

- **Source:** ${SOURCES.stars.home}
- **File:** \`${SOURCES.stars.url}\`
- **SHA-256 of the downloaded file:** \`${facts.starsSha}\`
- **Licence:** [${SOURCES.stars.licence}](${SOURCES.stars.licenceUrl}) — Attribution-**ShareAlike**
- **Compiled by:** David Nash / Astronomy Nexus, from the Hipparcos, Yale Bright
  Star, and Gliese catalogues.

### Transforms applied to produce \`stars.hyg.subset.json\`

The result is **${facts.starCount.toLocaleString('en-US')}** stars, from ${facts.sourceRowCount.toLocaleString('en-US')} catalogue rows, after these steps:

1. Kept only stars with apparent magnitude **≤ ${MAG_LIMIT}** (the naked-eye limit)
   — ${(facts.starCount + facts.mergedCount).toLocaleString('en-US')} rows survived.
2. **Converted right ascension from hours to degrees** (×15). HYG stores RA in
   hours 0–24; this project's \`Star\` model uses degrees throughout.
3. Dropped the **Sun** (HYG id 0, magnitude −26.7). It is not one of "the stars
   above you", and at that brightness it would swamp every other voice.
   (${facts.skippedSun} row${facts.skippedSun === 1 ? '' : 's'} removed.)
4. **Merged close pairs the naked eye cannot resolve** — where two catalogue
   rows sit within **${MERGE_ARCMIN} arcminute** of each other, only the brighter is kept
   (**${facts.mergedCount}** rows dropped). HYG lists secondary components of multiple-star
   systems as separate stars${
     facts.mergedExample?.keptWith?.name
       ? ` — ${facts.mergedExample.keptWith.name}'s companion, for example, sits just ` +
         `${(angularSeparation(facts.mergedExample.dropped, facts.mergedExample.keptWith) * 3600).toFixed(1)} arcseconds away`
       : ''
   }. Left in, one visible point of light
   would claim two musical voices. 1 arcminute is roughly the resolving power of
   the unaided eye and sits far below real naked-eye doubles — Mizar and Alcor,
   at 11.8 arcminutes, both survive.
5. Kept only the fields the engine uses: \`id\`, \`name\` (HYG \`proper\`),
   \`ra\`, \`dec\`, \`mag\`, \`bv\` (HYG \`ci\`), \`constellation\` (HYG \`con\`).
   Absent optional fields are omitted rather than nulled.
6. Rounded RA/Dec to 4 decimal places (~0.36 arcsecond) and magnitude/B–V to 2.
   Far finer than this project's stated accuracy limits.
7. Sorted brightest-first, with \`id\` as tiebreaker, so regeneration is
   byte-identical.

**Coordinates are J2000.** Precession is not applied — see \`docs/SPEC.md\` for
the full list of stated astronomical simplifications.

---

## Cities — GeoNames \`cities15000\`

- **Source:** ${SOURCES.cities.home}
- **Files:** \`${SOURCES.cities.url}\`, \`${SOURCES.timezones.url}\`, \`${SOURCES.countries.url}\`
- **SHA-256 of \`cities15000.zip\`:** \`${facts.citiesSha}\`
- **Licence:** [${SOURCES.cities.licence}](${SOURCES.cities.licenceUrl}) — Attribution

### Transforms applied to produce \`cities.json\`

1. Started from \`cities15000.txt\` (every city over 15,000 people):
   **${facts.considered.toLocaleString('en-US')}** usable rows.
2. **Collapsed same-name-same-country duplicates**, keeping the most populous
   (**${facts.duplicatesDropped.toLocaleString('en-US')}** dropped). GeoNames holds several distinct Suzhous in China and
   two Gorakhpurs in India; the bundled record carries no admin-region field to
   tell them apart, so two identical-looking rows in the picker would be worse
   than one. The manual latitude/longitude entry covers the smaller ones.
3. Selected **${facts.cityCount.toLocaleString('en-US')}** cities — the largest city of every one of the
   **${facts.countryCount}** countries present, then the most populous remaining cities
   worldwide until the target was reached. Every country on the list is
   reachable; a manual latitude/longitude entry covers everywhere else.
4. **Resolved a fixed UTC offset** for each city by joining its IANA timezone
   name against GeoNames \`timeZones.txt\` and taking \`rawOffset\` (hours →
   minutes; fractional zones like India's +5:30 and Nepal's +5:45 are preserved).
5. Replaced the ISO country code with the full country name from
   \`countryInfo.txt\`, for a readable picker.
6. Kept only \`name\`, \`country\`, \`lat\`, \`lon\`, \`tzOffsetMinutes\`; rounded
   coordinates to 4 decimal places (~11 m).
7. Sorted by population descending with the GeoNames id as tiebreaker, then the
   population field was dropped — it ranks the list but is not used at runtime.

> **Honest limitation — no daylight saving.** \`tzOffsetMinutes\` is each city's
> *standard* offset. Historical DST is not modelled, so a birth moment inside a
> DST period is offset by up to an hour, which moves the sky by up to ~15° of
> rotation. Adding a full IANA history would mean a large dependency; the UI
> states the limitation instead of hiding it.

---

## Constellation figures — d3-celestial (Western skyculture)

- **Source:** ${SOURCES.constellationLines.home}
- **File:** \`data/constellations.lines.json\`, pinned at commit
  \`${SOURCES.constellationLines.commit}\`
- **SHA-256 of the downloaded file:** \`${facts.linesSha}\`
- **Licence:** [${SOURCES.constellationLines.licence}](${SOURCES.constellationLines.licenceUrl})
- **${SOURCES.constellationLines.copyright}.** All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### ONLY the Western set is used, and that is a licence decision

d3-celestial also ships Chinese skyculture line files. **Those are not used
here.** They derive from Stellarium and are GPL-licensed, which would reach this
whole bundle; the Western \`constellations.lines.json\` is BSD-3-Clause, which
this project can ship with the notice above. If a future slice wants other
skycultures — and it should, because the sky is not only European — they need a
separately-licensed source, not this repository's other files.

### Transforms applied to produce \`constellations.lines.json\`

**${facts.constellationCount}** constellations and
**${facts.lineStats.polylines}** polylines, from
**${facts.lineStats.vertices}** source vertices:

1. Read right ascension back from the GeoJSON longitude convention
   (\`[-180, 180]\` → \`[0, 360)\` degrees).
2. **Resolved every vertex to a star in \`stars.hyg.subset.json\`**, within
   ${MERGE_ARCMIN} arcminute — the same radius this build uses to decide two
   catalogue rows are one point of light. **${facts.lineStats.resolved}** of
   ${facts.lineStats.vertices} resolved; the worst fit is
   ${facts.lineStats.worstArcsec} arcseconds. Storing star ids rather than
   coordinates is what makes a line land *on* the star the app draws instead of
   near it.
3. Dropped any polyline with an unresolvable vertex${
    facts.lineStats.droppedPolylines.length === 0 ? ' — none were' : ''
  }, and any
   constellation left with no polylines${
     facts.lineStats.droppedConstellations.length === 0 ? ' — none were' : ''
   }. A partial figure is not a
   fainter figure, it is a wrong one.
4. Collapsed consecutive vertices resolving to the same star (close pairs the
   star build had already merged).
5. Sorted by constellation id, so regeneration is byte-identical.

**Coordinates are J2000**, matching the star catalogue.

---

## What this means for reuse

The application **code** is MIT (see \`LICENSE\`). The **bundled data** is not:

- Redistributing \`stars.hyg.subset.json\` (a derivative of HYG) carries the
  **ShareAlike** obligation — share it under CC BY-SA, with attribution.
- Redistributing \`cities.json\` requires **attribution** to GeoNames.
- Redistributing \`constellations.lines.json\` requires the BSD-3-Clause notice
  above, reproduced in full.

Keeping this file alongside the data satisfies all three.
`;
  writeFileSync(join(OUT, 'ATTRIBUTION.md'), md);
}

// -------------------------------------------------------------------- main

async function main() {
  mkdirSync(OUT, { recursive: true });

  log('Cosmophony · build-data');
  log(FRESH ? '(--fresh: re-downloading sources)' : '');

  log('\nStars — HYG v3.8');
  const starsGz = await download(SOURCES.stars);
  const starsSha = sha256(starsGz);
  const csvText = gunzipSync(starsGz).toString('utf8');
  const sourceRowCount = csvText.split('\n').filter((l) => l.trim()).length - 1;
  const { stars, skippedSun, skippedUnusable, merged } = buildStars(csvText);
  writeJsonLines(join(OUT, 'stars.hyg.subset.json'), stars);
  log(`  ${sourceRowCount.toLocaleString('en-US')} catalogue rows`);
  log(`  ${stars.length.toLocaleString('en-US')} stars at mag <= ${MAG_LIMIT}` +
      ` (dropped the Sun; ${skippedUnusable} unusable)`);
  log(`  ${merged.length} close pairs merged (closer than ${MERGE_ARCMIN}' — one point of light)`);
  log(`  brightest: ${stars[0].name ?? stars[0].id} at mag ${stars[0].mag}`);

  log('\nCities — GeoNames cities15000');
  const citiesZip = await download(SOURCES.cities);
  const citiesSha = sha256(citiesZip);
  const tzText = (await download(SOURCES.timezones)).toString('utf8');
  const countryText = (await download(SOURCES.countries)).toString('utf8');

  const citiesText = unzipEntry(citiesZip, 'cities15000.txt').toString('utf8');
  const tzOffsets = parseTimezoneOffsets(tzText);
  const countryNames = parseCountryNames(countryText);
  const { cities, countryCount, considered, missingZone, duplicatesDropped } = buildCities(
    citiesText,
    tzOffsets,
    countryNames,
  );
  writeJsonLines(join(OUT, 'cities.json'), cities);
  log(`  ${considered.toLocaleString('en-US')} usable source rows` +
      (missingZone ? ` (${missingZone} skipped: unknown timezone)` : ''));
  log(`  ${duplicatesDropped.toLocaleString('en-US')} same-name-same-country duplicates collapsed`);
  log(`  ${cities.length.toLocaleString('en-US')} cities bundled across ${countryCount} countries`);
  log(`  largest: ${cities[0].name}, ${cities[0].country}`);

  log('\nConstellation figures — d3-celestial (Western skyculture)');
  const linesBuf = await download(SOURCES.constellationLines);
  const linesSha = sha256(linesBuf);
  const { constellations, stats } = buildConstellationLines(
    JSON.parse(linesBuf.toString('utf8')),
    stars,
  );
  writeFileSync(
    join(OUT, 'constellations.lines.json'),
    `${JSON.stringify(
      {
        _source: {
          home: SOURCES.constellationLines.home,
          commit: SOURCES.constellationLines.commit,
          licence: SOURCES.constellationLines.licence,
          copyright: SOURCES.constellationLines.copyright,
          note: 'Western skyculture only. The Chinese files in that repository derive from Stellarium and are GPL; they are deliberately not used.',
        },
        constellations,
      },
      null,
      0,
    )}\n`,
  );
  log(`  ${stats.resolved}/${stats.vertices} vertices resolved to catalogue stars` +
      ` (worst ${stats.worstArcsec}", limit ${MERGE_ARCMIN * 60}")`);
  log(`  ${constellations.length} constellations, ${stats.polylines} polylines`);
  if (stats.droppedPolylines.length) {
    log(`  ${stats.droppedPolylines.length} polylines dropped (a vertex had no star): ` +
        `${[...new Set(stats.droppedPolylines)].join(', ')}`);
  }
  if (stats.droppedConstellations.length) {
    log(`  dropped entirely: ${stats.droppedConstellations.join(', ')}`);
  }

  const accessDate = new Date().toISOString().slice(0, 10);
  writeAttribution({
    accessDate,
    starsSha,
    citiesSha,
    linesSha,
    lineStats: stats,
    constellationCount: constellations.length,
    starCount: stars.length,
    sourceRowCount,
    skippedSun,
    mergedCount: merged.length,
    mergedExample: merged.find((m) => m.keptWith.name) ?? merged[0],
    cityCount: cities.length,
    countryCount,
    considered,
    duplicatesDropped,
  });

  log(`\nWrote public/data/{stars.hyg.subset.json, cities.json, constellations.lines.json, ATTRIBUTION.md}`);
  log(`Access date recorded: ${accessDate}`);
}

main().catch((error) => {
  process.stderr.write(`\nbuild-data failed: ${error.message}\n`);
  process.exit(1);
});
