/**
 * Layer 3 — the LIVE SAMPLED PLAYER (Slice B1).
 *
 * Slice A2 proved the schedule, A3 gave it motion, A4 gave it form, B0 built the
 * instruments, the lens config and the offline renderer. This is where they
 * become an app you can press play on.
 *
 * FOUR THINGS IT REFUSES TO DO, each because they have already gone wrong once:
 *
 *  1. **It does not derive its own schedule.** Which instrument, which pitch,
 *     which velocity all come from `scripts/lib/schedule.mjs` — the same module
 *     `render-score.mjs` imports. Two implementations that agree today diverge
 *     eventually; one implementation cannot.
 *  2. **It does not invent the mix.** Stem trims and the master's loudness trim
 *     are MEASURED by the renderer and read from `calibration.json`. See
 *     `mixLaw.ts` for why a live graph must not measure its own output.
 *  3. **It does not transpose weather on a hunch.** The score carries a
 *     `registerHint`; the schedule applies it. The 2026-08-07 unison defect is
 *     fixed at its source and this layer merely obeys.
 *  4. **It does not put a shared sampler on a role bus.** See `#startVoice`.
 *
 * THE GRAPH
 *
 *   buffer source ─▶ B–V tilt ─▶ twinkle ─▶ gain (velocity · arc) ─▶ pan ─┐
 *                                                                          ▼
 *   ROLE BUS ─▶ concurrency ─▶ EQ lane ─┬──────────────────────────▶ 38 Hz ─┐
 *                                       └─▶ THIS ROLE's reverb/delay ─▶ ────┤
 *                                                                           ▼
 *              master (LUFS trim) ─▶ limiter ─▶ out  ◀─ stem trim ◀─ [glue] ┘
 *
 * Each role owns a bus AND ITS OWN SPACE, because that is where the mix law is
 * stated — on stems, not on notes, and the renderer's stems each carry their
 * own reverb. A shared reverb return was tried first and put chord 6 dB and
 * lead 5 dB under their targets while ground and weather sat exactly on theirs.
 */

import * as Tone from 'tone';

import type { MusicalEvent, ScoreWindow, SessionPlan, VoiceRole } from '../mapping/index.ts';
import { renderWindow } from '../mapping/index.ts';
import {
  buildSchedule,
  concurrencyGains,
  concurrencyGrid,
  type ScheduledVoice,
} from '../../../scripts/lib/schedule.mjs';
import { SamplerBank, loadSampleCatalogue } from './samplerBank.ts';
import {
  LENS_ROLES,
  eqLaneFor,
  masteringFor,
  type EqLane,
  type LensConfig,
  type MasteringConfig,
  type SampleManifest,
} from './samplerLenses.ts';
import {
  DEFAULT_CALIBRATION,
  MASTER,
  ROLE_SHAPING,
  SEND_LEVELS,
  isCalibrated,
  loadCalibration,
  type MixCalibration,
} from './mixLaw.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The score's own amplitude arc, read at an event-relative moment. */
function amplitudeAt(
  envelope: readonly { atSeconds: number; amplitude: number }[],
  atSeconds: number,
): number {
  if (envelope.length === 0) return 1;
  const first = envelope[0] as { atSeconds: number; amplitude: number };
  if (atSeconds <= first.atSeconds) return first.amplitude;
  for (let i = 1; i < envelope.length; i++) {
    const a = envelope[i - 1] as { atSeconds: number; amplitude: number };
    const b = envelope[i] as { atSeconds: number; amplitude: number };
    if (atSeconds > b.atSeconds) continue;
    const span = b.atSeconds - a.atSeconds;
    const t = span > 0 ? (atSeconds - a.atSeconds) / span : 0;
    return a.amplitude + (b.amplitude - a.amplitude) * clamp(t, 0, 1);
  }
  return (envelope[envelope.length - 1] as { amplitude: number }).amplitude;
}

/** How often the concurrency automation is written, in seconds of piece time. */
const CONCURRENCY_STEP_SECONDS = 0.25;
/** How far ahead the scheduler runs, and how often it tops up. */
const LOOKAHEAD_SECONDS = 12;
const TOP_UP_SECONDS = 4;
/** Dip and recovery when the lens changes mid-flight. */
const LENS_CROSSFADE_SECONDS = 1.6;
/**
 * Below this the B–V tilt is inaudible and not worth a filter per note. Half a
 * dB of shelf on one voice is under any listening threshold, and skipping it
 * saves a BiquadFilterNode on every event whose star is near neutral colour.
 */
const TILT_EPSILON_DB = 0.5;
/**
 * Twinkle costs an LFO and a gain per note, so it is spent where it can be
 * heard: on stars that actually scintillate, holding long enough for a
 * ~0.1 Hz shimmer to complete a cycle. A struck chime is over first.
 */
const TWINKLE_MIN = 0.15;
const TWINKLE_MIN_SECONDS = 3;
/**
 * How much the level meters smooth.
 *
 * Was 0.9, which read a continuous drone accurately and a bursty role about
 * 5 dB low — enough to make the harness look like the chord bed and the lead
 * were under the mix law when a proper tap of the master showed the live graph
 * within 1 dB of the offline renderer. A meter that lies in one direction for
 * one kind of signal is worse than no meter, because it invites a fix to a
 * problem that is not there.
 */
const METER_SMOOTHING = 0.4;

export interface SampledStreamOptions {
  lensId?: string;
  /** Where `manifest.json`, `lenses.json` and `calibration.json` live. */
  baseUrl?: string;
  calibration?: MixCalibration;
  onProgress?: (loaded: number, total: number) => void;
  /** Notified when a note is dropped because its instrument had not loaded. */
  onDropped?: (role: VoiceRole, instrument: string) => void;
}

/** One role's signal path, from bus to master. */
interface RoleChain {
  bus: Tone.Gain;
  concurrency: Tone.Gain;
  highpass: Tone.Filter;
  lowShelf: Tone.Filter;
  dip: Tone.Filter;
  highShelf: Tone.Filter;
  /** This role's own space, and the guard under it. */
  reverb: Tone.Reverb | null;
  delay: Tone.FeedbackDelay | null;
  sends: Tone.Gain[];
  rumbleGuard: Tone.Filter;
  glue: Tone.Compressor | null;
  trim: Tone.Gain;
  meter: Tone.Meter;
}

interface LiveVoice {
  sourceId: string;
  role: VoiceRole;
  /** Level this voice was scheduled at — what the star field glows on. */
  scheduledLevel: number;
  startsAt: number;
  endsAt: number;
  dispose(): void;
}

export interface SampledStream {
  /** Fetch the active lens's instruments and make the graph playable. */
  ready(): Promise<void>;
  play(fromSeconds?: number): Promise<void>;
  stop(): void;
  dispose(): void;
  /** Swap the lens; takes effect from the next scheduled window. */
  setLens(lensId: string): Promise<void>;
  readonly lensId: string;
  readonly lensIds: string[];
  readonly playing: boolean;
  /** False when the mix is running on the documented approximation. */
  readonly calibrated: boolean;
  /** Seconds into the session, or 0 when stopped. */
  playheadSeconds(): number;
  /** Per-voice level for the Phase 4 star field, indexed by `levelSources()`. */
  getLevels(): Float32Array;
  levelSources(): string[];
  /** Measured per-role levels, so the mix law can be watched while it plays. */
  getStemLevels(): Record<string, number>;
  /** The schedule this engine would play for a span — the parity surface. */
  scheduleFor(fromSeconds: number, toSeconds: number, lensId?: string): ScheduledVoice[];
}

class ToneSampledStream implements SampledStream {
  readonly #plan: SessionPlan;
  readonly #lenses: LensConfig;
  readonly #manifest: SampleManifest;
  readonly #bank: SamplerBank;
  readonly #mastering: MasteringConfig;
  readonly #calibration: MixCalibration;
  readonly #onDropped: ((role: VoiceRole, instrument: string) => void) | undefined;

  #lens: string;
  #pendingLens: string | null = null;

  /** Audio-context time at which piece-time `#sliceFrom` sounds. */
  #origin = 0;
  #sliceFrom = 0;
  #scheduledTo = 0;
  #playing = false;
  #disposed = false;
  #ticker: ReturnType<typeof setInterval> | undefined;

  readonly #roles = new Map<VoiceRole, RoleChain>();
  #master: Tone.Gain | null = null;
  #limiter: Tone.Limiter | null = null;
  #masterMeter: Tone.Meter | null = null;

  #voices: LiveVoice[] = [];
  #levels = new Float32Array(0);
  #sources: string[] = [];
  /** The rendered score, cached so a top-up does not re-derive an hour of it. */
  #window: ScoreWindow | null = null;

  constructor(
    plan: SessionPlan,
    lenses: LensConfig,
    manifest: SampleManifest,
    options: SampledStreamOptions = {},
  ) {
    this.#plan = plan;
    this.#lenses = lenses;
    this.#manifest = manifest;
    this.#mastering = masteringFor(lenses);
    this.#calibration = options.calibration ?? DEFAULT_CALIBRATION;
    this.#onDropped = options.onDropped;
    this.#lens =
      options.lensId ??
      (plan.config.mode === 'birth-sky'
        ? (lenses.defaults?.birthSky ?? 'aurora')
        : (lenses.defaults?.tonight ?? 'ground'));

    const bankOptions: ConstructorParameters<typeof SamplerBank>[2] = {};
    if (options.baseUrl !== undefined) bankOptions.baseUrl = options.baseUrl;
    if (options.onProgress !== undefined) bankOptions.onProgress = options.onProgress;
    this.#bank = new SamplerBank(manifest, lenses, bankOptions);
  }

  get lensId(): string {
    return this.#lens;
  }

  get lensIds(): string[] {
    return this.#bank.lensIds;
  }

  get playing(): boolean {
    return this.#playing;
  }

  get calibrated(): boolean {
    return isCalibrated(this.#calibration, this.#lens);
  }

  // ----------------------------------------------------------------- graph

  #buildGraph(): void {
    if (this.#master) return;

    const limiter = new Tone.Limiter(this.#mastering.limiter.ceilingDbfs).toDestination();
    const masterMeter = new Tone.Meter({ normalRange: false, smoothing: METER_SMOOTHING });
    const master = new Tone.Gain(1).connect(limiter);
    master.connect(masterMeter);

    this.#limiter = limiter;
    this.#master = master;
    this.#masterMeter = masterMeter;

    for (const role of LENS_ROLES) this.#roles.set(role, this.#buildRoleChain(role, master));
    this.#applyLens();
  }

  /**
   * One role's chain.
   *
   * The EQ lane is what a musician's review of the B0 clips found missing: five
   * roles can each hit their level target and still pile into the same
   * 200–800 Hz band, where the ear cannot separate them. So the pads are carved
   * where the moving parts live, and motion is HEARD rather than merely
   * measured.
   *
   * All four filters exist for every role even when the lane is flat, so that
   * switching lenses is a parameter change and never a graph rebuild. A rebuild
   * mid-note is a click, and a click is the one thing a calm piece cannot
   * survive.
   */
  #buildRoleChain(role: VoiceRole, master: Tone.Gain): RoleChain {
    const trim = new Tone.Gain(1).connect(master);
    const meter = new Tone.Meter({ normalRange: false, smoothing: METER_SMOOTHING });
    trim.connect(meter);

    // Glue on figuration ONLY. The macro arc is the composition — Slice A4 spent
    // itself shaping how the night swells — so compressing the master, or the
    // bed, would undo that work. Figuration alone gets a slow ≤2 dB squeeze, to
    // stop one chime poking out of its own layer.
    let glue: Tone.Compressor | null = null;
    let head: Tone.InputNode = trim;
    if (role === 'figuration') {
      const g = this.#mastering.figurationGlue;
      glue = new Tone.Compressor({
        threshold: g.thresholdDb,
        ratio: g.ratio,
        attack: g.attackSeconds,
        release: g.releaseSeconds,
        knee: g.kneeDb,
      }).connect(trim);
      head = glue;
    }

    // The 38 Hz guard, per stem — exactly where the renderer applies it, so
    // that what the meter reads is what gets summed.
    const rumbleGuard = new Tone.Filter({
      type: 'highpass',
      frequency: MASTER.highpassHz,
      rolloff: -12,
    }).connect(head);

    // THIS ROLE'S OWN SPACE. Not a shared bus: the mix law is stated as measured
    // STEM levels and the renderer's stems each carry their own reverb, so a
    // shared return would mean the live graph is mixing — and metering — a
    // different thing from the one the law was written about.
    const levels = SEND_LEVELS[role];
    const sends: Tone.Gain[] = [];
    let reverb: Tone.Reverb | null = null;
    let delay: Tone.FeedbackDelay | null = null;
    if (levels.reverb > 0) {
      reverb = new Tone.Reverb({ decay: 8, preDelay: 0.04, wet: 1 }).connect(rumbleGuard);
    }
    if (levels.delay > 0) {
      delay = new Tone.FeedbackDelay({ delayTime: 0.42, feedback: 0.28, wet: 1 }).connect(
        rumbleGuard,
      );
    }

    const highShelf = new Tone.Filter({ type: 'highshelf', frequency: 5000, gain: 0 });
    highShelf.connect(rumbleGuard);
    // The sends are fed from the CARVED signal, as in the renderer: the lane
    // decides where the role lives, and its tail should live there too.
    if (reverb) {
      const send = new Tone.Gain(levels.reverb).connect(reverb);
      highShelf.connect(send);
      sends.push(send);
    }
    if (delay) {
      const send = new Tone.Gain(levels.delay).connect(delay);
      highShelf.connect(send);
      sends.push(send);
    }

    const dip = new Tone.Filter({ type: 'peaking', frequency: 1600, Q: 0.8, gain: 0 }).connect(
      highShelf,
    );
    const lowShelf = new Tone.Filter({ type: 'lowshelf', frequency: 120, gain: 0 }).connect(dip);
    const highpass = new Tone.Filter({ type: 'highpass', frequency: 20, rolloff: -12 }).connect(
      lowShelf,
    );
    const concurrency = new Tone.Gain(1).connect(highpass);
    const bus = new Tone.Gain(1).connect(concurrency);

    return {
      bus,
      concurrency,
      highpass,
      lowShelf,
      dip,
      highShelf,
      reverb,
      delay,
      sends,
      rumbleGuard,
      glue,
      trim,
      meter,
    };
  }

  /** Point every role's filters and trims at the active lens. */
  #applyLens(): void {
    for (const role of LENS_ROLES) {
      const chain = this.#roles.get(role);
      if (!chain) continue;
      const lane: EqLane = eqLaneFor(this.#lenses, this.#lens, role);

      chain.highpass.frequency.value = lane.highpassHz ?? 20;
      chain.lowShelf.frequency.value = lane.lowShelf?.hz ?? 120;
      chain.lowShelf.gain.value = lane.lowShelf?.db ?? 0;
      chain.dip.frequency.value = lane.dip?.hz ?? 1600;
      chain.dip.Q.value = lane.dip?.q ?? 0.8;
      chain.dip.gain.value = lane.dip?.db ?? 0;
      chain.highShelf.frequency.value = lane.highShelf?.hz ?? 5000;
      chain.highShelf.gain.value = lane.highShelf?.db ?? 0;

      chain.trim.gain.value = Tone.dbToGain(this.#stemTrimDb(role));
    }
    if (this.#master) this.#master.gain.value = Tone.dbToGain(this.#masterTrimDb());
  }

  /**
   * The stem trim for a role under the active lens.
   *
   * MEASURED, not guessed: `render-score.mjs` renders each stem, reads its
   * steady-state level and writes the trim that lands it on the mix law's
   * target. This reads that measurement. When a lens has never been calibrated
   * the fallback is stated in `mixLaw.ts` and `calibrated` reports false, so the
   * harness can say so rather than quietly playing an unlevelled mix.
   */
  #stemTrimDb(role: VoiceRole): number {
    const measured = this.#calibration.lenses[this.#lens]?.stemTrimDb?.[role];
    if (measured !== undefined) return measured;
    return DEFAULT_CALIBRATION.lenses._fallback?.stemTrimDb[role] ?? 0;
  }

  /**
   * The master trim, in dB, that puts the mix on its LUFS target.
   *
   * Loudness, not peak. Peak normalisation rewards crest factor rather than
   * level: a sparse early sky and a full late one can share a peak and still
   * differ by several dB of perceived loudness, which for a piece meant to hold
   * a steady calm is precisely the wrong thing to hold constant.
   */
  #masterTrimDb(): number {
    const target =
      this.#plan.config.mode === 'birth-sky'
        ? this.#mastering.lufsTargets.birthSky
        : this.#mastering.lufsTargets.tonight;
    const reference =
      this.#calibration.lenses[this.#lens]?.measuredLufs ??
      DEFAULT_CALIBRATION.lenses._fallback?.measuredLufs ??
      target;
    return target - reference;
  }

  // ------------------------------------------------------------ scheduling

  async ready(): Promise<void> {
    this.#assertLive();
    this.#buildGraph();
    await this.#bank.loadLens(this.#lens);
    // Each role's reverb generates its own impulse response; none of them may
    // still be doing that when the first note lands.
    await Promise.all([...this.#roles.values()].map((c) => c.reverb?.ready ?? Promise.resolve()));
  }

  async play(fromSeconds = 0): Promise<void> {
    this.#assertLive();
    if (this.#playing) return;

    await Tone.start();
    await this.ready();
    if (this.#disposed) return;

    this.#sliceFrom = fromSeconds;
    // A quarter-second of headroom: the first window has to be scheduled before
    // the clock reaches it, or the opening notes arrive in the past and are
    // dropped.
    this.#origin = Tone.now() + 0.25;
    this.#scheduledTo = fromSeconds;
    this.#playing = true;

    this.#scheduleSpan(fromSeconds, fromSeconds + LOOKAHEAD_SECONDS, true);

    this.#ticker = setInterval(() => {
      if (!this.#playing || this.#disposed) return;
      try {
        if (this.#scheduledTo - this.playheadSeconds() < LOOKAHEAD_SECONDS) {
          const from = this.#scheduledTo;
          // A pending lens change lands HERE — on a window edge, never mid-note.
          if (this.#pendingLens) this.#commitLens();
          this.#scheduleSpan(from, from + LOOKAHEAD_SECONDS);
        }
        this.#retire(Tone.now());
      } catch (error) {
        // A scheduler that throws inside setInterval stops silently and the
        // music simply ends. Say so instead of leaving the user guessing.
        console.error('Cosmophony: scheduling failed, stopping.', error);
        this.stop();
      }
    }, TOP_UP_SECONDS * 1000);
  }

  playheadSeconds(): number {
    if (!this.#playing) return 0;
    return Math.max(0, this.#sliceFrom + (Tone.now() - this.#origin));
  }

  /**
   * The schedule for a span, without touching the audio clock.
   *
   * Public because it is the PARITY SURFACE: `test/schedule.test.ts` asserts
   * this equals what `render-score.mjs` derives for the same score and lens. The
   * claim under test is about the schedule, not the audio — two renderers may
   * legitimately sound a little different, but if they disagree about which note
   * happens when, one of them is wrong.
   */
  scheduleFor(fromSeconds: number, toSeconds: number, lensId = this.#lens): ScheduledVoice[] {
    // No options. The mix law's shaping is the shared module's default, so this
    // player and `render-score.mjs` cannot be handed different ones.
    return buildSchedule(this.#eventsIn(fromSeconds, toSeconds), this.#lenses, this.#manifest, lensId);
  }

  /**
   * Score events overlapping a span.
   *
   * The window is always rendered from 0 rather than incrementally, because
   * partition invariance guarantees that yields exactly the same events, and a
   * long note that began before the span still has to be found. The result is
   * cached; only a span past the cached end re-renders.
   */
  #eventsIn(fromSeconds: number, toSeconds: number): MusicalEvent[] {
    if (!this.#window || this.#window.toSeconds < toSeconds) {
      this.#window = renderWindow(this.#plan, 0, Math.max(toSeconds, LOOKAHEAD_SECONDS * 4));
    }
    return this.#window.events.filter(
      (e) => e.startSeconds + e.durationSeconds > fromSeconds && e.startSeconds < toSeconds,
    );
  }

  /**
   * @param resuming true only for the first span after `play(from)`.
   *
   * Every later span starts only the notes that BEGIN inside it — a note
   * already sounding was started by an earlier window, and starting it again
   * would double it.
   *
   * The FIRST span is different: there is no earlier window. Starting playback
   * at t=300 played ground and weather over silence where the bed and the lead
   * should have been, because a chord voice that began at t=100 and holds for
   * six minutes never begins inside any span the player sees. That is not a mix
   * problem — those roles simply were not there.
   */
  #scheduleSpan(from: number, to: number, resuming = false): void {
    const schedule = buildSchedule(this.#eventsIn(from, to), this.#lenses, this.#manifest, this.#lens);

    for (const voice of schedule) {
      if (voice.startSeconds >= from && voice.startSeconds < to) this.#startVoice(voice);
      else if (resuming && voice.startSeconds < from) {
        this.#startVoice(voice, from - voice.startSeconds);
      }
    }
    this.#automateConcurrency(schedule, from, to);
    this.#scheduledTo = Math.max(this.#scheduledTo, to);
  }

  /**
   * Write the mix law's concurrency normalisation onto the role bus.
   *
   * Divide by sqrt(N), where N is the number of voices sounding AT THAT MOMENT.
   * The section maximum was tried first and left the bed 6 dB hot as the sky
   * filled — the failure the law was written after. The grid and the slew come
   * from the shared module, so the automation written here and the gain the
   * renderer applies are the same numbers.
   */
  #automateConcurrency(schedule: ScheduledVoice[], from: number, to: number): void {
    for (const role of LENS_ROLES) {
      if (!ROLE_SHAPING[role]?.concurrencyNormalise) continue;
      const chain = this.#roles.get(role);
      if (!chain) continue;

      const grid = concurrencyGrid(schedule, role, from, to, CONCURRENCY_STEP_SECONDS);
      const gains = concurrencyGains(grid, 2.0);
      const param = chain.concurrency.gain;
      const now = Tone.now();

      for (let i = 0; i < gains.length; i++) {
        const at = this.#origin + (from + i * CONCURRENCY_STEP_SECONDS - this.#sliceFrom);
        const value = gains[i] ?? 1;
        if (at <= now) param.setValueAtTime(value, now);
        else param.linearRampToValueAtTime(value, at);
      }
    }
  }

  /**
   * Start one note.
   *
   * WHY A BUFFER SOURCE AND NOT THE BANK'S SAMPLER: a `Tone.Sampler` is a single
   * node. Connecting it to a per-note panner fans its ENTIRE output to that
   * panner, so every note of the role would land wherever the most recent star
   * happened to be. Azimuth panning is not decoration — it is how the sky has a
   * shape — so each voice gets its own source, tilt, twinkle, gain and panner.
   * The bank still owns the download, the format choice and the lens plan; only
   * the playback is ours.
   */
  #startVoice(voice: ScheduledVoice, intoNoteSeconds = 0): void {
    const role = voice.role as VoiceRole;
    const chain = this.#roles.get(role);
    if (!chain) return;

    const buffer = this.#bank.bufferFor(voice.instrument, voice.sampleMidi);
    if (!buffer) {
      // The primary tier is awaited before play, so this is the fall-through
      // tier still arriving. Dropping the note beats blocking the scheduler on a
      // fetch or substituting a different pitch: silence is honest, a wrong note
      // is not.
      this.#onDropped?.(role, voice.instrument);
      return;
    }

    const when = this.#origin + (voice.startSeconds + intoNoteSeconds - this.#sliceFrom);
    if (when < Tone.now() - 0.05) return;

    const sustained = voice.kind === 'sustained' && voice.loopStart !== null;
    const releaseSeconds = sustained ? 1.2 : 2.5;
    // A struck instrument cannot ring longer than its recording, however long
    // the score holds the note; a looped one can hold indefinitely.
    const fullSeconds = sustained
      ? voice.durationSeconds + releaseSeconds
      : Math.min(voice.durationSeconds + releaseSeconds, buffer.duration / voice.rate);
    const soundingSeconds = fullSeconds - intoNoteSeconds;
    if (soundingSeconds <= 0.05) return;

    // Where in the RECORDING to pick the note up. A looped instrument is still
    // inside its loop, so it resumes at the loop start rather than at a point
    // past the end of the file; a struck one resumes where its decay has got to.
    const offsetSeconds = sustained
      ? Math.min(intoNoteSeconds * voice.rate, voice.loopStart ?? 0)
      : intoNoteSeconds * voice.rate;

    const panner = new Tone.Panner(voice.pan).connect(chain.bus);
    const gain = new Tone.Gain(0).connect(panner);

    // Twinkle — the star's real scintillation, as a gentle tremolo. Its own
    // node, so it MULTIPLIES the arc rather than being added to it; a tremolo
    // summed into an envelope would deepen as the star faded, which is backwards.
    let twinkleGain: Tone.Gain | null = null;
    let twinkleLfo: Tone.LFO | null = null;
    if (voice.twinkle >= TWINKLE_MIN && voice.durationSeconds >= TWINKLE_MIN_SECONDS) {
      const depth = 0.3 * voice.twinkle;
      twinkleGain = new Tone.Gain(1).connect(gain);
      twinkleLfo = new Tone.LFO({
        frequency: 0.06 + 0.22 * voice.twinkle,
        min: 1 - depth,
        max: 1,
        // Seeded from the pitch, exactly as the renderer does, so two stars do
        // not shimmer in lockstep and the same star shimmers the same way twice.
        phase: (voice.midi * 37) % 360,
      });
      twinkleLfo.connect(twinkleGain.gain);
      twinkleLfo.start(when);
    }
    const afterTilt: Tone.InputNode = twinkleGain ?? gain;

    // B–V colour, as a shelf. A hot blue star is voiced BRIGHTER, not louder.
    // This is the one place the sky's real colour touches the sound; making it a
    // level would put it in competition with the mix law for the same fader.
    let tilt: Tone.Filter | null = null;
    if (Math.abs(voice.tiltDb) >= TILT_EPSILON_DB) {
      tilt = new Tone.Filter({
        type: 'highshelf',
        frequency: this.#lenses.shading.hingeHz,
        gain: voice.tiltDb,
      }).connect(afterTilt);
    }

    const source = new Tone.ToneBufferSource({
      url: buffer,
      playbackRate: voice.rate,
      loop: sustained,
      loopStart: sustained ? (voice.loopStart ?? 0) : 0,
      loopEnd: sustained ? (voice.loopEnd ?? 0) : 0,
      // A note picked up mid-flight gets a short fade rather than its attack —
      // it is already sounding, and re-attacking it would be an audible event
      // the score never wrote.
      fadeIn: intoNoteSeconds > 0 ? 0.08 : Math.max(0.005, voice.attackSeconds),
      fadeOut: releaseSeconds,
      curve: 'exponential',
    }).connect(tilt ?? afterTilt);

    this.#automateLevel(gain.gain, voice, when, soundingSeconds, intoNoteSeconds);
    source.start(when, offsetSeconds, soundingSeconds);

    this.#voices.push({
      sourceId: voice.sourceId,
      role,
      scheduledLevel: clamp(voice.velocity * Tone.dbToGain(voice.gainDb), 0, 1),
      startsAt: when,
      // Held a moment past the fade so disposal never truncates a tail.
      endsAt: when + soundingSeconds + 0.5,
      dispose: () => {
        twinkleLfo?.dispose();
        source.dispose();
        tilt?.dispose();
        twinkleGain?.dispose();
        gain.dispose();
        panner.dispose();
      },
    });
  }

  /**
   * Write a note's level: velocity, the lens/instrument gain, and the score's
   * own slow envelope.
   *
   * The envelope is the star's altitude arc — a rising star swells, a setting
   * one fades. It is composed data, not an effect, and both the renderer and
   * this walk the same breakpoints.
   */
  #automateLevel(
    param: Tone.Param<'gain'>,
    voice: ScheduledVoice,
    when: number,
    soundingSeconds: number,
    intoNoteSeconds = 0,
  ): void {
    const base = voice.velocity * Tone.dbToGain(voice.gainDb);
    const envelope = voice.envelope;

    if (!envelope || envelope.length === 0) {
      param.setValueAtTime(base, when);
      return;
    }

    // The arc is event-relative, so a note picked up mid-flight must start at
    // the amplitude it had already reached — not back at its first breakpoint,
    // which would make every resumed voice swell from the beginning again.
    param.setValueAtTime(base * amplitudeAt(envelope, intoNoteSeconds), when);
    for (const point of envelope) {
      const at = when + point.atSeconds - intoNoteSeconds;
      if (at <= when) continue;
      if (at > when + soundingSeconds) break;
      param.linearRampToValueAtTime(base * point.amplitude, at);
    }
  }

  #retire(now: number): void {
    const keep: LiveVoice[] = [];
    for (const voice of this.#voices) {
      if (voice.endsAt < now) voice.dispose();
      else keep.push(voice);
    }
    if (keep.length !== this.#voices.length) {
      this.#voices = keep;
      this.#levels = new Float32Array(keep.length);
      this.#sources = keep.map((v) => v.sourceId);
    }
  }

  // ---------------------------------------------------------------- lenses

  /**
   * Swap the lens.
   *
   * Applies from the NEXT scheduled window, so notes already in flight finish on
   * the instrument that started them, and the master dips briefly across the
   * seam so the change of colour arrives as a breath rather than a cut.
   *
   * Pitches and timings are untouched. A lens changes what a note sounds like,
   * never which note it is — `test/sampledStream.test.ts` asserts that against
   * this live path, not only against the pure voicing rules.
   */
  async setLens(lensId: string): Promise<void> {
    this.#assertLive();
    if (!this.#lenses.lenses[lensId]) {
      throw new Error(`unknown lens "${lensId}" — have ${this.#bank.lensIds.join(', ')}`);
    }
    if (lensId === this.#lens || lensId === this.#pendingLens) return;

    // Loaded BEFORE it is armed, so the first window under the new lens never
    // has to drop notes waiting on a download.
    await this.#bank.loadLens(lensId);
    if (this.#disposed) return;
    this.#pendingLens = lensId;
    if (!this.#playing) this.#commitLens();
  }

  #commitLens(): void {
    const next = this.#pendingLens;
    this.#pendingLens = null;
    if (!next) return;
    this.#lens = next;

    const master = this.#master;
    if (!master || !this.#playing) {
      this.#applyLens();
      return;
    }

    const now = Tone.now();
    const held = master.gain.value;
    this.#applyLens();
    const target = master.gain.value;

    // `#applyLens` set the new trim instantaneously; take it back and cross the
    // seam as a dip and a recovery.
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(held, now);
    master.gain.linearRampToValueAtTime(held * 0.6, now + LENS_CROSSFADE_SECONDS * 0.4);
    master.gain.linearRampToValueAtTime(target, now + LENS_CROSSFADE_SECONDS);
  }

  // ---------------------------------------------------------------- meters

  /**
   * Per-voice level for the star field.
   *
   * A meter per note would cost an AnalyserNode per note — hundreds on a full
   * sky. Instead a voice's glow is its own scheduled level scaled by its role's
   * measured level: the star that is loudest in the score is the star that
   * glows, and the whole role dims together when the mix dips. Cheaper, and
   * steadier to look at.
   */
  getLevels(): Float32Array {
    if (this.#disposed) return new Float32Array(0);
    if (this.#levels.length !== this.#voices.length) {
      this.#levels = new Float32Array(this.#voices.length);
      this.#sources = this.#voices.map((v) => v.sourceId);
    }
    const now = Tone.now();
    const roleGain = new Map<VoiceRole, number>();
    for (const role of LENS_ROLES) {
      const value = this.#roles.get(role)?.meter.getValue();
      const db = typeof value === 'number' && Number.isFinite(value) ? value : -80;
      // ×4 because the stems sit around −20 dBFS by law; without it every star
      // would be drawn at a tenth of its brightness and the sky would look dead.
      roleGain.set(role, clamp(Tone.dbToGain(db) * 4, 0, 1));
    }

    for (let i = 0; i < this.#voices.length; i++) {
      const voice = this.#voices[i];
      if (!voice) continue;
      const sounding = now >= voice.startsAt && now < voice.endsAt;
      this.#levels[i] = sounding
        ? clamp(voice.scheduledLevel * (roleGain.get(voice.role) ?? 0), 0, 1)
        : 0;
    }
    return this.#levels;
  }

  levelSources(): string[] {
    return this.#sources;
  }

  getStemLevels(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const role of LENS_ROLES) {
      const value = this.#roles.get(role)?.meter.getValue();
      out[role] = typeof value === 'number' && Number.isFinite(value) ? value : -Infinity;
    }
    const master = this.#masterMeter?.getValue();
    out.master = typeof master === 'number' && Number.isFinite(master) ? master : -Infinity;
    // How hard the safety limiter is working, in dB of gain reduction. The law
    // says it should never work at all — `check-mix-law.mjs` asserts that on the
    // rendered audio, and this is the same guard on the live path, where nothing
    // else was watching it.
    out.limiterDb = this.#limiter ? -this.#limiter.reduction : 0;
    return out;
  }

  // ------------------------------------------------------------- lifecycle

  stop(): void {
    if (this.#disposed || !this.#playing) return;
    if (this.#ticker !== undefined) clearInterval(this.#ticker);
    this.#ticker = undefined;
    for (const voice of this.#voices) voice.dispose();
    this.#voices = [];
    this.#levels = new Float32Array(0);
    this.#sources = [];
    this.#playing = false;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#ticker !== undefined) clearInterval(this.#ticker);
    this.#ticker = undefined;
    for (const voice of this.#voices) voice.dispose();
    this.#voices = [];

    for (const chain of this.#roles.values()) {
      for (const send of chain.sends) send.dispose();
      chain.reverb?.dispose();
      chain.delay?.dispose();
      chain.rumbleGuard.dispose();
      chain.bus.dispose();
      chain.concurrency.dispose();
      chain.highpass.dispose();
      chain.lowShelf.dispose();
      chain.dip.dispose();
      chain.highShelf.dispose();
      chain.glue?.dispose();
      chain.trim.dispose();
      chain.meter.dispose();
    }
    this.#roles.clear();

    this.#master?.dispose();
    this.#masterMeter?.dispose();
    this.#limiter?.dispose();
    this.#bank.dispose();
    this.#playing = false;
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error('Cosmophony: this sampled stream has been disposed; create a new one.');
    }
  }
}

/** Build a live sampled player over a prepared session. */
export function createSampledStream(
  plan: SessionPlan,
  lenses: LensConfig,
  manifest: SampleManifest,
  options: SampledStreamOptions = {},
): SampledStream {
  return new ToneSampledStream(plan, lenses, manifest, options);
}

/**
 * Fetch the config the player runs on, then build it.
 *
 * All three files come from `public/samples`, which is what keeps the live app
 * and the offline renderer making the same choices: same instruments, same
 * lanes, same measured trims.
 */
export async function createSampledStreamFromUrl(
  plan: SessionPlan,
  options: SampledStreamOptions = {},
): Promise<SampledStream> {
  const baseUrl = options.baseUrl ?? '/samples';
  const [{ manifest, lenses }, calibration] = await Promise.all([
    loadSampleCatalogue(baseUrl),
    loadCalibration(baseUrl),
  ]);
  return createSampledStream(plan, lenses, manifest, { ...options, baseUrl, calibration });
}
