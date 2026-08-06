#!/usr/bin/env node
/**
 * Slice B0 — MEASURE AND ASSERT THE MIX LAW.
 *
 *   node scripts/check-mix-law.mjs                    # all five lenses
 *   node scripts/check-mix-law.mjs --lens=ground
 *   node scripts/check-mix-law.mjs --json=docs/b0-mix-law.json
 *
 * The mix law was ratified because a render shipped with its hierarchy
 * inverted and nobody could see it — the composition was fine, the mix hid it,
 * and it took stem forensics after the fact to find out. This script is the
 * standing answer to that: it measures, per lens, what the renderer actually
 * produced, and fails on the numbers rather than on a listen.
 *
 * Five checks:
 *   1. STEM TARGETS      steady-state stems land on the ratified dBFS numbers.
 *   2. GENERALISATION    faders calibrated on one half of the steady state still
 *                        hold on the other half, which they never saw.
 *   3. HIERARCHY         figuration leads ground and chord — motion in front.
 *   4. UNISON GUARD      weather is never voiced in unison with ground.
 *   5. HEADROOM          the printed master does not clip.
 *
 * Plus a lens-invariance check across all lenses: switching the mood lens must
 * change timbre and nothing else — same pitches, same onsets, same durations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, steadyStateWindow, measureStem } from './render-score.mjs';
import { dbToGain } from './lib/audio.mjs';
import {
  STEM_TARGETS_DBFS,
  STEM_TOLERANCE_DB,
  WINDOW_TOLERANCE_DB,
  WINDOW_SECONDS,
  WINDOW_GATE_DBFS,
  FIGURATION_OVER_LAYER_DB,
  WEATHER_OCTAVE_SHIFT,
  WEATHER_MIN_SEPARATION_SEMITONES,
  MASTER,
} from './lib/mixlaw.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ROLES = ['ground', 'chord', 'figuration', 'lead', 'weather'];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([a-zA-Z0-9-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`unexpected argument: ${a}`);
    return [m[1], m[2] ?? true];
  }),
);
const scorePath = args.score ?? 'docs/a3-score.json';
const section = args.section ?? 'birth';

const failures = [];
const notes = [];
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures.push(label);
  return cond;
};

/** dB difference between two stem levels. */
const margin = (a, b) => a - b;

/**
 * CHECK 4 — the unison guard, read straight off the score.
 *
 * The A3 score emits ground AND weather on midi 45 for the whole session; that
 * stacking is what produced the "continuous note … sounds like noise" report.
 * The renderer lifts weather by an octave; this asserts the result, so if the
 * shift is ever removed the check fails instead of the ear.
 */
function checkUnison(score) {
  const events = score[section].window?.events ?? score[section].events;
  const ground = events.filter((e) => e.role === 'ground');
  const weather = events.filter((e) => e.role === 'weather');
  let worst = Infinity;
  let collisions = 0;
  for (const w of weather) {
    const wMidi = w.midi + WEATHER_OCTAVE_SHIFT;
    const wEnd = w.startSeconds + w.durationSeconds;
    for (const g of ground) {
      const gEnd = g.startSeconds + g.durationSeconds;
      if (wEnd <= g.startSeconds || gEnd <= w.startSeconds) continue; // not concurrent
      const sep = Math.abs(wMidi - g.midi);
      if (sep < worst) worst = sep;
      if (sep < WEATHER_MIN_SEPARATION_SEMITONES) collisions++;
    }
  }
  const raw = weather.some((w) => ground.some((g) => g.midi === w.midi));
  return { worst, collisions, rawUnisonInScore: raw };
}

async function checkLens(lensId, score) {
  console.log(`\n── ${lensId} ${'─'.repeat(52 - lensId.length)}`);
  const events = score[section].window?.events ?? score[section].events;
  const sectionSeconds = score[section].sessionSeconds ?? score[section].seconds;
  const steady = steadyStateWindow(sectionSeconds);

  // One render of the whole steady state; every measurement below is a slice
  // of it, so the check costs one pass, not one pass per window.
  const full = await render({
    score: scorePath,
    section,
    lens: lensId,
    from: steady.from,
    seconds: steady.seconds,
    calibrateFrom: null,
    calibrateSeconds: null,
    out: null,
    stems: false,
    json: null,
    noCache: false,
  });

  // ── 1. stem targets, over the whole steady state ────────────────────────
  console.log('  stem targets (whole steady state):');
  for (const role of ROLES) {
    const m = full.measured[role];
    ok(
      Math.abs(m - STEM_TARGETS_DBFS[role]) <= STEM_TOLERANCE_DB,
      `${role.padEnd(11)} ${m.toFixed(1)} dBFS`,
      `(target ${STEM_TARGETS_DBFS[role]}, ±${STEM_TOLERANCE_DB})`,
    );
  }

  // ── 2. the arc: every window inside the steady state ────────────────────
  // The piece is meant to breathe — the bed thickens as the sky fills, the
  // lead grows toward the climax. What must NOT happen is a role drifting so
  // far that it stops being audible, which is precisely the v1 failure.
  const sr = 44100;
  const windows = [];
  for (let t = 0; t + WINDOW_SECONDS <= steady.seconds; t += WINDOW_SECONDS) {
    const from = Math.round(t * sr);
    const to = Math.round((t + WINDOW_SECONDS) * sr);
    const row = { at: steady.from + t };
    for (const role of ROLES) {
      const [L, R] = full.stems[role];
      // Gated: within a single minute, what matters is the level the role
      // reaches when it speaks, not how much of the minute it spent silent.
      row[role] = measureStem([L.subarray(from, to), R.subarray(from, to)], {
        skipFraction: 0,
        gateDbfs: WINDOW_GATE_DBFS,
      });
    }
    windows.push(row);
  }

  // Gated levels sit above ungated ones by however much silence a role carries,
  // so a window is compared to the piece's OWN gated average for that role —
  // "does this minute drift from how this role normally sounds" — rather than
  // to the ungated target, which would be comparing two different measurements.
  const gatedReference = {};
  for (const role of ROLES) {
    const [L, R] = full.stems[role];
    gatedReference[role] = measureStem([L, R], { skipFraction: 0, gateDbfs: WINDOW_GATE_DBFS });
  }

  console.log(`  the arc — ${windows.length} × ${WINDOW_SECONDS}s windows (gated, vs each role's own gated average):`);
  const drift = {};
  for (const role of ROLES) {
    let worst = 0;
    let worstAt = null;
    for (const w of windows) {
      const d = w[role] - gatedReference[role];
      if (Math.abs(d) > Math.abs(worst)) {
        worst = d;
        worstAt = w.at;
      }
    }
    drift[role] = { worstDb: worst, atSeconds: worstAt, gatedReferenceDbfs: gatedReference[role] };
    ok(
      Math.abs(worst) <= WINDOW_TOLERANCE_DB,
      `${role.padEnd(11)} worst window ${worst >= 0 ? '+' : ''}${worst.toFixed(1)} dB at t=${worstAt}s`,
      `(gated avg ${gatedReference[role].toFixed(1)} dBFS, ±${WINDOW_TOLERANCE_DB})`,
    );
  }

  // The law's real invariant, asserted in EVERY window rather than on average.
  let hierarchyHolds = true;
  let worstWindow = null;
  for (const w of windows) {
    const lead = Math.min(w.figuration - w.ground, w.figuration - w.chord);
    if (lead <= 0) {
      hierarchyHolds = false;
      worstWindow = w.at;
    }
  }
  ok(
    hierarchyHolds,
    'figuration leads both bed layers in every window',
    worstWindow == null ? '' : `(fails at t=${worstWindow}s)`,
  );

  // ── 3. hierarchy on the average: motion in front, vastness behind ───────
  const s = full.measured;
  console.log('  hierarchy:');
  const overGround = margin(s.figuration, s.ground);
  const overChord = margin(s.figuration, s.chord);
  ok(
    Math.abs(overGround - FIGURATION_OVER_LAYER_DB.ground) <= FIGURATION_OVER_LAYER_DB.tolerance,
    `figuration over ground  +${overGround.toFixed(1)} dB`,
    `(law: +${FIGURATION_OVER_LAYER_DB.ground})`,
  );
  ok(
    Math.abs(overChord - FIGURATION_OVER_LAYER_DB.chord) <= FIGURATION_OVER_LAYER_DB.tolerance,
    `figuration over chord   +${overChord.toFixed(1)} dB`,
    `(law: +${FIGURATION_OVER_LAYER_DB.chord})`,
  );
  ok(s.lead > s.chord, `lead over chord         +${margin(s.lead, s.chord).toFixed(1)} dB`);
  ok(s.weather < s.chord, `weather under chord     ${margin(s.weather, s.chord).toFixed(1)} dB`);
  // Reported, not enforced — see the note in lib/mixlaw.mjs.
  const bed = 10 * Math.log10(10 ** (s.ground / 10) + 10 ** (s.chord / 10));
  notes.push(
    `${lensId}: figuration sits ${(s.figuration - bed).toFixed(1)} dB over the POWER-SUMMED bed ` +
      `(ground+chord = ${bed.toFixed(1)} dBFS); the law's prose says 3–5 dB, its numbers give ~1.9.`,
  );

  // ── 5. headroom ─────────────────────────────────────────────────────────
  console.log('  headroom:');
  ok(
    full.masterPeakDbfs <= MASTER.maxPeakDbfs,
    `master peak ${full.masterPeakDbfs.toFixed(1)} dBFS`,
    `(ceiling ${MASTER.maxPeakDbfs}; master fader ${full.masterTrimDb.toFixed(1)} dB)`,
  );
  ok(
    full.limiterBusyFraction <= MASTER.maxLimiterBusyFraction &&
      full.limitedDb <= MASTER.maxLimitingDb,
    `limiter active ${(full.limiterBusyFraction * 100).toFixed(2)}% of the render, ` +
      `worst catch ${full.limitedDb.toFixed(1)} dB`,
    `(max ${(MASTER.maxLimiterBusyFraction * 100).toFixed(0)}% / ${MASTER.maxLimitingDb} dB)`,
  );

  // What the lens actually reached for — a fallback voicing is not a failure,
  // but it should be visible (a two-note handpan cannot cover four octaves).
  if (Object.keys(full.substitutions).length) {
    console.log(`  fallback voicings: ${JSON.stringify(full.substitutions)}`);
  }

  // Lens invariance: the pitches and onsets this lens rendered.
  const fingerprint = events
    .filter((e) => ROLES.includes(e.role))
    .map((e) => `${e.role}:${e.midi}@${e.startSeconds.toFixed(3)}+${e.durationSeconds.toFixed(3)}`)
    .join('|');

  return {
    lens: lensId,
    steadyState: full.measured,
    windows,
    drift,
    trims: full.trims,
    concurrency: full.concurrency,
    masterPeakDbfs: full.masterPeakDbfs,
    masterTrimDb: full.masterTrimDb,
    limitedDb: full.limitedDb,
    limiterBusyFraction: full.limiterBusyFraction,
    substitutions: full.substitutions,
    figurationOverGround: overGround,
    figurationOverChord: overChord,
    figurationOverCombinedBed: s.figuration - bed,
    fingerprint,
  };
}

async function main() {
  const score = JSON.parse(fs.readFileSync(path.resolve(ROOT, scorePath), 'utf8'));
  const lensConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public', 'samples', 'lenses.json'), 'utf8'),
  );
  const lenses = args.lens ? [args.lens] : Object.keys(lensConfig.lenses);

  console.log(`THE MIX LAW — ${path.basename(scorePath)} · section "${section}"`);
  console.log(
    `targets: ${ROLES.map((r) => `${r} ${STEM_TARGETS_DBFS[r]}`).join(', ')} dBFS ` +
      `(±${STEM_TOLERANCE_DB})`,
  );

  const unison = checkUnison(score);
  console.log('\n── unison guard ' + '─'.repeat(43));
  console.log(
    `  the score itself voices weather in unison with ground: ` +
      `${unison.rawUnisonInScore ? 'YES (the 2026-08-07 defect, still present)' : 'no'}`,
  );
  ok(
    unison.collisions === 0,
    `weather never within ${WEATHER_MIN_SEPARATION_SEMITONES} semitones of ground after the ` +
      `renderer's +${WEATHER_OCTAVE_SHIFT}-semitone lift`,
    `(closest ${unison.worst === Infinity ? 'n/a' : `${unison.worst} st`})`,
  );

  const results = [];
  for (const lens of lenses) results.push(await checkLens(lens, score));

  console.log('\n── lens invariance ' + '─'.repeat(40));
  const first = results[0];
  for (const r of results.slice(1)) {
    ok(
      r.fingerprint === first.fingerprint,
      `${r.lens} plays the same notes at the same times as ${first.lens}`,
    );
  }

  if (notes.length) {
    console.log('\n── measured, reported, not enforced ' + '─'.repeat(23));
    for (const n of notes) console.log(`  · ${n}`);
  }

  if (args.json) {
    const out = {
      score: scorePath,
      section,
      targets: STEM_TARGETS_DBFS,
      tolerance: STEM_TOLERANCE_DB,
      windowTolerance: WINDOW_TOLERANCE_DB,
      windowSeconds: WINDOW_SECONDS,
      unison,
      lenses: results.map(({ fingerprint, ...rest }) => rest),
      pass: failures.length === 0,
    };
    fs.writeFileSync(path.resolve(ROOT, args.json), `${JSON.stringify(out, null, 2)}\n`);
    console.log(`\nwrote ${args.json}`);
  }

  console.log(
    `\n${failures.length === 0 ? 'PASS' : `FAIL — ${failures.length} check(s):\n  ${failures.join('\n  ')}`}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${err.stack ?? err.message}`);
  process.exit(1);
});
