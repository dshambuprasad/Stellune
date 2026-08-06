/**
 * Slice B0 — the OFFLINE SAMPLER: score events in, mono audio out.
 *
 * Deliberately free of Tone.js and Web Audio, so the fast renderer can run in
 * plain Node. The live app's `SamplerBank` (src/engine/audio/samplerBank.ts)
 * reads the SAME `lenses.json` + `manifest.json` and applies the same voicing
 * rules through Tone.Sampler, so what you hear in the browser and what the
 * renderer prints are the same instrument choices.
 */

import fs from 'node:fs';
import path from 'node:path';

import { decodeMonoCached } from './audio.mjs';

/** 4-point Hermite interpolation — cheap, and clean under the ±12 st shifts. */
function readInterpolated(pcm, pos) {
  const i = Math.floor(pos);
  const t = pos - i;
  const x0 = pcm[i - 1] ?? 0;
  const x1 = pcm[i] ?? 0;
  const x2 = pcm[i + 1] ?? 0;
  const x3 = pcm[i + 2] ?? 0;
  const c0 = x1;
  const c1 = 0.5 * (x2 - x0);
  const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
  const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

export class OfflineSampler {
  /**
   * @param {string} publicDir  path to `public/`
   * @param {string} cacheDir   where decoded PCM is cached
   * @param {number} sampleRate render rate
   */
  constructor(publicDir, cacheDir, sampleRate) {
    this.publicDir = publicDir;
    this.cacheDir = cacheDir;
    this.sampleRate = sampleRate;
    this.manifest = JSON.parse(
      fs.readFileSync(path.join(publicDir, 'samples', 'manifest.json'), 'utf8'),
    );
    this.lenses = JSON.parse(
      fs.readFileSync(path.join(publicDir, 'samples', 'lenses.json'), 'utf8'),
    );
    /** @type {Map<string, Float32Array>} */
    this.pcm = new Map();
  }

  lens(id) {
    const lens = this.lenses.lenses[id];
    if (!lens) {
      throw new Error(
        `unknown lens "${id}" — have ${Object.keys(this.lenses.lenses).join(', ')}`,
      );
    }
    return lens;
  }

  /**
   * Validate that every instrument a lens names actually exists in the built
   * sample set. A lens config that references a missing instrument should fail
   * at load, not halfway through a render.
   */
  validateLens(id) {
    const lens = this.lens(id);
    for (const [role, chain] of Object.entries(lens.roles)) {
      if (!chain.length) throw new Error(`lens ${id}: role ${role} has no instruments`);
      for (const link of chain) {
        const inst = this.manifest.instruments[link.instrument];
        if (!inst) {
          throw new Error(`lens ${id}, role ${role}: no such instrument "${link.instrument}"`);
        }
        if (!inst.samples.length) {
          throw new Error(`lens ${id}, role ${role}: instrument "${link.instrument}" has no samples`);
        }
      }
    }
  }

  /** Decode (and memoise) one sample file. */
  async load(relOgg) {
    if (this.pcm.has(relOgg)) return this.pcm.get(relOgg);
    const file = path.join(this.publicDir, 'samples', relOgg);
    const pcm = await decodeMonoCached(file, this.sampleRate, this.cacheDir);
    this.pcm.set(relOgg, pcm);
    return pcm;
  }

  /** Every sample file a lens can possibly need — decoded up front, once. */
  async preload(lensId) {
    const lens = this.lens(lensId);
    const ids = new Set();
    for (const chain of Object.values(lens.roles)) for (const l of chain) ids.add(l.instrument);
    for (const id of ids) {
      for (const s of this.manifest.instruments[id].samples) await this.load(s.ogg);
    }
    return ids;
  }

  /**
   * Choose the voice for (lens, role, midi).
   *
   * Walks the role's instrument chain and takes the first whose nearest sample
   * is within `maxShiftSemitones` — that is what keeps a two-note handpan from
   * being stretched across three octaves — falling through to the last link if
   * nothing fits. Pitch is always achieved by resampling, never by substituting
   * a different note: switching lenses must not change what note sounds.
   */
  pick(lensId, role, midi) {
    const chain = this.lens(lensId).roles[role];
    if (!chain) throw new Error(`lens ${lensId} has no role "${role}"`);
    let fallback = null;
    for (const link of chain) {
      const inst = this.manifest.instruments[link.instrument];
      let best = inst.samples[0];
      for (const s of inst.samples) {
        if (Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
      }
      const shift = midi - best.midi;
      const voice = {
        instrument: link.instrument,
        sample: best,
        shiftSemitones: shift,
        rate: 2 ** (shift / 12),
        kind: inst.kind,
        loop: inst.loop,
        attackSeconds: inst.attackSeconds,
        // The lens's voicing offset PLUS the instrument's loudness match, so a
        // role that falls through from one instrument to another does not
        // lurch in level mid-phrase.
        gainDb: (link.gainDb ?? 0) + (inst.levelDb ?? 0),
      };
      if (Math.abs(shift) <= (link.maxShiftSemitones ?? 12)) return voice;
      if (!fallback) fallback = voice;
      fallback = voice; // the last link is the catch-all
    }
    return fallback;
  }

  /**
   * How long this event sounds, in frames — its scored duration plus the ring
   * the instrument is entitled to. Needed before rendering so the caller can
   * work out which part of the note actually lands inside the print window.
   */
  voiceFrames(event, voice) {
    const sr = this.sampleRate;
    const pcm = this.pcm.get(voice.sample.ogg);
    const sustained = voice.kind === 'sustained' && voice.loop;
    const releaseSeconds = sustained ? 1.2 : 2.5;
    const seconds = sustained
      ? event.durationSeconds + releaseSeconds
      : Math.min(event.durationSeconds + releaseSeconds, pcm.length / voice.rate / sr);
    return { frames: Math.max(1, Math.round(seconds * sr)), releaseSeconds, sustained };
  }

  /**
   * Render part of one event to a mono buffer.
   *
   * `fromFrame`/`toFrame` are event-relative, so a chord voice that has been
   * sustaining for ten minutes costs only the frames that land in the window
   * being printed. Without this the renderer computes the whole 600-second
   * note for a 60-second audition, which is exactly the kind of waste this
   * tool exists to delete.
   *
   * @param {object} event    a MusicalEvent from the score
   * @param {object} voice    from `pick()`
   * @param {object} opts     {velocityCompress, brightnessTiltDb, hingeHz}
   * @returns {{buffer: Float32Array, frames: number}}
   */
  render(event, voice, opts, fromFrame = 0, toFrame = Infinity) {
    const sr = this.sampleRate;
    const pcm = this.pcm.get(voice.sample.ogg);
    if (!pcm) throw new Error(`not preloaded: ${voice.sample.ogg}`);

    const { frames: totalFrames, releaseSeconds, sustained } = this.voiceFrames(event, voice);
    const begin = Math.max(0, Math.floor(fromFrame));
    const stop = Math.min(totalFrames, Math.ceil(toFrame));
    const frames = totalFrames;
    const out = new Float32Array(Math.max(0, stop - begin));

    // Loop bounds, in source frames.
    const loopStart = sustained ? voice.loop.start * sr : 0;
    const loopEnd = sustained ? voice.loop.end * sr : 0;
    const loopLen = loopEnd - loopStart;
    const xfade = sustained ? Math.min(0.12 * sr, loopLen / 4) : 0;

    // Level: score amplitude (velocity-compressed per the mix law) times the
    // score's own slow envelope. Both come from the engine; neither is invented.
    const amp = Math.pow(Math.max(0, Math.min(1, event.amplitude)), opts.velocityCompress);
    const env = event.envelope ?? null;

    // Twinkle → the same gentle tremolo the live engine uses, so a low, hard-
    // scintillating star shimmers here too.
    const twinkle = event.twinkle ?? 0;
    const lfoHz = 0.06 + 0.22 * twinkle;
    const lfoDepth = 0.3 * twinkle;
    const lfoPhase = ((event.midi * 37) % 360) * (Math.PI / 180);

    // B–V shading: a one-pole shelf around `hingeHz`.
    const brightness = event.timbre?.brightness ?? 0.5;
    const tiltDb = opts.brightnessTiltDb * (brightness - (opts.neutralBrightness ?? 0.5)) * 2;
    const hfGain = 10 ** (tiltDb / 20);
    const alpha = Math.exp((-2 * Math.PI * opts.hingeHz) / sr);
    let lp = 0;

    // Attack/release shaping, on top of whatever the sample already has.
    const attackFrames = Math.max(1, Math.round(voice.attackSeconds * sr));
    const releaseFrames = Math.max(1, Math.round(releaseSeconds * sr));
    const releaseStart = frames - releaseFrames;

    const linkGain = 10 ** (voice.gainDb / 20);
    let envIdx = 0;

    for (let n = begin; n < stop; n++) {
      const tSec = n / sr;

      // ── source position ────────────────────────────────────────────────
      let pos = n * voice.rate;
      let s;
      if (sustained && pos >= loopStart) {
        const k = (pos - loopStart) % loopLen;
        const p = loopStart + k;
        if (k >= loopLen - xfade) {
          const t = (k - (loopLen - xfade)) / xfade;
          const w = (t * Math.PI) / 2;
          s = readInterpolated(pcm, p) * Math.cos(w) + readInterpolated(pcm, p - loopLen) * Math.sin(w);
        } else {
          s = readInterpolated(pcm, p);
        }
      } else {
        if (pos >= pcm.length - 2) {
          s = 0;
        } else {
          s = readInterpolated(pcm, pos);
        }
      }

      // ── B–V tilt ───────────────────────────────────────────────────────
      lp = lp * alpha + s * (1 - alpha);
      s = lp + (s - lp) * hfGain;

      // ── level ──────────────────────────────────────────────────────────
      let g = amp * linkGain;
      if (env) {
        // Breakpoints are ordered; walk the pointer instead of re-searching.
        while (envIdx < env.length - 1 && env[envIdx + 1].atSeconds <= tSec) envIdx++;
        const a = env[envIdx];
        const b = env[envIdx + 1];
        if (!b) {
          g *= a.amplitude;
        } else {
          const span = b.atSeconds - a.atSeconds;
          const t = span > 0 ? (tSec - a.atSeconds) / span : 0;
          g *= a.amplitude + (b.amplitude - a.amplitude) * Math.max(0, Math.min(1, t));
        }
      }
      if (lfoDepth > 0) g *= 1 - lfoDepth * (0.5 - 0.5 * Math.cos(2 * Math.PI * lfoHz * tSec + lfoPhase));
      if (n < attackFrames) g *= n / attackFrames;
      if (n >= releaseStart) {
        const t = (n - releaseStart) / releaseFrames;
        g *= Math.cos((t * Math.PI) / 2) ** 2;
      }

      out[n - begin] = s * g;
    }

    return { buffer: out, frames: out.length, startFrame: begin };
  }
}
