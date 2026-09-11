#!/usr/bin/env node
/**
 * Slice B1 — MEASURE THE MIX FOR THE LIVE APP.
 *
 *   node scripts/calibrate-mix.mjs
 *   node scripts/calibrate-mix.mjs --lens=aurora --score=docs/a4-score.json
 *
 * The mix law is stated as MEASURED steady-state stem levels. The offline
 * renderer can satisfy that directly — render, measure, trim. The live graph
 * cannot: it has not played the music yet, and metering its own bus to chase a
 * target is a compressor wearing a disguise, which would flatten the macro arc
 * that Slice A4 exists to shape.
 *
 * So the measurement is taken here, once per lens, and written to
 * `public/samples/calibration.json` where `sampledStream.ts` reads it. One
 * measurement, two consumers — the same arrangement `schedule.mjs` makes for
 * the notes.
 *
 * Measured on the STEADY STATE, not on an arbitrary window: a session opens
 * with one star alone and ends by thinning back to it, and letting the opening
 * gesture set the faders for the whole piece is how a mix ends up wrong in a
 * way nobody can point at.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, steadyStateWindow, writeCalibration } from './render-score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([a-zA-Z0-9-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`unexpected argument: ${a}`);
    return [m[1], m[2] ?? true];
  }),
);

const scorePath = args.score ?? 'docs/a3-score.json';
const section = args.section ?? 'birth';
/**
 * Long enough for the loudness gate to have something to work with and for the
 * chord bed to turn over, short enough that calibrating five lenses is a coffee
 * and not an afternoon.
 */
const SECONDS = Number(args.seconds ?? 90);

async function main() {
  const lensConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public', 'samples', 'lenses.json'), 'utf8'),
  );
  const lenses = args.lens ? [String(args.lens)] : Object.keys(lensConfig.lenses);

  const score = JSON.parse(fs.readFileSync(path.resolve(ROOT, scorePath), 'utf8'));
  const sectionSeconds = score[section].sessionSeconds ?? score[section].seconds;
  const steady = steadyStateWindow(sectionSeconds);

  console.log(`calibrating ${lenses.length} lens(es) on ${scorePath} · ${section}`);
  console.log(`steady state t=${steady.from}s, measuring ${SECONDS}s from there\n`);
  console.log('  lens        ground   chord   figur    lead  weather      LUFS');

  let file = null;
  for (const lens of lenses) {
    const result = await render({
      score: scorePath,
      section,
      lens,
      from: steady.from,
      seconds: Math.min(SECONDS, steady.seconds),
      calibrateFrom: null,
      calibrateSeconds: null,
      out: null,
      stems: false,
      json: null,
      noCache: false,
      mp3: false,
      masterTrimDb: null,
    });
    file = writeCalibration(result);
    const trims = result.trims;
    // SLICE B4: a lens declares the roles it is made of, and a role it does not
    // declare has no fader. Printed as "—" rather than as a number, because a
    // zero here would read as "unity trim" — a role playing at its raw level —
    // when the truth is that the role is not playing at all.
    console.log(
      `  ${lens.padEnd(10)}` +
        ['ground', 'chord', 'figuration', 'lead', 'weather']
          .map((r) =>
            trims[r] === undefined
              ? '—'.padStart(8)
              : `${trims[r] >= 0 ? '+' : ''}${trims[r].toFixed(1)}`.padStart(8),
          )
          .join('') +
        `${result.rawLufs.toFixed(1).padStart(10)}`,
    );
  }

  console.log(`\nwrote ${path.relative(ROOT, file)}`);
  console.log('the live graph reads these as static faders — see src/engine/audio/mixLaw.ts');
}

main().catch((err) => {
  console.error(`\n${err.stack ?? err.message}`);
  process.exit(1);
});
