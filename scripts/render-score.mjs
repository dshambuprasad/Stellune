#!/usr/bin/env node
/**
 * Slice B0 — THE FAST RENDERER.
 *
 * Reads an exported score JSON (the `docs/a3-score.json` format) plus the
 * bundled samples, and prints a finished stereo WAV. Node only: no browser, no
 * Web Audio, no Tone. A 60-second audition takes seconds instead of the
 * 30-minute real-time browser bake that has been gating every ear review — and
 * it is the same code path Phase 5's share export will grow out of.
 *
 *   node scripts/render-score.mjs --lens aurora --seconds 60 --out docs/b0-aurora.wav
 *   node scripts/render-score.mjs --lens ground --section endless --stems
 *
 * THE MIX LAW (BUILD_LOG 2026-08-07) is implemented literally: stems are
 * measured, then trimmed to the ratified steady-state targets. Because the
 * trims are calibrated on one window and printed on another, the checker's
 * assertions are still real measurements, not a tautology — see
 * `scripts/check-mix-law.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHash } from 'node:crypto';

import { execFileSync } from 'node:child_process';

import { FFMPEG, requireFfmpeg, writeWavStereo, rmsDbfs, peak, dbToGain } from './lib/audio.mjs';
import { OfflineSampler } from './lib/sampler.mjs';
import { reverbChannel, pingPongDelay, panGains, highpass, limitStereo } from './lib/fx.mjs';
import {
  STEM_TARGETS_DBFS,
  ROLE_SHAPING,
  WEATHER_OCTAVE_SHIFT,
  MASTER,
} from './lib/mixlaw.mjs';
import { buildSchedule } from './lib/schedule.mjs';
import {
  applyEqLane,
  glueCompress,
  integratedLufs,
  lufsTrimDb,
  bandLevelDb,
  limitTransients,
} from './lib/mastering.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SAMPLE_RATE = 44100;
const ROLES = ['ground', 'chord', 'figuration', 'lead', 'weather'];

/** How much of each role goes to the shared space. Motion in front, vastness behind. */
const SEND = {
  ground: { reverb: 0.22, delay: 0.0 },
  chord: { reverb: 0.34, delay: 0.05 },
  figuration: { reverb: 0.16, delay: 0.18 },
  lead: { reverb: 0.3, delay: 0.22 },
  weather: { reverb: 0.5, delay: 0.1 },
};

function parseArgs(argv) {
  const out = {
    score: 'docs/a3-score.json',
    section: 'birth',
    lens: 'aurora',
    from: 0,
    seconds: 60,
    out: null,
    stems: false,
    calibrateFrom: null,
    calibrateSeconds: null,
    json: null,
    noCache: false,
    mp3: false,
    masterTrimDb: null,
  };
  for (const arg of argv) {
    const m = /^--([a-zA-Z0-9-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`unexpected argument: ${arg}`);
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in out)) throw new Error(`unknown flag --${m[1]}`);
    if (typeof out[key] === 'boolean') out[key] = m[2] === undefined ? true : m[2] !== 'false';
    else if (
      typeof out[key] === 'number' ||
      key === 'calibrateSeconds' ||
      key === 'calibrateFrom' ||
      key === 'masterTrimDb'
    )
      out[key] = Number(m[2]);
    else out[key] = m[2];
  }
  return out;
}

/**
 * Give legacy scores the register hint their events were exported without.
 *
 * Weather now carries `registerHint: +12` from the mapping layer, so the
 * separation travels with the score and no renderer has to remember it. But
 * `docs/a3-score.json` and `docs/a4-score.json` were printed before that field
 * existed, and reading them through the new path would silently put weather
 * back in unison with ground — the exact defect the hint was introduced to
 * kill. So an event without a hint gets the one the renderer used to apply, and
 * an event WITH a hint is left alone: the score wins wherever it has an opinion.
 */
export function withRegisterHints(events) {
  return events.map((event) =>
    event.role === 'weather' && event.registerHint === undefined
      ? { ...event, registerHint: WEATHER_OCTAVE_SHIFT }
      : event,
  );
}

/** Pull the event list + nominal length out of either score section shape. */
function readSection(score, name) {
  const section = score[name];
  if (!section) {
    throw new Error(`score has no section "${name}" — have ${Object.keys(score).join(', ')}`);
  }
  const events = section.window?.events ?? section.events;
  if (!Array.isArray(events)) throw new Error(`section "${name}" has no events array`);
  const seconds = section.sessionSeconds ?? section.seconds ?? section.window?.toSeconds ?? 0;
  return { events: withRegisterHints(events), seconds };
}

/**
 * Count, per role, the maximum number of voices sounding at once — the divisor
 * for the mix law's concurrency normalisation. Measured over the whole section
 * so a chord's density does not jump between windows of the same render.
 */
function concurrencyByRole(events) {
  const out = {};
  for (const role of ROLES) {
    const inRole = events.filter((e) => e.role === role);
    let max = 1;
    const edges = new Set();
    for (const e of inRole) {
      edges.add(e.startSeconds);
      edges.add(e.startSeconds + e.durationSeconds);
    }
    for (const t of edges) {
      const n = inRole.filter((e) => e.startSeconds <= t && e.startSeconds + e.durationSeconds > t).length;
      if (n > max) max = n;
    }
    out[role] = max;
  }
  return out;
}

/**
 * THE STEADY STATE, defined once so the law is measured the same way every time.
 *
 * A session is deliberately not uniform: it opens with one star alone and ends
 * by thinning back to that same star (MUSICAL_VISION §4). Averaging those in
 * would let the opening gesture set the faders for the whole piece. So the
 * calibration window is the section with its opening bloom and closing return
 * trimmed off — what the BUILD_LOG means by "steady state".
 */
export function steadyStateWindow(sectionSeconds) {
  const opening = Math.min(90, sectionSeconds * 0.15);
  const closing = Math.min(60, sectionSeconds * 0.1);
  const from = Math.round(opening);
  const seconds = Math.max(30, Math.round(sectionSeconds - opening - closing));
  return { from, seconds };
}

/**
 * Render one window into per-role stereo stems (dry voices + that role's own
 * share of the shared space). Returns raw, untrimmed stems.
 */
async function renderStems({ sampler, events, lens, fromSeconds, seconds, concurrency }) {
  const sr = SAMPLE_RATE;
  const frames = Math.round(seconds * sr);
  const stems = {};
  /** Per-frame count of voices sounding in each role — the live divisor. */
  const active = {};
  for (const role of ROLES) {
    stems[role] = [new Float32Array(frames), new Float32Array(frames)];
    active[role] = new Float32Array(frames);
  }

  const shading = sampler.lenses.shading;
  let voiceCount = 0;
  const substitutions = new Map();

  // THE SCHEDULE IS NOT DERIVED HERE. `scripts/lib/schedule.mjs` decides which
  // instrument voices which note, at what pitch, at what velocity — and the live
  // Tone graph imports the SAME function. Two implementations that agree today
  // diverge eventually; one implementation cannot. That includes the register
  // hint, so the unison guard now travels with the score instead of living in
  // this file.
  // No options are passed. The mix law's velocity shaping and the lens's own
  // shading are the module's defaults, so there is no knob for this renderer and
  // the live graph to set differently — the failure mode a parity test could
  // only report after the fact.
  const schedule = buildSchedule(events, sampler.lenses, sampler.manifest, lens);

  for (const sv of schedule) {
    const start = sv.startSeconds - fromSeconds;
    const end = start + sv.durationSeconds;
    // Keep voices that overlap the window at all — a chord that began ten
    // minutes ago is still sounding, and dropping it would change the harmony.
    if (end < -3 || start > seconds) continue;
    const role = sv.role;

    const entry = sampler.manifest.instruments[sv.instrument];
    const sample = entry.samples.find((s) => s.midi === sv.sampleMidi);
    if (!sample) throw new Error(`schedule names a sample the manifest lacks: ${sv.instrument}/${sv.sampleMidi}`);
    if (sv.instrument !== sampler.lens(lens).roles[role][0].instrument) {
      const key = `${role}:${sv.instrument}`;
      substitutions.set(key, (substitutions.get(key) ?? 0) + 1);
    }

    const voice = {
      instrument: sv.instrument,
      sample,
      shiftSemitones: sv.midi - sv.sampleMidi,
      rate: sv.rate,
      kind: sv.kind,
      loop: entry.loop,
      attackSeconds: sv.attackSeconds,
      gainDb: sv.gainDb,
    };
    // The schedule has already applied the mix law's velocity shaping and the
    // B–V tilt, so what reaches the sampler is a note with its level and its
    // colour decided; `velocityCompress: 1` says "do not shape this twice".
    const shaped = {
      midi: sv.midi,
      amplitude: sv.velocity,
      durationSeconds: sv.durationSeconds,
      envelope: sv.envelope,
      twinkle: sv.twinkle,
    };

    // Only compute the frames that land in the window. A chord voice that has
    // been sustaining since minute two costs sixty seconds, not ten minutes.
    const offset = Math.round(start * sr);
    const total = sampler.voiceFrames(shaped, voice).frames;
    const fromFrame = Math.max(0, -offset);
    const toFrame = Math.min(total, frames - offset);
    if (toFrame <= fromFrame) continue;

    const { buffer } = sampler.render(
      shaped,
      voice,
      { velocityCompress: 1, tiltDb: sv.tiltDb, hingeHz: shading.hingeHz },
      fromFrame,
      toFrame,
    );
    voiceCount++;

    const [gl, gr] = panGains(sv.pan);
    const [L, R] = stems[role];
    const base = offset + fromFrame;
    const count = active[role];
    for (let i = 0; i < buffer.length; i++) {
      const s = buffer[i];
      L[base + i] += s * gl;
      R[base + i] += s * gr;
      count[base + i] += 1;
    }
  }

  // ── the mix law's concurrency normalisation ──────────────────────────────
  // Divide by sqrt(N) where N is the number of voices sounding AT THAT MOMENT,
  // not the section's maximum. The A3 birth session grows from a dozen chord
  // voices to thirty as the sky fills; a fixed divisor would leave the opening
  // over-attenuated and the climax 6 dB hot — which is how the bed swallowed
  // the piece the first time. The divisor is slewed over ~2 s so voices entering
  // and leaving glide rather than step.
  const slew = Math.exp(-1 / (2.0 * sr));
  for (const role of ROLES) {
    if (!ROLE_SHAPING[role].concurrencyNormalise) continue;
    const count = active[role];
    const [L, R] = stems[role];
    let smoothed = Math.max(1, count[0]);
    for (let i = 0; i < frames; i++) {
      const n = Math.max(1, count[i]);
      smoothed = n + (smoothed - n) * slew;
      const g = 1 / Math.sqrt(smoothed);
      L[i] *= g;
      R[i] *= g;
    }
  }

  // ── THE MASTERING LAW's EQ lanes ─────────────────────────────────────────
  // Applied to the dry stem, BEFORE the sends: the carve is a mix decision
  // about where a role lives, and the reverb tail should inherit the carved
  // sound rather than smearing the uncarved one back over the top of it.
  //
  // The glue is NOT applied here. Its threshold is an absolute level, and at
  // this point the stem has not yet been trimmed onto the mix law's target —
  // the first attempt compressed a figuration stem sitting 12 dB below where it
  // would end up, so the compressor never engaged and the law was satisfied on
  // paper by a device that was switched off. Glue happens after the fader, in
  // `render()`, which is also where the live graph has it.
  const lensDefinition = sampler.lens(lens);
  for (const role of ROLES) applyEqLane(stems[role], sr, lensDefinition.eq?.[role]);

  // Per-role space, then the 38 Hz highpass — applied per stem so that what we
  // measure is exactly what gets summed.
  for (const role of ROLES) {
    const [L, R] = stems[role];
    const send = SEND[role];
    if (send.delay > 0) {
      const [dl, dr] = pingPongDelay(L, R, sr, { timeSeconds: 0.42, feedback: 0.28 });
      for (let i = 0; i < frames; i++) {
        L[i] += dl[i] * send.delay;
        R[i] += dr[i] * send.delay;
      }
    }
    if (send.reverb > 0) {
      const wl = reverbChannel(L, sr, { decay: 0.84, dampHz: 2400, spread: 0 });
      const wr = reverbChannel(R, sr, { decay: 0.84, dampHz: 2400, spread: 0.9 });
      for (let i = 0; i < frames; i++) {
        L[i] += wl[i] * send.reverb;
        R[i] += wr[i] * send.reverb;
      }
    }
    highpass(L, sr, MASTER.highpassHz);
    highpass(R, sr, MASTER.highpassHz);
  }

  return { stems, frames, voiceCount, substitutions };
}

/**
 * RMS of a stereo stem over the middle of the window (skip edges/fades).
 *
 * `gateDbfs` measures only the frames where the stem is actually sounding.
 * Ungated is the right measure for the law's absolute targets — silence is part
 * of the piece, and the ratified numbers were taken that way. But for a SPARSE
 * role it answers the wrong question over a short window: the lead stem drops
 * 9 dB between a minute holding one phrase and a minute holding eight, purely
 * from how much silence is in the average. When the question is "is this role
 * still at the right level", gate it.
 */
export function measureStem([L, R], { skipFraction = 0.1, gateDbfs = null } = {}) {
  const from = Math.floor(L.length * skipFraction);
  const to = Math.ceil(L.length * (1 - skipFraction));
  if (gateDbfs == null) {
    const a = rmsDbfs(L, from, to);
    const b = rmsDbfs(R, from, to);
    if (a === -Infinity && b === -Infinity) return -Infinity;
    // Sum the two channels' power, then express as one level.
    return 10 * Math.log10((10 ** (a / 10) + 10 ** (b / 10)) / 2);
  }

  const floor = 10 ** (gateDbfs / 20);
  let sum = 0;
  let n = 0;
  for (let i = from; i < to; i++) {
    const power = (L[i] * L[i] + R[i] * R[i]) / 2;
    if (Math.sqrt(power) < floor) continue;
    sum += power;
    n++;
  }
  if (n === 0) return -Infinity;
  return 10 * Math.log10(sum / n);
}

/**
 * The mix law's fader move: measure each stem, then trim it to its ratified
 * steady-state target. One scalar per role — every internal dynamic, swell and
 * silence the engine composed survives untouched.
 */
export function trimsForTargets(stems) {
  const trims = {};
  for (const role of ROLES) {
    const measured = measureStem(stems[role]);
    trims[role] = measured === -Infinity ? 0 : STEM_TARGETS_DBFS[role] - measured;
  }
  return trims;
}

export async function render(options) {
  requireFfmpeg();
  const opts = { ...options };
  const scorePath = path.resolve(ROOT, opts.score);
  const score = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
  const { events, seconds: sectionSeconds } = readSection(score, opts.section);

  const sampler = new OfflineSampler(
    path.join(ROOT, 'public'),
    path.join(HERE, '.cache', 'pcm'),
    SAMPLE_RATE,
  );
  sampler.validateLens(opts.lens);
  await sampler.preload(opts.lens);

  const concurrency = concurrencyByRole(events);

  // ── the faders ───────────────────────────────────────────────────────────
  // Calibrated once per (score, section, lens) over the steady-state window,
  // then locked. Calibrating on the whole steady state rather than on whatever
  // 60 seconds we happen to be printing is what makes the numbers stable — and
  // it is what lets the checker measure a window the calibrator never saw.
  const steady = steadyStateWindow(sectionSeconds);
  const calFrom = opts.calibrateFrom ?? steady.from;
  const calSeconds = opts.calibrateSeconds ?? steady.seconds;

  const scoreHash = createHash('sha256')
    .update(fs.readFileSync(scorePath))
    .digest('hex')
    .slice(0, 12);
  // The trims depend on the samples too — a re-encode that changes an
  // instrument's level must not be served stale faders.
  const configHash = createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, 'public', 'samples', 'lenses.json')))
    .update(fs.readFileSync(path.join(ROOT, 'public', 'samples', 'manifest.json')))
    .digest('hex')
    .slice(0, 12);
  const cacheKey = `${scoreHash}:${configHash}:${opts.section}:${opts.lens}:${calFrom}:${calSeconds}`;
  const cachePath = path.join(HERE, '.cache', 'mix-trims.json');

  let trims = null;
  let calibrationMeasured = null;
  if (!opts.noCache && fs.existsSync(cachePath)) {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cache[cacheKey]) {
      trims = cache[cacheKey].trims;
      calibrationMeasured = cache[cacheKey].measured;
    }
  }
  if (!trims) {
    const calibration = await renderStems({
      sampler,
      events,
      lens: opts.lens,
      fromSeconds: calFrom,
      seconds: Math.min(calSeconds, Math.max(1, sectionSeconds - calFrom)),
      concurrency,
    });
    trims = trimsForTargets(calibration.stems);
    // Verify the move landed: re-measure the calibration stems through the
    // faders we just computed. This is the "exactly" in the mix law.
    calibrationMeasured = {};
    for (const role of ROLES) {
      const g = dbToGain(trims[role]);
      const [L, R] = calibration.stems[role];
      for (let i = 0; i < L.length; i++) {
        L[i] *= g;
        R[i] *= g;
      }
      calibrationMeasured[role] = measureStem(calibration.stems[role]);
    }
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
    cache[cacheKey] = { trims, measured: calibrationMeasured, concurrency };
    fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  }

  // ── print the window actually asked for, through those locked faders ─────
  const printed = await renderStems({
    sampler,
    events,
    lens: opts.lens,
    fromSeconds: opts.from,
    seconds: opts.seconds,
    concurrency,
  });

  const { stems, frames } = printed;
  const master = [new Float32Array(frames), new Float32Array(frames)];
  const measured = {};
  const measuredRaw = {};
  const glueConfig = sampler.lenses.mastering?.figurationGlue;
  const limiterLaw = sampler.lenses.mastering?.limiter;
  const stemLimiting = {};
  let glueDb = 0;
  for (const role of ROLES) {
    measuredRaw[role] = measureStem(stems[role]);
    const g = dbToGain(trims[role]);
    const [L, R] = stems[role];
    for (let i = 0; i < frames; i++) {
      L[i] *= g;
      R[i] *= g;
    }
    // Glue on FIGURATION ONLY, after the fader so its threshold means what it
    // says, and before the sum so what gets measured is what gets printed. The
    // macro arc is the composition — nothing else on this bus is compressed.
    if (role === 'figuration' && glueConfig) {
      glueDb = glueCompress(stems[role], SAMPLE_RATE, glueConfig);
    }
    // THE RATIFIED AMENDMENT: transient limiting on the stems that carry
    // transients, and on no others. `zeroEngagementStems` is not a rule this
    // loop obeys — it is a list of the stems that never get a limiter at all,
    // so the bed's zero engagement is a property of the graph rather than a
    // number to be checked and hoped for.
    if (limiterLaw && !(limiterLaw.zeroEngagementStems ?? []).includes(role)) {
      const result = limitTransients(stems[role], SAMPLE_RATE, limiterLaw);
      stemLimiting[role] = result;
    } else {
      stemLimiting[role] = { worstDb: 0, engagedFraction: 0 };
    }
    for (let i = 0; i < frames; i++) {
      master[0][i] += L[i];
      master[1][i] += R[i];
    }
    measured[role] = measureStem(stems[role]);
  }

  const rawPeak = Math.max(peak(master[0]), peak(master[1]));
  const rawPeakDbfs = rawPeak > 0 ? 20 * Math.log10(rawPeak) : -Infinity;
  const rawLufs = integratedLufs(master, SAMPLE_RATE);

  // ── the master fader ────────────────────────────────────────────────────
  // The stems are ON the law — measured at the stem bus, which is where the law
  // is stated and where check-mix-law.mjs reads them. Obeyed exactly, those
  // targets power-sum to a master around −15 dBFS RMS, and on transient-rich
  // material that lands peaks above full scale. So the master gets one honest
  // fader move down to the ceiling, exactly as a mix bus would: relative
  // dynamics untouched, nothing squashed, and the amount is reported.
  //
  // The limiter behind it is then a safety net, not a mixing tool. When it is
  // doing real work, something upstream is wrong — which is why the checker
  // fails on how BUSY it is rather than on peak alone.
  // An explicit trim lets a whole audition set share one fader, so five clips
  // of the same score can be A/B'd without the quietest-peaking lens being
  // flattered and the peakiest punished.
  //
  // SLICE B1 — THE MASTERING LAW replaces the peak move with a LOUDNESS move.
  // Peak normalisation rewards crest factor rather than level: measured on the
  // A3 birth score the five lenses' stem buses sit within 1 dB of each other
  // and yet peak-normalising printed them 9 dB apart, which says more about
  // transients than about the music. The fader now lands the mix on its LUFS
  // target, and a peak guard is applied ON TOP so a loud-but-spiky window
  // cannot ask for more headroom than exists.
  const lufsTarget =
    (sampler.lenses.mastering?.lufsTargets ?? {})[opts.section === 'birth' ? 'birthSky' : 'tonight'] ??
    -18;
  const loudnessTrimDb = lufsTrimDb(lufsTarget, rawLufs);
  const peakCeilingTrimDb = Number.isFinite(rawPeakDbfs)
    ? MASTER.limiterCeilingDbfs - rawPeakDbfs
    : 0;
  // SLICE B1.1 — the master fader is now the LOUDNESS fader, full stop. The
  // peak guard used to outrank it and that is what left three lenses up to
  // 8.9 dB under target; with transients limited at the stems, the peaks that
  // forced the guard no longer arrive here. `peakCeilingTrimDb` is still
  // measured and reported so a regression shows up as a number rather than as
  // a surprise.
  const masterTrimDb =
    opts.masterTrimDb != null && Number.isFinite(opts.masterTrimDb)
      ? opts.masterTrimDb
      : loudnessTrimDb;
  if (masterTrimDb !== 0) {
    const g = dbToGain(masterTrimDb);
    for (let i = 0; i < frames; i++) {
      master[0][i] *= g;
      master[1][i] *= g;
    }
  }
  const limiting = limitStereo(master[0], master[1], SAMPLE_RATE, MASTER.limiterCeilingDbfs);
  const masterPeak = Math.max(peak(master[0]), peak(master[1]));
  const masterPeakDbfs = masterPeak > 0 ? 20 * Math.log10(masterPeak) : -Infinity;
  const masterLufs = integratedLufs(master, SAMPLE_RATE);

  // What the EQ lanes claim, MEASURED IN THE AUDIO.
  //
  // The first version of this asked "how much of a pad's energy sits in the
  // motion band, relative to its own level", and it was the wrong question: a
  // violin section genuinely has most of its energy at 700–5000 Hz, so the
  // number said "muddy" about a mix that was fine and would have said the same
  // however deep the carve went.
  //
  // The claim the lanes actually make is comparative — IN THE BAND WHERE THE
  // FIGURATION SINGS, THE FIGURATION IS IN FRONT — so that is what gets
  // measured: each stem's level inside the motion band, and how far figuration
  // leads each pad there.
  const overlap = sampler.lenses.mastering?.spectralOverlap;
  const motionBandDb = {};
  const motionLeadDb = {};
  if (overlap) {
    for (const role of ROLES) {
      motionBandDb[role] = bandLevelDb(stems[role], SAMPLE_RATE, overlap.figurationBandHz);
    }
    for (const pad of ['ground', 'chord']) {
      motionLeadDb[pad] = motionBandDb.figuration - motionBandDb[pad];
    }
  }

  return {
    sampler,
    score: scorePath,
    section: opts.section,
    lens: opts.lens,
    from: opts.from,
    seconds: opts.seconds,
    sectionSeconds,
    calibratedFrom: calFrom,
    calibrateSeconds: calSeconds,
    calibrationMeasured,
    concurrency,
    trims,
    measured,
    measuredRaw,
    stems,
    master,
    frames,
    rawPeakDbfs,
    rawLufs,
    lufsTarget,
    masterTrimDb,
    loudnessTrimDb,
    peakCeilingTrimDb,
    limitedDb: limiting.maxDb,
    limiterBusyFraction: limiting.busyFraction,
    masterPeakDbfs,
    masterLufs,
    glueDb,
    stemLimiting,
    motionBandDb,
    motionLeadDb,
    voiceCount: printed.voiceCount,
    substitutions: Object.fromEntries(printed.substitutions),
  };
}

/**
 * Write what the renderer MEASURED where the live app can read it.
 *
 * The mix law is stated as measured stem levels. This renderer can satisfy that
 * directly — render, measure, trim. A live graph cannot: it has not played the
 * music yet, and metering the bus to chase a target is a compressor wearing a
 * disguise, which would flatten the very macro arc Slice A4 exists to shape.
 *
 * So the measurement is written down and the live graph reads it. One
 * measurement, two consumers — the same arrangement `schedule.mjs` makes for
 * the notes. Merged rather than overwritten, so calibrating one lens does not
 * silently un-calibrate the other four.
 */
export function writeCalibration(result) {
  const file = path.join(ROOT, 'public', 'samples', 'calibration.json');
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { lenses: {} };
  existing.generatedBy = 'scripts/render-score.mjs';
  existing._doc = [
    'MEASURED, not authored. `render-score.mjs` renders each stem, reads its',
    'steady-state level, and records the trim that lands it on THE MIX LAW.',
    'The live graph (src/engine/audio/sampledStream.ts) applies these as static',
    'faders, because live audio cannot measure what it has not yet played.',
    'Regenerate with `npm run render -- --lens <id>`.',
  ];
  existing.lenses = existing.lenses ?? {};
  existing.lenses[result.lens] = {
    stemTrimDb: result.trims,
    // Unity-master loudness: what the mix arrives at BEFORE the master fader,
    // which is the number the live graph needs to work out its own fader.
    measuredLufs: Number.isFinite(result.rawLufs) ? Number(result.rawLufs.toFixed(2)) : -18,
    measuredOn: `${path.relative(ROOT, result.score)} · ${result.section}`,
  };
  fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
  return file;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const r = await render(opts);
  const outPath = path.resolve(
    ROOT,
    opts.out ?? `docs/b0-${opts.lens}-${opts.section}-${opts.seconds}s.wav`,
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeWavStereo(outPath, r.master[0], r.master[1], SAMPLE_RATE);

  if (opts.stems) {
    for (const role of ROLES) {
      const p = outPath.replace(/\.wav$/, `.${role}.wav`);
      writeWavStereo(p, r.stems[role][0], r.stems[role][1], SAMPLE_RATE);
    }
  }

  // Audition clips get committed and listened to on a phone, so they go in as
  // mp3 — a 60-second stereo WAV is 10 MB and this repo already carries a dozen.
  let mp3Path = null;
  if (opts.mp3) {
    mp3Path = outPath.replace(/\.wav$/, '.mp3');
    execFileSync(
      FFMPEG,
      ['-v', 'error', '-y', '-i', outPath, '-c:a', 'libmp3lame', '-q:a', '2', mp3Path],
      { stdio: 'inherit' },
    );
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n${path.relative(ROOT, mp3Path ?? outPath)}  ·  lens=${r.lens}  section=${r.section}`,
  );
  console.log(
    `${opts.seconds}s printed from t=${r.from}s · ${r.voiceCount} voices · rendered in ${elapsed}s ` +
      `(${(opts.seconds / Number(elapsed)).toFixed(0)}x real time)`,
  );
  console.log(
    `faders calibrated on the steady state, t=${r.calibratedFrom}–` +
      `${r.calibratedFrom + r.calibrateSeconds}s of ${r.sectionSeconds}s`,
  );
  console.log('\n  role         target    trim   steady-state   this clip   voices');
  for (const role of ROLES) {
    const steady = r.calibrationMeasured?.[role];
    console.log(
      `  ${role.padEnd(11)}${String(STEM_TARGETS_DBFS[role]).padStart(6)}   ` +
        `${r.trims[role] >= 0 ? '+' : ''}${r.trims[role].toFixed(1).padStart(5)}   ` +
        `${(steady == null ? '—' : steady.toFixed(1)).padStart(12)}   ` +
        `${r.measured[role].toFixed(1).padStart(9)}   ${String(r.concurrency[role]).padStart(6)}`,
    );
  }
  console.log(
    `\n  master ${r.masterLufs.toFixed(1)} LUFS (target ${r.lufsTarget}) · ` +
      `${r.masterPeakDbfs.toFixed(1)} dBFS peak · fader ${r.masterTrimDb.toFixed(1)} dB ` +
      `(loudness ${r.loudnessTrimDb.toFixed(1)}, peak guard ${r.peakCeilingTrimDb.toFixed(1)})`,
  );
  console.log(
    `  figuration glue ${r.glueDb.toFixed(2)} dB worst · ` +
      `limiter active ${(r.limiterBusyFraction * 100).toFixed(2)}% (worst ${r.limitedDb.toFixed(1)} dB)`,
  );
  if (Object.keys(r.motionBandDb).length) {
    const levels = ROLES.map((role) => `${role} ${r.motionBandDb[role].toFixed(1)}`).join(' · ');
    console.log(`  in the motion band (dBFS): ${levels}`);
    console.log(
      `  figuration leads ground by ${r.motionLeadDb.ground.toFixed(1)} dB, ` +
        `chord by ${r.motionLeadDb.chord.toFixed(1)} dB there`,
    );
  }
  console.log(`  calibration written to ${path.relative(ROOT, writeCalibration(r))}`);
  if (Object.keys(r.substitutions).length) {
    console.log(`  fallback voicings: ${JSON.stringify(r.substitutions)}`);
  }

  if (opts.json) {
    fs.writeFileSync(
      path.resolve(ROOT, opts.json),
      `${JSON.stringify(
        {
          lens: r.lens,
          section: r.section,
          from: r.from,
          seconds: r.seconds,
          calibratedFrom: r.calibratedFrom,
          calibrateSeconds: r.calibrateSeconds,
          targets: STEM_TARGETS_DBFS,
          steadyStateMeasured: r.calibrationMeasured,
          clipMeasured: r.measured,
          trims: r.trims,
          concurrency: r.concurrency,
          rawPeakDbfs: r.rawPeakDbfs,
          masterTrimDb: r.masterTrimDb,
          limitedDb: r.limitedDb,
          limiterBusyFraction: r.limiterBusyFraction,
          masterPeakDbfs: r.masterPeakDbfs,
          substitutions: r.substitutions,
        },
        null,
        2,
      )}\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\n${err.stack ?? err.message}`);
    process.exit(1);
  });
}
