/**
 * Slice B0 — the SAMPLER BANK: lazy, per-lens Tone.Sampler loading.
 *
 * INFRASTRUCTURE ONLY. Nothing in the running app calls this yet — wiring the
 * bank into the stream engine is B1, and doing it here would mean editing
 * `streamEngine.ts`, which a parallel stream owns. What this file guarantees is
 * that when B1 arrives, the instrument decisions are already made, already
 * typed, and already identical to the ones the offline renderer prints.
 *
 * Two things it is careful about:
 *
 *   LAZY, PER LENS. A session uses one lens. Loading all five costs ~4.4 MB of
 *   audio for ~2 MB of benefit, on a product whose whole promise is that it
 *   starts within a second. So a lens loads its primary tier (one instrument
 *   per role — enough to play anything) and only fetches the fall-through tier
 *   afterwards, in the background.
 *
 *   FORMAT. `.ogg` here is Ogg Opus, chosen because the pinned toolchain has no
 *   libvorbis and Opus is smaller and better at these rates. Safari's Opus
 *   support is recent enough to be worth not betting on, so every note is also
 *   encoded as `.mp3` and the bank asks the browser which it can actually play.
 */

import * as Tone from 'tone';

import type { VoiceRole } from '../mapping/index.ts';
import type { LensConfig, SampleManifest, ChosenVoice } from './samplerLenses.ts';
import {
  LENS_ROLES,
  chooseVoice,
  instrumentsForLens,
  validateLensConfig,
} from './samplerLenses.ts';

export interface SamplerBankOptions {
  /** Where the built sample set lives. Defaults to the bundled `/samples/`. */
  baseUrl?: string;
  /** Override format detection (mostly for tests). */
  format?: 'ogg' | 'mp3';
  /** Called whenever loading progress changes, 0..1. */
  onProgress?: (loaded: number, total: number) => void;
}

/** Ask the browser what it can actually play, rather than assuming. */
export function preferredFormat(): 'ogg' | 'mp3' {
  if (typeof document === 'undefined') return 'ogg';
  const probe = document.createElement('audio');
  // Chrome/Firefox answer "probably"; Safari has historically answered "" for
  // Ogg Opus even in versions that can decode it, so anything short of a clear
  // yes falls back to mp3, which every target can play.
  return probe.canPlayType('audio/ogg; codecs="opus"') === 'probably' ? 'ogg' : 'mp3';
}

/**
 * Fetch the two JSON files the bank runs on. Kept separate from the constructor
 * so callers can supply them from anywhere (tests, a service worker, a bundle).
 */
export async function loadSampleCatalogue(
  baseUrl = '/samples',
): Promise<{ manifest: SampleManifest; lenses: LensConfig }> {
  const [manifest, lenses] = await Promise.all([
    fetch(`${baseUrl}/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`sample manifest: ${r.status} ${r.statusText}`);
      return r.json() as Promise<SampleManifest>;
    }),
    fetch(`${baseUrl}/lenses.json`).then((r) => {
      if (!r.ok) throw new Error(`lens config: ${r.status} ${r.statusText}`);
      return r.json() as Promise<LensConfig>;
    }),
  ]);
  return { manifest, lenses };
}

/**
 * Holds one `Tone.Sampler` per instrument and answers "what plays this note".
 *
 * The bank owns instruments, not roles: several roles across several lenses
 * share `contrabass`, and loading it once is the point.
 */
export class SamplerBank {
  readonly #manifest: SampleManifest;
  readonly #lenses: LensConfig;
  readonly #baseUrl: string;
  readonly #format: 'ogg' | 'mp3';
  readonly #onProgress: ((loaded: number, total: number) => void) | undefined;

  /** instrument id → sampler, once it has been asked for. */
  readonly #samplers = new Map<string, Tone.Sampler>();
  /** instrument id → the in-flight load, so a second ask does not refetch. */
  readonly #loading = new Map<string, Promise<Tone.Sampler>>();
  /**
   * `instrument/midi` → the decoded audio, kept alongside the sampler.
   *
   * B1 needed this. A `Tone.Sampler` is ONE node: connecting it to a per-note
   * panner fans its whole output to that panner, so every note of the role
   * would land wherever the most recent star happened to be. Azimuth panning is
   * not decoration — it is how the sky has a shape — so the live player builds
   * its own source per note and needs the buffer, not the node. The sampler is
   * still built and still exported; it is simply not the path a panned voice
   * takes.
   */
  readonly #buffers = new Map<string, Tone.ToneAudioBuffer>();

  #destination: Tone.InputNode | null = null;

  constructor(manifest: SampleManifest, lenses: LensConfig, options: SamplerBankOptions = {}) {
    const problems = validateLensConfig(lenses, manifest);
    if (problems.length > 0) {
      throw new Error(`lens config does not match the sample set:\n  ${problems.join('\n  ')}`);
    }
    this.#manifest = manifest;
    this.#lenses = lenses;
    this.#baseUrl = options.baseUrl ?? '/samples';
    this.#format = options.format ?? preferredFormat();
    this.#onProgress = options.onProgress;
  }

  get format(): 'ogg' | 'mp3' {
    return this.#format;
  }

  get lensIds(): string[] {
    return Object.keys(this.#lenses.lenses);
  }

  /** Every loaded sampler routes here. Set before loading. */
  connect(destination: Tone.InputNode): void {
    this.#destination = destination;
    for (const sampler of this.#samplers.values()) sampler.connect(destination);
  }

  /**
   * Make a lens playable.
   *
   * Awaits only the primary tier — one instrument per role, enough to voice any
   * note in any register. The fall-through tier is kicked off but not awaited,
   * so the first sound is not held up by an instrument that may never be
   * reached. Await the returned `whenComplete` if you need the whole lens.
   */
  async loadLens(lensId: string): Promise<{ whenComplete: Promise<void> }> {
    const { primary, fallback } = instrumentsForLens(this.#lenses, lensId);
    let loaded = 0;
    const total = primary.length + fallback.length;
    const track = <T>(p: Promise<T>): Promise<T> =>
      p.then((v) => {
        loaded += 1;
        this.#onProgress?.(loaded, total);
        return v;
      });

    await Promise.all(primary.map((id) => track(this.#loadInstrument(id))));
    const rest = Promise.all(fallback.map((id) => track(this.#loadInstrument(id)))).then(
      () => undefined,
    );
    return { whenComplete: rest };
  }

  /** Which instruments this lens would fetch, without fetching them. */
  planFor(lensId: string): { primary: string[]; fallback: string[]; bytes: number } {
    const { primary, fallback } = instrumentsForLens(this.#lenses, lensId);
    const bytes = [...primary, ...fallback].reduce(
      (sum, id) => sum + (this.#manifest.instruments[id]?.oggBytes ?? 0),
      0,
    );
    return { primary, fallback, bytes };
  }

  /** The instrument + pitch shift this lens uses for this note of this role. */
  choose(lensId: string, role: VoiceRole, midi: number): ChosenVoice {
    return chooseVoice(this.#lenses, this.#manifest, lensId, role, midi);
  }

  /**
   * The sampler for a note, or null if its instrument has not finished loading.
   *
   * Returning null rather than awaiting is deliberate: the scheduler runs ahead
   * of the audio clock and must never block on a fetch. B1 decides what to do
   * with a miss — most likely fall through to the next link in the chain, which
   * the primary tier guarantees is already loaded.
   */
  samplerFor(voice: ChosenVoice): Tone.Sampler | null {
    return this.#samplers.get(voice.instrument) ?? null;
  }

  /**
   * The decoded audio for one recorded note, or null if it has not loaded.
   *
   * Keyed by instrument and by the MIDI number of the RECORDED note — the
   * sample the voicing chose, not the pitch being played, which is reached by
   * resampling.
   */
  bufferFor(instrument: string, sampleMidi: number): Tone.ToneAudioBuffer | null {
    return this.#buffers.get(`${instrument}/${sampleMidi}`) ?? null;
  }

  /** Has this instrument finished loading? */
  isLoaded(instrument: string): boolean {
    return this.#samplers.has(instrument);
  }

  /** Release every sampler and forget everything loaded. */
  dispose(): void {
    for (const sampler of this.#samplers.values()) sampler.dispose();
    this.#samplers.clear();
    this.#loading.clear();
    // The buffers belong to the samplers that own them; disposing a sampler
    // releases them, so this only drops our index.
    this.#buffers.clear();
  }

  async #loadInstrument(id: string): Promise<Tone.Sampler> {
    const existing = this.#samplers.get(id);
    if (existing) return existing;
    const inFlight = this.#loading.get(id);
    if (inFlight) return inFlight;

    const entry = this.#manifest.instruments[id];
    if (!entry) throw new Error(`no such instrument in the manifest: ${id}`);

    const urls: Record<string, string> = {};
    for (const sample of entry.samples) {
      // Tone.Sampler keys by note name; the manifest already carries the pitch
      // we measured, which for the un-named idiophones is not what the upstream
      // filename claimed.
      urls[sample.note] = this.#format === 'ogg' ? sample.ogg : sample.mp3;
    }

    // Fetch the audio first, then hand the decoded buffers to the sampler. One
    // download serves both consumers: the sampler for anything that wants a
    // keyboard, and the buffer index for the live player, which builds its own
    // source per note so each star can keep its own place in the stereo field.
    const promise = new Promise<Tone.Sampler>((resolve, reject) => {
      const buffers = new Tone.ToneAudioBuffers({
        urls,
        baseUrl: `${this.#baseUrl}/`,
        onload: () => {
          const loaded: Record<string, Tone.ToneAudioBuffer> = {};
          for (const sample of entry.samples) {
            const buffer = buffers.get(sample.note);
            loaded[sample.note] = buffer;
            this.#buffers.set(`${id}/${sample.midi}`, buffer);
          }
          const sampler = new Tone.Sampler({
            urls: loaded,
            // A sustained instrument holds until released; a struck one rings
            // out on its own, so its release only shapes an early stop.
            attack: entry.attackSeconds,
            release: entry.kind === 'sustained' ? 1.2 : 0.4,
            curve: 'exponential',
            // The loudness match, so a fall-through mid-phrase does not lurch.
            volume: entry.levelDb,
          });
          if (this.#destination) sampler.connect(this.#destination);
          this.#samplers.set(id, sampler);
          this.#loading.delete(id);
          resolve(sampler);
        },
        onerror: (error) => {
          this.#loading.delete(id);
          buffers.dispose();
          reject(new Error(`failed to load instrument "${id}": ${error.message}`));
        },
      });
    });

    this.#loading.set(id, promise);
    return promise;
  }
}

/**
 * Total download for each lens, for budgeting. B0's target was ≤3 MB per lens;
 * this is how that stays honest as instruments come and go.
 */
export function lensPayloadBytes(
  config: LensConfig,
  manifest: SampleManifest,
): Record<string, { primaryBytes: number; totalBytes: number }> {
  const out: Record<string, { primaryBytes: number; totalBytes: number }> = {};
  for (const lensId of Object.keys(config.lenses)) {
    const { primary, fallback } = instrumentsForLens(config, lensId);
    const size = (ids: string[]): number =>
      ids.reduce((sum, id) => sum + (manifest.instruments[id]?.oggBytes ?? 0), 0);
    out[lensId] = {
      primaryBytes: size(primary),
      totalBytes: size(primary) + size(fallback),
    };
  }
  return out;
}

export { LENS_ROLES };
