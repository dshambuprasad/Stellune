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

/** Pull the event list + nominal length out of either score section shape. */
function readSection(score, name) {
  const section = score[name];
  if (!section) {
    throw new Error(`score has no section "${name}" — have ${Object.keys(score).join(', ')}`);
  }
  const events = section.window?.events ?? section.events;
  if (!Array.isArray(events)) throw new Error(`section "${name}" has no events array`);
  const seconds = section.sessionSeconds ?? section.seconds ?? section.window?.toSeconds ?? 0;
  return { events, seconds };
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

  for (const event of events) {
    const start = event.startSeconds - fromSeconds;
    const end = start + event.durationSeconds;
    // Keep events that overlap the window at all — a chord that began ten
    // minutes ago is still sounding, and dropping it would change the harmony.
    if (end < -3 || start > seconds) continue;
    const role = event.role;
    if (!ROLES.includes(role)) continue;

    // THE UNISON GUARD. The A3 score puts ground and weather both on midi 45;
    // stacked, they are the "continuous note" and their beating is the "noise".
    // Until the mapping layer carries a register hint, the renderer lifts
    // weather an octave and voices it as a whisper.
    const midi = role === 'weather' ? event.midi + WEATHER_OCTAVE_SHIFT : event.midi;

    const voice = sampler.pick(lens, role, midi);
    if (voice.instrument !== sampler.lens(lens).roles[role][0].instrument) {
      const key = `${role}:${voice.instrument}`;
      substitutions.set(key, (substitutions.get(key) ?? 0) + 1);
    }

    const shaped = { ...event, midi };
    // Only compute the frames that land in the window. A chord voice that has
    // been sustaining since minute two costs sixty seconds, not ten minutes.
    const offset = Math.round(start * sr);
    const total = sampler.voiceFrames(shaped, voice).frames;
    const fromFrame = Math.max(0, -offset);
    const toFrame = Math.min(total, frames - offset);
    if (toFrame <= fromFrame) continue;

    const shaping = ROLE_SHAPING[role];
    const { buffer } = sampler.render(
      shaped,
      voice,
      {
        velocityCompress: shaping.velocityCompress,
        brightnessTiltDb: shading.tiltDb,
        neutralBrightness: shading.neutralBrightness,
        hingeHz: shading.hingeHz,
      },
      fromFrame,
      toFrame,
    );
    voiceCount++;

    const [gl, gr] = panGains(event.pan ?? 0);
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
  for (const role of ROLES) {
    measuredRaw[role] = measureStem(stems[role]);
    const g = dbToGain(trims[role]);
    const [L, R] = stems[role];
    for (let i = 0; i < frames; i++) {
      L[i] *= g;
      R[i] *= g;
      master[0][i] += L[i];
      master[1][i] += R[i];
    }
    measured[role] = measureStem(stems[role]);
  }

  const rawPeak = Math.max(peak(master[0]), peak(master[1]));
  const rawPeakDbfs = rawPeak > 0 ? 20 * Math.log10(rawPeak) : -Infinity;

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
  // flattered and the peakiest punished. Measured on the A3 birth score, the
  // five lenses' stem buses sit within 1 dB of each other; per-clip peak
  // normalisation alone would have printed them 9 dB apart, which says more
  // about crest factor than about the music.
  const masterTrimDb =
    opts.masterTrimDb != null && Number.isFinite(opts.masterTrimDb)
      ? opts.masterTrimDb
      : Number.isFinite(rawPeakDbfs)
        ? Math.min(0, MASTER.limiterCeilingDbfs - rawPeakDbfs)
        : 0;
  if (masterTrimDb < 0) {
    const g = dbToGain(masterTrimDb);
    for (let i = 0; i < frames; i++) {
      master[0][i] *= g;
      master[1][i] *= g;
    }
  }
  const limiting = limitStereo(master[0], master[1], SAMPLE_RATE, MASTER.limiterCeilingDbfs);
  const masterPeak = Math.max(peak(master[0]), peak(master[1]));
  const masterPeakDbfs = masterPeak > 0 ? 20 * Math.log10(masterPeak) : -Infinity;

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
    masterTrimDb,
    limitedDb: limiting.maxDb,
    limiterBusyFraction: limiting.busyFraction,
    masterPeakDbfs,
    voiceCount: printed.voiceCount,
    substitutions: Object.fromEntries(printed.substitutions),
  };
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
    `\n  master ${r.masterPeakDbfs.toFixed(1)} dBFS peak · stem bus summed to ` +
      `${r.rawPeakDbfs.toFixed(1)} · master fader ${r.masterTrimDb.toFixed(1)} dB · ` +
      `limiter active ${(r.limiterBusyFraction * 100).toFixed(2)}% (worst ${r.limitedDb.toFixed(1)} dB)`,
  );
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
