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

Both bundled datasets are free and openly licensed, and **both require
attribution**. Neither is public domain — see the licences below.

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

## What this means for reuse

The application **code** is MIT (see \`LICENSE\`). The **bundled data** is not:

- Redistributing \`stars.hyg.subset.json\` (a derivative of HYG) carries the
  **ShareAlike** obligation — share it under CC BY-SA, with attribution.
- Redistributing \`cities.json\` requires **attribution** to GeoNames.

Keeping this file alongside the data satisfies both.
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

  const accessDate = new Date().toISOString().slice(0, 10);
  writeAttribution({
    accessDate,
    starsSha,
    citiesSha,
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

  log(`\nWrote public/data/{stars.hyg.subset.json, cities.json, ATTRIBUTION.md}`);
  log(`Access date recorded: ${accessDate}`);
}

main().catch((error) => {
  process.stderr.write(`\nbuild-data failed: ${error.message}\n`);
  process.exit(1);
});
