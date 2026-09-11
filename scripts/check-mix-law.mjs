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
 * Checks:
 *   1. STEM TARGETS      steady-state stems land on the ratified dBFS numbers.
 *   2. GENERALISATION    faders calibrated on one half of the steady state still
 *                        hold on the other half, which they never saw.
 *   3. HIERARCHY         figuration leads ground and chord — motion in front.
 *   4. UNISON GUARD      weather is never voiced in unison with ground.
 *   5. HEADROOM          the printed master peaks at or under −1.0 dBFS. Slice
 *                        B3, Ruling 1: structural, because the master fader is
 *                        min(loudness trim, peak-safe trim) and nothing limits
 *                        the master in either path.
 *
 * Slice B1 adds THE MASTERING LAW, which is the same idea applied to spectrum
 * and to loudness rather than to level:
 *   6. EQ LANES          declared per lens, and MEASURED: in the band where the
 *                        figuration sings, the figuration is in front.
 *   7. GLUE              figuration is compressed by no more than the law allows,
 *                        and nothing else is compressed at all.
 *   8. LOUDNESS          the master never exceeds its LUFS target, and lands on
 *                        it unless the peak ceiling bound it first. Since Ruling
 *                        1 the target is a TARGET: the per-lens spread is
 *                        published rather than hidden.
 *   9. LIMITER           engagement is zero. A limiter doing work is a mix that
 *                        is broken somewhere upstream.
 *
 * Plus a lens-invariance check across all lenses: switching the mood lens must
 * change timbre and nothing else — same pitches, same onsets, same durations.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SLICE B4, 2026-09-11 — THE MIX LAW IS CONDITIONAL ON DECLARED ROLES.
 *
 * The law was written when every lens had every role, and it asserts margins
 * BETWEEN stems: figuration over ground, figuration over chord, lead over chord,
 * weather under chord. A lens may now declare no bed at all (the Ground lens is
 * handpan notes, nothing under them), and those margins are then not failing —
 * they are NOT APPLICABLE, which is a different thing and must be printed as a
 * different thing.
 *
 * Two failure modes were available here and both are refused. A silent pass
 * (skip the check, print nothing) would let a bed vanish from a lens that is
 * supposed to have one and nobody would see it. A divide by a missing stem
 * (measure −∞ and subtract) would print "figuration leads ground by Infinity dB"
 * and pass. So every conditional check says out loud which stem is missing and
 * why it did not run, and the lens-invariance check compares only the roles two
 * lenses BOTH declare — while naming the ones they do not share.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, steadyStateWindow, measureStem, withRegisterHints } from './render-score.mjs';
import { integratedLufs } from './lib/mastering.mjs';
import { buildSchedule, declaredRoles, MAX_SHIFT_SEMITONES } from './lib/schedule.mjs';
import { dbToGain } from './lib/audio.mjs';
import {
  STEM_TARGETS_DBFS,
  STEM_TOLERANCE_DB,
  WINDOW_TOLERANCE_DB,
  WINDOW_TOLERANCE_BY_ROLE,
  windowToleranceFor,
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

let sampleManifest = null;
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
 * A check that only applies when the lens declares the stems it is about.
 *
 * Prints `⊘` and the reason when it does not apply, and counts as neither a pass
 * nor a failure. Never silent: "the bed is missing" is exactly the news this
 * script exists to carry.
 */
const okWhen = (roles, required, label, run) => {
  const missing = required.filter((role) => !roles.includes(role));
  if (missing.length > 0) {
    console.log(
      `  ⊘ ${label}  not applicable: lens declares no ${missing.join(' and no ')}`,
    );
    return null;
  }
  return run();
};

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

async function checkLens(lensId, score, lensConfig) {
  console.log(`\n── ${lensId} ${'─'.repeat(52 - lensId.length)}`);
  // WHAT THIS LENS IS MADE OF. Every loop and every margin below is scoped to
  // it; a role the lens does not declare has no stem to measure.
  const roles = declaredRoles(lensConfig, lensId);
  const absent = ROLES.filter((role) => !roles.includes(role));
  if (absent.length > 0) {
    console.log(`  declares ${roles.join(', ')} — no ${absent.join(', no ')}`);
  }
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
  for (const role of roles) {
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
    for (const role of roles) {
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
  for (const role of roles) {
    const [L, R] = full.stems[role];
    gatedReference[role] = measureStem([L, R], { skipFraction: 0, gateDbfs: WINDOW_GATE_DBFS });
  }

  console.log(`  the arc — ${windows.length} × ${WINDOW_SECONDS}s windows (gated, vs each role's own gated average):`);
  const drift = {};
  for (const role of roles) {
    let worst = 0;
    let worstAt = null;
    for (const w of windows) {
      const d = w[role] - gatedReference[role];
      if (Math.abs(d) > Math.abs(worst)) {
        worst = d;
        worstAt = w.at;
      }
    }
    // Slice B3, Ruling 2: the bound is per role, and only the chord's is wider.
    const bound = windowToleranceFor(role);
    drift[role] = {
      worstDb: worst,
      atSeconds: worstAt,
      gatedReferenceDbfs: gatedReference[role],
      boundDb: bound,
    };
    ok(
      Math.abs(worst) <= bound,
      `${role.padEnd(11)} worst window ${worst >= 0 ? '+' : ''}${worst.toFixed(1)} dB at t=${worstAt}s`,
      `(gated avg ${gatedReference[role].toFixed(1)} dBFS, ±${bound}` +
        (bound === WINDOW_TOLERANCE_DB ? ')' : ' — the chord carries the arc)'),
    );
  }

  // The law's real invariant, asserted in EVERY window rather than on average —
  // and only against the bed layers this lens actually has. A lens with no bed
  // has nothing for the figuration to lead, which is not the same as leading it.
  const beds = ['ground', 'chord'].filter((role) => roles.includes(role));
  if (beds.length === 0) {
    console.log(
      '  ⊘ figuration leads the bed in every window  ' +
        'not applicable: lens declares no ground and no chord',
    );
  } else {
    let hierarchyHolds = true;
    let worstWindow = null;
    for (const w of windows) {
      const lead = Math.min(...beds.map((bed) => w.figuration - w[bed]));
      if (lead <= 0) {
        hierarchyHolds = false;
        worstWindow = w.at;
      }
    }
    ok(
      hierarchyHolds,
      `figuration leads ${beds.join(' and ')} in every window`,
      worstWindow == null ? '' : `(fails at t=${worstWindow}s)`,
    );
  }

  // ── 3. hierarchy on the average: motion in front, vastness behind ───────
  const s = full.measured;
  console.log('  hierarchy:');
  // SLICE B4 — asserted only where both stems exist. `okWhen` prints why a check
  // did not run; it never passes one by skipping it.
  const overGround = roles.includes('ground') ? margin(s.figuration, s.ground) : null;
  const overChord = roles.includes('chord') ? margin(s.figuration, s.chord) : null;
  okWhen(roles, ['figuration', 'ground'], 'figuration over ground', () =>
    ok(
      Math.abs(overGround - FIGURATION_OVER_LAYER_DB.ground) <= FIGURATION_OVER_LAYER_DB.tolerance,
      `figuration over ground  +${overGround.toFixed(1)} dB`,
      `(law: +${FIGURATION_OVER_LAYER_DB.ground})`,
    ),
  );
  okWhen(roles, ['figuration', 'chord'], 'figuration over chord', () =>
    ok(
      Math.abs(overChord - FIGURATION_OVER_LAYER_DB.chord) <= FIGURATION_OVER_LAYER_DB.tolerance,
      `figuration over chord   +${overChord.toFixed(1)} dB`,
      `(law: +${FIGURATION_OVER_LAYER_DB.chord})`,
    ),
  );
  okWhen(roles, ['lead', 'chord'], 'lead over chord', () =>
    ok(s.lead > s.chord, `lead over chord         +${margin(s.lead, s.chord).toFixed(1)} dB`),
  );
  okWhen(roles, ['weather', 'chord'], 'weather under chord', () =>
    ok(s.weather < s.chord, `weather under chord     ${margin(s.weather, s.chord).toFixed(1)} dB`),
  );
  // Reported, not enforced — see the note in lib/mixlaw.mjs. A lens with no bed
  // has no combined bed to sit over, and says so rather than power-summing −∞.
  let figurationOverCombinedBed = null;
  if (beds.length > 0) {
    const bed = 10 * Math.log10(beds.reduce((sum, role) => sum + 10 ** (s[role] / 10), 0));
    figurationOverCombinedBed = s.figuration - bed;
    notes.push(
      `${lensId}: figuration sits ${figurationOverCombinedBed.toFixed(1)} dB over the ` +
        `POWER-SUMMED bed (${beds.join('+')} = ${bed.toFixed(1)} dBFS); the law's prose says ` +
        `3–5 dB, its numbers give ~1.9.`,
    );
  } else {
    notes.push(
      `${lensId}: no combined-bed margin — this lens declares no ground and no chord, so there ` +
        `is no bed for the figuration to sit over. The margin is not applicable, not zero.`,
    );
  }

  // ── 5. headroom ─────────────────────────────────────────────────────────
  //
  // SLICE B3, RULING 1 — STRUCTURAL, not a tolerance. The master fader is
  // `min(loudness trim, peak-safe trim to −1.0 dBFS)`, so a correct render lands
  // AT the ceiling or below it, never above, and there is no limiter anywhere to
  // rescue it. This is the check that was passing at −0.3 while embrace printed
  // +2.6 and pulse +2.96: the old bound was a tolerance around a peak the fader
  // was no longer aiming at. The epsilon is float error in one gain multiply and
  // nothing else.
  console.log('  headroom:');
  ok(
    full.masterPeakDbfs <= MASTER.maxPeakDbfs + MASTER.peakAssertEpsilonDb,
    `master peak ${full.masterPeakDbfs.toFixed(2)} dBFS`,
    `(ceiling ${MASTER.maxPeakDbfs}; master fader ${full.masterTrimDb.toFixed(1)} dB = ` +
      `min(loudness ${full.loudnessTrimDb.toFixed(1)}, peak-safe ${full.peakCeilingTrimDb.toFixed(1)}))`,
  );
  // SLICE B2: the master limiter is GONE from the renderer, because the live
  // graph has not had one since transient limiting moved to the stems. This is
  // now a structural assertion — there is nothing on the master to engage — and
  // it reads as zero because zero is a property of the graph, not a measurement
  // that happened to come out low. If a master limiter ever reappears in one
  // path and not the other, this fails and says which.
  ok(
    full.limiterBusyFraction === 0 && full.limitedDb === 0,
    `no master limiter — the peak above is unaided, as it is in the live graph`,
    `(engaged ${(full.limiterBusyFraction * 100).toFixed(2)}%, ` +
      `worst ${full.limitedDb.toFixed(1)} dB; both must be exactly 0)`,
  );

  // ── 6. THE MASTERING LAW — the EQ lanes, measured ───────────────────────
  // The lanes are declared in lenses.json; a declaration is not a claim about
  // the audio. What IS a claim is that the pads are carved where the moving
  // parts live, so that is what is measured: each stem's level inside the
  // motion band, and how far the figuration leads each pad there.
  console.log('  EQ lanes (measured in the audio):');
  const lane = lensConfig.lenses[lensId].eq;
  ok(Boolean(lane), `${lensId} declares per-role EQ lanes`);
  const overlap = lensConfig.mastering?.spectralOverlap;
  const motionLead = full.motionLeadDb ?? {};
  for (const pad of ['ground', 'chord']) {
    okWhen(roles, ['figuration', pad], `figuration leads ${pad} in the motion band`, () => {
      const measuredLead = motionLead[pad];
      return ok(
        Number.isFinite(measuredLead) && measuredLead >= (overlap?.minMotionLeadDb ?? 0),
        `figuration leads ${pad.padEnd(7)} by ${measuredLead?.toFixed(1)} dB in ` +
          `${overlap?.figurationBandHz?.[0]}–${overlap?.figurationBandHz?.[1]} Hz`,
        `(min +${overlap?.minMotionLeadDb ?? 0})`,
      );
    });
  }
  // The lanes must also SAY something. A lens with five empty objects would
  // satisfy the measurement above purely on the strength of the mix law's
  // levels, which is exactly the gap the mastering law was written to close.
  // A lens with no chord has no chord to carve, and the carve was only ever
  // about making room for motion in a pad that is no longer there.
  okWhen(roles, ['chord'], 'chord is carved where the motion sings', () => {
    const carve = lane?.chord?.dip;
    return ok(
      Boolean(carve) && carve.db < 0,
      `chord is carved where the motion sings`,
      carve ? `(${carve.db} dB at ${carve.hz} Hz, Q ${carve.q ?? 0.8})` : '(no dip declared)',
    );
  });

  // ── 7. glue: gentle, and on figuration alone ────────────────────────────
  const glueLaw = lensConfig.mastering?.figurationGlue;
  console.log('  glue:');
  ok(
    full.glueDb <= (glueLaw?.maxReductionDb ?? 2) + 0.01,
    `figuration glue worst reduction ${full.glueDb.toFixed(2)} dB`,
    `(max ${glueLaw?.maxReductionDb ?? 2})`,
  );
  notes.push(
    `${lensId}: glue reached ${full.glueDb.toFixed(2)} dB — ` +
      (full.glueDb < 0.05
        ? 'never engaged, so the threshold may be under the stem'
        : 'engaged and stayed inside the law'),
  );

  // ── 8. loudness ─────────────────────────────────────────────────────────
  // The master is normalised to LUFS, not to peak. Measuring it again here, on
  // the printed master rather than on the pre-fader sum, is what makes this an
  // assertion rather than a restatement of the fader the renderer chose.
  const lufsLaw = lensConfig.mastering?.lufsTargets ?? { birthSky: -18, tonight: -18, tolerance: 1 };
  const lufsTarget = section === 'birth' ? lufsLaw.birthSky : lufsLaw.tonight;
  const measuredLufs = integratedLufs(full.master, 44100);
  console.log('  loudness:');

  // THE TARGET IS A CEILING, AND THE PEAK GUARD OUTRANKS IT.
  //
  // The master fader takes the LOWER of the loudness trim and the trim that
  // keeps the peak under the ceiling, because the ratified limiter engagement
  // is zero — a limiter doing work means something upstream is wrong. On
  // material whose crest factor is larger than its headroom, those two rules
  // cannot both be satisfied at the target, and the peak one wins.
  //
  // So this fails on TOO LOUD, always. Too quiet fails only when the peak guard
  // was not the reason — anything else means the fader is simply wrong. When
  // the guard IS the reason, the shortfall is reported rather than passed in
  // silence, because an 8 dB spread between lenses is exactly what normalising
  // to loudness was introduced to remove.
  const peakBound = full.peakCeilingTrimDb < full.loudnessTrimDb;
  const off = measuredLufs - lufsTarget;
  ok(
    off <= lufsLaw.tolerance && (Math.abs(off) <= lufsLaw.tolerance || peakBound),
    `master ${measuredLufs.toFixed(1)} LUFS`,
    `(target ${lufsTarget}, ±${lufsLaw.tolerance}` +
      (peakBound ? `; peak-bound, ${(-off).toFixed(1)} dB under` : '') +
      ')',
  );
  if (peakBound && Math.abs(off) > lufsLaw.tolerance) {
    notes.push(
      `${lensId}: ${(-off).toFixed(1)} dB UNDER the LUFS target, and it is the peak ceiling that ` +
        `bound it — the stem bus peaked at ${full.rawPeakDbfs.toFixed(1)} dBFS against an RMS of ` +
        `about ${full.measured.figuration.toFixed(0)}. Ruling 1 (2026-09-04) says this is the ` +
        `right way round: −18 LUFS is a target, the ceiling is not. Buying the target back would ` +
        `take a master limiter, and the B1.1 amendment put limiting on transient-carrying stems ` +
        `on purpose.`,
    );
  }

  // ── 9. THE RATIFIED LIMITER AMENDMENT (2026-08-10) ──────────────────────
  // Transient limiting is permitted; squashing is not; and the sustained bed is
  // protected absolutely. The bed's zero is structural — ground and chord have
  // no limiter — so this asserts the structure held, which would catch someone
  // putting one back on the master.
  const limiterLaw = lensConfig.mastering?.limiter;
  if (limiterLaw) {
    console.log('  limiter (transient-only, per stem):');
    for (const role of roles) {
      const measured = full.stemLimiting?.[role] ?? { worstDb: 0, engagedFraction: 0 };
      const mustBeSilent = (limiterLaw.zeroEngagementStems ?? []).includes(role);
      if (mustBeSilent) {
        ok(
          measured.worstDb === 0 && measured.engagedFraction === 0,
          `${role.padEnd(11)} ZERO gain reduction (the bed is never limited)`,
          `(measured ${measured.worstDb.toFixed(2)} dB)`,
        );
      } else {
        ok(
          measured.worstDb <= limiterLaw.maxReductionDb + 0.01 &&
            measured.engagedFraction <= limiterLaw.maxEngagedFraction,
          `${role.padEnd(11)} worst ${measured.worstDb.toFixed(2)} dB, engaged ` +
            `${(measured.engagedFraction * 100).toFixed(3)}%`,
          `(max ${limiterLaw.maxReductionDb} dB / ` +
            `${(limiterLaw.maxEngagedFraction * 100).toFixed(0)}%)`,
        );
      }
    }
  }

  // ── 10. THE SHIFT CAP (Slice B1.1) ──────────────────────────────────────
  // The confirmed mechanism behind the live-capture artefacts. Asserted on the
  // schedule rather than on the audio, because it is a property of the voicing
  // decision and an audio measurement would only find it once it was audible.
  const schedule = buildSchedule(withRegisterHints(events), lensConfig, sampleManifest, lensId);
  const far = schedule.filter((v) => Math.abs(v.midi - v.sampleMidi) > MAX_SHIFT_SEMITONES);
  ok(
    far.length === 0,
    `every note is voiced within ±${MAX_SHIFT_SEMITONES} semitones of a recorded sample`,
    far.length === 0
      ? `(${schedule.length} notes)`
      : `(${far.length} of ${schedule.length} exceed it, worst ` +
        `${Math.max(...far.map((v) => Math.abs(v.midi - v.sampleMidi)))} st on ` +
        `${far[0].instrument})`,
  );

  // What the lens actually reached for — a fallback voicing is not a failure,
  // but it should be visible (a two-note handpan cannot cover four octaves).
  if (Object.keys(full.substitutions).length) {
    console.log(`  fallback voicings: ${JSON.stringify(full.substitutions)}`);
  }

  // LENS INVARIANCE, PER ROLE (Slice B4).
  //
  // "Switching lenses changes timbre and nothing else" was checked with one
  // string per lens, built from the score's events — which every lens sees
  // identically, so the check could not fail. Now that a lens may decline a
  // role, the interesting question is sharper AND actually testable: for every
  // role two lenses BOTH declare, do they schedule the same pitches at the same
  // times? So the fingerprint is built from the SCHEDULE, per role, and the
  // comparison below intersects two lenses' declared roles.
  const fingerprint = {};
  for (const role of roles) {
    fingerprint[role] = schedule
      .filter((v) => v.role === role)
      .map((v) => `${v.midi}@${v.startSeconds.toFixed(3)}+${v.durationSeconds.toFixed(3)}`)
      .join('|');
  }

  return {
    lens: lensId,
    roles,
    absentRoles: absent,
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
    figurationOverCombinedBed,
    motionBandDb: full.motionBandDb,
    stemLimiting: full.stemLimiting,
    farShifts: far.length,
    motionLeadDb: full.motionLeadDb,
    glueDb: full.glueDb,
    lufs: measuredLufs,
    lufsTarget,
    loudnessTrimDb: full.loudnessTrimDb,
    peakCeilingTrimDb: full.peakCeilingTrimDb,
    /** True when the −1.0 dBFS ceiling, not the LUFS target, set the fader. */
    peakBound,
    fingerprint,
  };
}

async function main() {
  const score = JSON.parse(fs.readFileSync(path.resolve(ROOT, scorePath), 'utf8'));
  const lensConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public', 'samples', 'lenses.json'), 'utf8'),
  );
  sampleManifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public', 'samples', 'manifest.json'), 'utf8'),
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
  for (const lens of lenses) results.push(await checkLens(lens, score, lensConfig));

  // ── THE LOUDNESS SPREAD (Slice B3, Ruling 1) ─────────────────────────────
  // −18 LUFS is a TARGET, not an invariant: when a lens's crest factor is wider
  // than its headroom the peak ceiling binds and that lens lands under target.
  // The honest response is to publish how far apart the five lenses end up —
  // an 8 dB spread is what normalising to loudness was introduced to remove, so
  // it is the number that says whether that is happening again.
  console.log('\n── the loudness spread ' + '─'.repeat(36));
  const loudest = Math.max(...results.map((r) => r.lufs));
  const quietest = Math.min(...results.map((r) => r.lufs));
  const spread = loudest - quietest;
  for (const r of results) {
    console.log(
      `  ${r.lens.padEnd(10)} ${r.lufs.toFixed(1).padStart(6)} LUFS · ` +
        `peak ${r.masterPeakDbfs.toFixed(2).padStart(6)} dBFS · ` +
        `fader ${r.masterTrimDb.toFixed(1).padStart(6)} dB` +
        (r.peakBound ? '  ← peak-bound' : ''),
    );
  }
  console.log(
    `  spread ${spread.toFixed(1)} dB (target ${results[0]?.lufsTarget}, ` +
      `${results.filter((r) => r.peakBound).length} of ${results.length} peak-bound)`,
  );
  notes.push(
    `per-lens loudness spread ${spread.toFixed(1)} dB — ${quietest.toFixed(1)} to ` +
      `${loudest.toFixed(1)} LUFS. Reported, not enforced: Ruling 1 made −18 a target and the ` +
      `−1.0 dBFS ceiling the invariant, so a peak-bound lens is allowed to sit under it.`,
  );

  console.log('\n── lens invariance ' + '─'.repeat(40));
  const first = results[0];
  for (const r of results.slice(1)) {
    // Only the roles both lenses declare. A lens that leaves a role out is not
    // playing different notes in it — it is not playing it, which is a lens
    // decision the owner ratified and not an invariance failure. What must still
    // hold, and is asserted here, is that where two lenses DO share a role they
    // put the same pitches at the same times.
    const shared = r.roles.filter((role) => first.roles.includes(role));
    const differing = shared.filter((role) => r.fingerprint[role] !== first.fingerprint[role]);
    const notShared = [...first.roles, ...r.roles].filter(
      (role) => !first.roles.includes(role) || !r.roles.includes(role),
    );
    ok(
      differing.length === 0,
      `${r.lens} plays the same notes at the same times as ${first.lens} in ${shared.join(', ')}`,
      differing.length > 0
        ? `(differs in ${differing.join(', ')})`
        : notShared.length > 0
          ? `(not compared: ${[...new Set(notShared)].join(', ')} — not declared by both)`
          : '',
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
      windowToleranceByRole: WINDOW_TOLERANCE_BY_ROLE,
      windowSeconds: WINDOW_SECONDS,
      master: {
        peakCeilingDbfs: MASTER.peakCeilingDbfs,
        maxPeakDbfs: MASTER.maxPeakDbfs,
      },
      loudnessSpreadDb: Number(
        (
          Math.max(...results.map((r) => r.lufs)) - Math.min(...results.map((r) => r.lufs))
        ).toFixed(2),
      ),
      unison,
      mastering: lensConfig.mastering,
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
