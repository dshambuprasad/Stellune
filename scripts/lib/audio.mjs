/**
 * Slice B0 — shared offline audio primitives (Node only, no browser, no Tone).
 *
 * Used by `fetch-samples.mjs` (trim/encode) and `render-score.mjs` (the fast
 * renderer). Everything here works on plain `Float32Array` mono buffers at a
 * fixed sample rate; stereo only appears at the very end, in the mixer.
 *
 * Decoding is delegated to `ffmpeg`, which is the one external dependency of
 * the offline tools (it is NOT a dependency of the shipped app). We decode to
 * raw f32le so there is no parsing ambiguity, and cache the PCM so repeat
 * renders cost nothing.
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

/** Fail loudly and early rather than halfway through a render. */
export function requireFfmpeg() {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `ffmpeg not found (tried "${FFMPEG}"). Install it (brew install ffmpeg) ` +
        `or set FFMPEG=/path/to/ffmpeg. The offline tools need it to decode ` +
        `the bundled ogg/mp3 samples; the shipped app does not.`,
    );
  }
}

/** Decode any audio file to mono Float32 PCM at `sampleRate`. */
export async function decodeMono(file, sampleRate) {
  const { stdout } = await execFileAsync(
    FFMPEG,
    [
      '-v', 'error',
      '-i', file,
      '-map', 'a:0',
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 'f32le',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 1 << 30 },
  );
  return new Float32Array(
    stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength),
  );
}

/**
 * Decode with an on-disk PCM cache keyed by (file contents, sample rate).
 * The first render of a fresh clone pays the ffmpeg cost; every later one is
 * a straight file read.
 */
export async function decodeMonoCached(file, sampleRate, cacheDir) {
  const stat = fs.statSync(file);
  const key = createHash('sha256')
    .update(`${path.resolve(file)}:${stat.size}:${stat.mtimeMs}:${sampleRate}`)
    .digest('hex')
    .slice(0, 24);
  const cached = path.join(cacheDir, `${key}.f32`);
  if (fs.existsSync(cached)) {
    const buf = fs.readFileSync(cached);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  const pcm = await decodeMono(file, sampleRate);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  return pcm;
}

/** Encode interleaved stereo Float32 to a 16-bit PCM WAV file. */
export function writeWavStereo(file, left, right, sampleRate) {
  const frames = left.length;
  const dataBytes = frames * 2 * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(2, 22); // channels
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2 * 2, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(dataBytes, 40);

  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of [left, right]) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      // int16 reaches -32768 but only +32767.
      out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), off);
      off += 2;
    }
  }
  fs.writeFileSync(file, out);
}

/** Peak amplitude of a buffer (linear, 0..1+). */
export function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

/** RMS of a buffer, in dBFS. Returns -Infinity for pure silence. */
export function rmsDbfs(buf, from = 0, to = buf.length) {
  let sum = 0;
  const n = Math.max(0, to - from);
  if (n === 0) return -Infinity;
  for (let i = from; i < to; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / n);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export const dbToGain = (db) => 10 ** (db / 20);

/** Index of the first sample exceeding `threshold` — the note's true onset. */
export function findOnset(buf, threshold = 0.004) {
  for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > threshold) return i;
  return 0;
}

/**
 * Estimate the fundamental of a pitched sample, in Hz, by autocorrelation over
 * the sustain portion. Used only where the upstream file is not pitch-named;
 * the measured value is written into the built manifest so it can be audited.
 */
export function detectFundamental(buf, sampleRate, minHz = 55, maxHz = 1200) {
  const onset = findOnset(buf);
  // Skip the strike transient; measure where the tone has settled.
  const start = Math.min(buf.length - 1, onset + Math.round(sampleRate * 0.08));
  const window = Math.min(buf.length - start, Math.round(sampleRate * 0.4));
  if (window < sampleRate / minHz * 2) return null;

  const x = buf.subarray(start, start + window);
  // Remove DC so the correlation is not dominated by offset.
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length;

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  let bestLag = -1;
  let bestScore = 0;
  let energy0 = 0;
  for (let i = 0; i < x.length; i++) energy0 += (x[i] - mean) ** 2;
  if (energy0 === 0) return null;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let energy = 0;
    const n = x.length - lag;
    for (let i = 0; i < n; i++) {
      const a = x[i] - mean;
      const b = x[i + lag] - mean;
      corr += a * b;
      energy += b * b;
    }
    // Normalised so long lags are not penalised for covering fewer samples.
    const score = energy > 0 ? corr / Math.sqrt(energy * energy0) : 0;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestScore < 0.2) return null;
  return sampleRate / bestLag;
}

/**
 * Estimate the pitch of an INHARMONIC idiophone (bells, gongs) by finding the
 * loudest partial in a plausible band. Autocorrelation is the wrong tool here:
 * a bell's partials are not integer multiples, so the correlator happily locks
 * onto a difference tone an octave or two below anything actually audible
 * (measured: it called a bell whose strongest partial is 1103 Hz "C#3").
 *
 * A Goertzel probe on a log-spaced grid is plenty — we only need the note, and
 * the result is recorded in the manifest so it can be checked by ear.
 */
export function detectStrikeTone(buf, sampleRate, minHz = 200, maxHz = 2100, cents = 15) {
  const onset = findOnset(buf);
  const start = Math.min(buf.length - 1, onset + Math.round(sampleRate * 0.05));
  const window = Math.min(buf.length - start, Math.round(sampleRate * 0.3));
  if (window < 1024) return null;
  const x = buf.subarray(start, start + window);

  let bestHz = null;
  let bestMag = 0;
  const step = 2 ** (cents / 1200);
  for (let f = minHz; f < maxHz; f *= step) {
    const w = (2 * Math.PI * f) / sampleRate;
    const cosW = Math.cos(w);
    const coeff = 2 * cosW;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < x.length; i++) {
      const s0 = x[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const mag = Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / x.length;
    if (mag > bestMag) {
      bestMag = mag;
      bestHz = f;
    }
  }
  return bestMag > 0 ? bestHz : null;
}

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
