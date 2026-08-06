/**
 * Layer 3 — the streaming scheduler (Slice A2, the audition).
 *
 * Turns the Living Sky's `ScoreWindow`s into sound with the EXISTING Phase 3.5
 * palette: octave-only partial stacks, a B–V-driven lowpass, twinkle tremolo, the
 * drone bed, and the octave-up shimmer. Deliberately rough clothing — the point
 * of this slice is to let the ear judge the *bones* of the living structure, not
 * the instruments. Samplers and moods are Slice B.
 *
 * THE ONE IMPORTANT PROPERTY: every event carries an absolute piece time, so
 * scheduling is just arithmetic against a fixed origin. Windows can be requested
 * in any size, at any moment, and the result is identical — that is what
 * partition invariance bought, and it is why there is no crossfade, no
 * re-trigger, and no seam at a window boundary.
 *
 * Tone appears here and in `engine.ts` and nowhere else in the project.
 *
 * KNOWN DUPLICATION: the master tail (chorus → widener → reverb → shimmer →
 * limiter) mirrors `engine.ts`. Both read the same tuning constants from
 * `voicing.ts`, so they cannot drift in their *values*, but the wiring exists
 * twice. Slice B rebuilds this layer for samplers and is the right moment to
 * unify them; doing it now would refactor reviewed code with no test coverage
 * over the graph itself.
 */

import * as Tone from 'tone';

import type { AmplitudeBreakpoint, MusicalEvent, SessionPlan } from '../mapping/index.ts';
import { SIDEREAL_DAY_SECONDS, lstAt, renderWindow, toHorizon } from '../mapping/index.ts';
import {
  STYLES,
  midiToFrequency,
  timbreToCutoff,
  timbreToPartials,
  type AudioStyle,
} from './voicing.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * How many chord voices sound at once, on average, over a whole sidereal turn.
 *
 * Without this the mix blows up as the night goes on: the opening has one voice
 * and a later stretch can have twenty, and a fixed per-voice gain sends the sum
 * straight into the limiter. Measured on the first render of the bloom — 6,282
 * clipped samples and a mix pinned at −11 dBFS — which is exactly the failure
 * Phase 3.5 avoided with its `masterGain / sqrt(voices)`.
 *
 * Sampling across a full turn rather than at one instant keeps the level steady
 * for the whole piece, so there is no gain jump when the sky fills or empties.
 */
function meanConcurrentVoices(plan: SessionPlan): number {
  const SAMPLES = 12;
  const period = SIDEREAL_DAY_SECONDS / plan.kappa;
  let total = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const lst = lstAt(plan.lst0, (period * i) / SAMPLES, plan.kappa);
    let up = 0;
    for (const entry of plan.chordStars) {
      if (toHorizon(entry.star, plan.observer.latitude, lst).altitude > 0) up++;
    }
    total += up;
  }
  return total / SAMPLES;
}

/** How far ahead the live player asks for events. */
const DEFAULT_LOOKAHEAD_SECONDS = 20;
/** How often the live player tops up its schedule. */
const TOP_UP_SECONDS = 8;

/**
 * Master level for the streaming mix, calibrated by measuring renders.
 *
 * Set so the FULLEST stretch (the bloom, with the whole sky up) lands near
 * −19 dBFS RMS with headroom under the limiter. The opening deliberately sits
 * about 4 dB quieter — one star against a full sky is the arc doing its job, and
 * flattening that would be levelling away the composition.
 */
const STREAM_MASTER_GAIN = 0.83;
/** Chord voices are the bed; the lead sits above them. */
const CHORD_GAIN = 0.5;
const LEAD_GAIN = 0.62;
const GROUND_GAIN = 0.15;

/** The lead is a struck-glass voice: brighter partials, quick attack, long tail. */
const LEAD_PARTIALS = [1, 0.42, 0, 0.22, 0, 0, 0, 0.09];

/**
 * The figuration is a soft plucked voice — nearer kalimba than bell.
 *
 * Fewer upper octaves than the lead so the weave stays under it, and a gentle
 * attack so it reads as finger-played rather than struck. Slice B replaces this
 * with sampled instruments (the Motorcycle Diaries reference: sparse plucked
 * intimacy); this is deliberately the floor, not the target.
 */
const FIGURATION_PARTIALS = [1, 0.3, 0, 0.1, 0, 0, 0, 0.03];
const FIGURATION_GAIN = 0.5;

interface ActiveVoice {
  sourceId: string;
  endsAt: number;
  meter: Tone.Meter | null;
  dispose(): void;
}

/**
 * Read an amplitude envelope at an arbitrary offset into it.
 *
 * A slice render can begin part-way through a chord voice that has been swelling
 * for minutes, and it must pick up at the level that voice had actually reached.
 */
function envelopeValueAt(envelope: AmplitudeBreakpoint[], offsetSeconds: number): number {
  if (envelope.length === 0) return 1;
  const first = envelope[0] as AmplitudeBreakpoint;
  if (offsetSeconds <= first.atSeconds) return first.amplitude;

  for (let i = 1; i < envelope.length; i++) {
    const previous = envelope[i - 1] as AmplitudeBreakpoint;
    const current = envelope[i] as AmplitudeBreakpoint;
    if (offsetSeconds <= current.atSeconds) {
      const span = current.atSeconds - previous.atSeconds;
      if (span <= 0) return current.amplitude;
      const t = (offsetSeconds - previous.atSeconds) / span;
      return previous.amplitude + t * (current.amplitude - previous.amplitude);
    }
  }
  return (envelope[envelope.length - 1] as AmplitudeBreakpoint).amplitude;
}

export interface StreamEngineOptions {
  style?: AudioStyle;
  lookaheadSeconds?: number;
  /**
   * Attach a level meter to every voice. Needed live (the star-field reads
   * them); pure waste offline, where nobody ever calls `getLevels()`. Each meter
   * is an AnalyserNode, and a long session creates hundreds of notes — so
   * turning them off is the single cheapest way to make a full-length render
   * finish.
   */
  meters?: boolean;
  /**
   * Offline render sample rate. Defaults to the context's own.
   *
   * 32 kHz is transparent for this material (Nyquist 16 kHz, and the shimmer's
   * top octave sits well below that) and costs a third less to render, which
   * matters when the renders are driven from a background browser tab.
   */
  sampleRate?: number;
}

export interface StreamEngine {
  /** Begin at `fromSeconds` of the piece. Must be called from a user gesture. */
  play(fromSeconds?: number): Promise<void>;
  stop(): void;
  dispose(): void;
  /** Per-voice levels, for the Phase 4 star-field. */
  getLevels(): Float32Array;
  /** Which star each level belongs to, in the same order. */
  getLevelSources(): string[];
}

class ToneStreamEngine implements StreamEngine {
  readonly #plan: SessionPlan;
  readonly #style: AudioStyle;
  readonly #lookahead: number;

  #origin = 0;
  #sliceFrom = 0;
  #scheduledTo = 0;
  #playing = false;
  #disposed = false;
  #ticker: ReturnType<typeof setInterval> | undefined;

  #voices: ActiveVoice[] = [];
  #levels = new Float32Array(0);
  #sources: string[] = [];

  // shared tail
  #bus: Tone.Gain | null = null;
  #chorus: Tone.Chorus | null = null;
  #widener: Tone.StereoWidener | null = null;
  #reverb: Tone.Reverb | null = null;
  #master: Tone.Gain | null = null;
  #limiter: Tone.Compressor | null = null;
  #shimmerSend: Tone.Gain | null = null;
  #shimmerShift: Tone.PitchShift | null = null;
  #shimmerTone: Tone.Filter | null = null;
  #shimmerVerb: Tone.Reverb | null = null;
  #shimmerReturn: Tone.Gain | null = null;

  // the ground bed
  #droneA: Tone.Oscillator | null = null;
  #droneB: Tone.Oscillator | null = null;
  #droneFilter: Tone.Filter | null = null;
  #droneGain: Tone.Gain | null = null;

  readonly #voiceScale: number;
  readonly #meters: boolean;

  constructor(plan: SessionPlan, options: StreamEngineOptions = {}) {
    this.#plan = plan;
    this.#style = options.style ?? 'lush';
    this.#lookahead = options.lookaheadSeconds ?? DEFAULT_LOOKAHEAD_SECONDS;
    this.#meters = options.meters ?? true;
    this.#voiceScale = 1 / Math.sqrt(Math.max(1, meanConcurrentVoices(plan)));
  }

  /** A meter, or nothing when they are switched off. */
  #makeMeter(panner: Tone.Panner): Tone.Meter | null {
    if (!this.#meters) return null;
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.85 });
    panner.connect(meter);
    return meter;
  }

  // ------------------------------------------------------------- the graph

  #buildTail(): Tone.Gain {
    if (this.#bus) return this.#bus;
    const dials = STYLES[this.#style] ?? STYLES.lush;

    const limiter = new Tone.Compressor({
      threshold: -1,
      ratio: 20,
      knee: 0,
      attack: 0.003,
      release: 0.05,
    }).toDestination();
    const master = new Tone.Gain(STREAM_MASTER_GAIN).connect(limiter);

    const reverb = new Tone.Reverb({
      decay: dials.reverbDecay,
      preDelay: 0.06,
      wet: dials.reverbWet,
    }).connect(master);
    const widener = new Tone.StereoWidener(dials.stereoWidth).connect(reverb);
    const chorus = new Tone.Chorus({
      frequency: 0.09,
      delayTime: 8,
      depth: dials.chorusDepth,
      wet: dials.chorusWet,
      spread: 0,
    }).connect(widener);
    const bus = new Tone.Gain(1).connect(chorus);

    // The octave-up shimmer, exactly as Phase 3.5 built it: +12 semitones fed
    // back on itself, so the on-scale guarantee survives the haze.
    const shimmerReturn = new Tone.Gain(dials.shimmerReturn).connect(master);
    const shimmerVerb = new Tone.Reverb({ decay: 14, preDelay: 0.02, wet: 1 }).connect(shimmerReturn);
    const shimmerTone = new Tone.Filter({ type: 'lowpass', frequency: 3800, rolloff: -24 }).connect(
      shimmerVerb,
    );
    const shimmerShift = new Tone.PitchShift({
      pitch: 12,
      windowSize: 0.12,
      feedback: dials.shimmerFeedback,
      wet: 1,
    }).connect(shimmerTone);
    const shimmerSend = new Tone.Gain(dials.shimmerSend).connect(shimmerShift);
    bus.connect(shimmerSend);

    this.#limiter = limiter;
    this.#master = master;
    this.#reverb = reverb;
    this.#widener = widener;
    this.#chorus = chorus;
    this.#shimmerReturn = shimmerReturn;
    this.#shimmerVerb = shimmerVerb;
    this.#shimmerTone = shimmerTone;
    this.#shimmerShift = shimmerShift;
    this.#shimmerSend = shimmerSend;
    this.#bus = bus;

    // ---- GROUND: a persistent drone on the session's root
    const droneMidi = this.#groundMidi();
    const droneFrequency = midiToFrequency(droneMidi);
    const droneGain = new Tone.Gain(0).connect(bus);
    const droneFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: clamp(droneFrequency * 6, 180, 14000),
      rolloff: -24,
    }).connect(droneGain);
    const droneA = new Tone.Oscillator({ frequency: droneFrequency, type: 'sine' }).connect(
      droneFilter,
    );
    const droneB = new Tone.Oscillator({
      frequency: droneFrequency * 2,
      type: 'custom',
      partials: timbreToPartials({ warmth: 0.8, brightness: 0.2 }),
      detune: 9,
    }).connect(droneFilter);

    this.#droneGain = droneGain;
    this.#droneFilter = droneFilter;
    this.#droneA = droneA;
    this.#droneB = droneB;

    return bus;
  }

  /** The drone sits an octave under the session root, lifted to stay audible. */
  #groundMidi(): number {
    let midi = this.#plan.rootMidi - 12;
    while (midi < 33) midi += 12;
    return midi;
  }

  // ---------------------------------------------------------- scheduling

  /**
   * Schedule everything sounding in `[from, to)`.
   *
   * Events that began earlier are included and started part-way through, which
   * is what lets a slice render open with the chord bed already in the air
   * rather than in silence.
   */
  #scheduleSpan(from: number, to: number): void {
    const bus = this.#buildTail();
    // Ask from 0 so long-running chord voices that began earlier are visible.
    // Windows are cheap and memoised; correctness beats a micro-optimisation.
    const window = renderWindow(this.#plan, 0, to);

    for (const event of window.events) {
      const end = event.startSeconds + event.durationSeconds;
      if (end <= from || event.startSeconds >= to) continue;
      this.#scheduleEvent(event, from, to, bus);
    }
    this.#scheduledTo = Math.max(this.#scheduledTo, to);
  }

  #scheduleEvent(event: MusicalEvent, from: number, to: number, bus: Tone.Gain): void {
    const startsAt = Math.max(event.startSeconds, from);
    const endsAt = Math.min(event.startSeconds + event.durationSeconds, to);
    if (!(endsAt > startsAt)) return;

    const when = this.#origin + (startsAt - this.#sliceFrom);
    const duration = endsAt - startsAt;
    const offset = startsAt - event.startSeconds;

    switch (event.role) {
      case 'ground':
        this.#scheduleGround(event, when, duration, offset);
        return;
      case 'weather':
        this.#scheduleWeather(event, when, duration, offset);
        return;
      case 'chord':
        this.#scheduleChord(event, when, duration, offset, bus);
        return;
      case 'lead':
        this.#scheduleLead(event, when, duration, bus);
        return;
      case 'figuration':
        this.#scheduleFiguration(event, when, duration, bus);
        return;
      default:
        return;
    }
  }

  /** GROUND: the bed never restarts; its level follows the arc. */
  #scheduleGround(event: MusicalEvent, when: number, duration: number, offset: number): void {
    const gain = this.#droneGain;
    if (!gain) return;
    const envelope = event.envelope ?? [];
    gain.gain.setValueAtTime(GROUND_GAIN * envelopeValueAt(envelope, offset), when);
    for (const point of envelope) {
      if (point.atSeconds <= offset) continue;
      const at = when + (point.atSeconds - offset);
      if (at > when + duration) break;
      gain.gain.linearRampToValueAtTime(GROUND_GAIN * point.amplitude, at);
    }
  }

  /** WEATHER: the arc's swell, applied to the shimmer send and the reverb wet. */
  #scheduleWeather(event: MusicalEvent, when: number, duration: number, offset: number): void {
    const dials = STYLES[this.#style] ?? STYLES.lush;
    const send = this.#shimmerSend;
    const reverb = this.#reverb;
    const envelope = event.envelope ?? [];

    const apply = (param: Tone.Param<'normalRange'> | Tone.Param<'gain'>, scale: number): void => {
      param.setValueAtTime(scale * (0.45 + 0.55 * envelopeValueAt(envelope, offset)), when);
      for (const point of envelope) {
        if (point.atSeconds <= offset) continue;
        const at = when + (point.atSeconds - offset);
        if (at > when + duration) break;
        param.linearRampToValueAtTime(scale * (0.45 + 0.55 * point.amplitude), at);
      }
    };

    if (send) apply(send.gain as unknown as Tone.Param<'gain'>, dials.shimmerSend);
    if (reverb) apply(reverb.wet as unknown as Tone.Param<'normalRange'>, dials.reverbWet);
  }

  /**
   * CHORD: a sustained star voice that swells with the star's altitude.
   *
   * The synth's own envelope stays out of the way — the horizon fade lives on a
   * gain node driven by the score's breakpoints, so the swell is the sky's, not
   * an ADSR's.
   */
  #scheduleChord(
    event: MusicalEvent,
    when: number,
    duration: number,
    offset: number,
    bus: Tone.Gain,
  ): void {
    const frequency = midiToFrequency(event.midi);

    const panner = new Tone.Panner(clamp(event.pan, -1, 1)).connect(bus);
    const meter = this.#makeMeter(panner);

    const swell = new Tone.Gain(0).connect(panner);
    const tremolo = new Tone.Gain(1).connect(swell);
    const lfo = new Tone.LFO({
      frequency: 0.06 + 0.22 * event.twinkle,
      min: 1 - 0.3 * event.twinkle,
      max: 1,
      phase: (event.midi * 37) % 360,
    });
    lfo.connect(tremolo.gain);

    const filter = new Tone.Filter({
      type: 'lowpass',
      frequency: timbreToCutoff(frequency, event.timbre),
      rolloff: -12,
      Q: 0.7,
    }).connect(tremolo);

    const synth = new Tone.Synth({
      oscillator: { type: 'custom', partials: timbreToPartials(event.timbre) },
      envelope: { attack: 1.2, attackCurve: 'sine', decay: 0.1, sustain: 1, release: 4, releaseCurve: 'sine' },
      volume: Tone.gainToDb(clamp(event.amplitude, 0, 1) * CHORD_GAIN * this.#voiceScale),
    }).connect(filter);

    // The score's own swell.
    const envelope = event.envelope ?? [];
    swell.gain.setValueAtTime(envelopeValueAt(envelope, offset), when);
    for (const point of envelope) {
      if (point.atSeconds <= offset) continue;
      const at = when + (point.atSeconds - offset);
      if (at > when + duration) break;
      swell.gain.linearRampToValueAtTime(point.amplitude, at);
    }

    lfo.start(when);
    synth.triggerAttack(frequency, when);
    synth.triggerRelease(when + duration);
    lfo.stop(when + duration + 4);

    this.#track({
      sourceId: event.sourceId,
      endsAt: when + duration + 6,
      meter,
      dispose: () => {
        lfo.dispose();
        synth.dispose();
        filter.dispose();
        tremolo.dispose();
        swell.dispose();
        panner.dispose();
        meter?.dispose();
      },
    });
  }

  /** LEAD: a struck-glass chime. Short attack, long ring, then gone. */
  #scheduleLead(event: MusicalEvent, when: number, duration: number, bus: Tone.Gain): void {
    const frequency = midiToFrequency(event.midi);

    const panner = new Tone.Panner(clamp(event.pan, -1, 1)).connect(bus);
    const meter = this.#makeMeter(panner);

    const filter = new Tone.Filter({
      type: 'lowpass',
      frequency: clamp(frequency * 9, 400, 14000),
      rolloff: -12,
      Q: 0.9,
    }).connect(panner);

    const synth = new Tone.Synth({
      oscillator: { type: 'custom', partials: LEAD_PARTIALS },
      envelope: {
        attack: 0.06,
        attackCurve: 'exponential',
        decay: duration * 0.8,
        sustain: 0.12,
        release: Math.max(2.5, duration * 0.6),
        releaseCurve: 'exponential',
      },
      volume: Tone.gainToDb(clamp(event.amplitude, 0, 1) * LEAD_GAIN),
    }).connect(filter);

    synth.triggerAttackRelease(frequency, duration, when);

    this.#track({
      sourceId: event.sourceId,
      endsAt: when + duration + 6,
      meter,
      dispose: () => {
        synth.dispose();
        filter.dispose();
        panner.dispose();
        meter?.dispose();
      },
    });
  }

  /**
   * FIGURATION: the meso weave. A soft pluck that decays quickly enough to leave
   * room, sitting under both the lead and the chord.
   */
  #scheduleFiguration(event: MusicalEvent, when: number, duration: number, bus: Tone.Gain): void {
    const frequency = midiToFrequency(event.midi);

    const panner = new Tone.Panner(clamp(event.pan, -1, 1)).connect(bus);
    const meter = this.#makeMeter(panner);

    const filter = new Tone.Filter({
      type: 'lowpass',
      frequency: clamp(frequency * 6, 320, 11000),
      rolloff: -12,
      Q: 0.6,
    }).connect(panner);

    const synth = new Tone.Synth({
      oscillator: { type: 'custom', partials: FIGURATION_PARTIALS },
      envelope: {
        attack: 0.012,
        attackCurve: 'exponential',
        decay: Math.max(0.4, duration * 0.7),
        sustain: 0.05,
        release: Math.max(0.8, duration * 0.5),
        releaseCurve: 'exponential',
      },
      volume: Tone.gainToDb(clamp(event.amplitude, 0, 1) * FIGURATION_GAIN * this.#voiceScale),
    }).connect(filter);

    synth.triggerAttackRelease(frequency, duration, when);

    this.#track({
      sourceId: event.sourceId,
      endsAt: when + duration + 3,
      meter,
      dispose: () => {
        synth.dispose();
        filter.dispose();
        panner.dispose();
        meter?.dispose();
      },
    });
  }

  #track(voice: ActiveVoice): void {
    this.#voices.push(voice);
  }

  // ------------------------------------------------------------- playback

  async play(fromSeconds = 0): Promise<void> {
    this.#assertLive();
    if (this.#playing) return;

    await Tone.start();
    this.#buildTail();
    if (this.#reverb) await this.#reverb.ready;
    if (this.#shimmerVerb) await this.#shimmerVerb.ready;

    this.#sliceFrom = fromSeconds;
    this.#origin = Tone.now() + 0.15;
    this.#scheduledTo = fromSeconds;

    this.#chorus?.start(this.#origin);
    this.#droneA?.start(this.#origin);
    this.#droneB?.start(this.#origin);

    this.#scheduleSpan(fromSeconds, fromSeconds + this.#lookahead);
    this.#playing = true;

    // Top up ahead of the playhead, and retire voices that have finished.
    this.#ticker = setInterval(() => {
      if (!this.#playing || this.#disposed) return;
      const elapsed = Tone.now() - this.#origin;
      const playhead = this.#sliceFrom + elapsed;
      if (this.#scheduledTo - playhead < this.#lookahead) {
        this.#scheduleSpan(this.#scheduledTo, this.#scheduledTo + this.#lookahead);
      }
      this.#retire(Tone.now());
    }, TOP_UP_SECONDS * 1000);
  }

  /** Schedule a whole span at once — what an offline render needs. */
  scheduleWhole(fromSeconds: number, toSeconds: number, originTime: number): void {
    this.#buildTail();
    this.#sliceFrom = fromSeconds;
    this.#origin = originTime;
    this.#chorus?.start(originTime);
    this.#droneA?.start(originTime);
    this.#droneB?.start(originTime);
    this.#scheduleSpan(fromSeconds, toSeconds);
    this.#playing = true;
  }

  async ready(): Promise<void> {
    this.#buildTail();
    if (this.#reverb) await this.#reverb.ready;
    if (this.#shimmerVerb) await this.#shimmerVerb.ready;
  }

  #retire(now: number): void {
    const keep: ActiveVoice[] = [];
    for (const voice of this.#voices) {
      if (voice.endsAt < now) voice.dispose();
      else keep.push(voice);
    }
    this.#voices = keep;
  }

  stop(): void {
    this.#assertLive();
    if (!this.#playing) return;
    if (this.#ticker !== undefined) clearInterval(this.#ticker);
    this.#ticker = undefined;

    const now = Tone.now();
    this.#droneGain?.gain.cancelScheduledValues(now);
    this.#droneGain?.gain.rampTo(0, 3, now);
    this.#droneA?.stop(now + 3.2);
    this.#droneB?.stop(now + 3.2);
    for (const voice of this.#voices) voice.dispose();
    this.#voices = [];
    this.#playing = false;
  }

  getLevels(): Float32Array {
    if (this.#disposed) return new Float32Array(0);
    if (this.#levels.length !== this.#voices.length) {
      this.#levels = new Float32Array(this.#voices.length);
      this.#sources = this.#voices.map((v) => v.sourceId);
    }
    for (let i = 0; i < this.#voices.length; i++) {
      const value = this.#voices[i]?.meter?.getValue();
      this.#levels[i] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    return this.#levels;
  }

  getLevelSources(): string[] {
    return this.#sources;
  }

  dispose(): void {
    if (this.#disposed) return;
    if (this.#ticker !== undefined) clearInterval(this.#ticker);
    for (const voice of this.#voices) voice.dispose();
    this.#voices = [];

    this.#droneA?.dispose();
    this.#droneB?.dispose();
    this.#droneFilter?.dispose();
    this.#droneGain?.dispose();
    this.#bus?.dispose();
    this.#chorus?.dispose();
    this.#widener?.dispose();
    this.#reverb?.dispose();
    this.#shimmerSend?.dispose();
    this.#shimmerShift?.dispose();
    this.#shimmerTone?.dispose();
    this.#shimmerVerb?.dispose();
    this.#shimmerReturn?.dispose();
    this.#master?.dispose();
    this.#limiter?.dispose();

    this.#playing = false;
    this.#disposed = true;
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error('Cosmophony: this stream engine has been disposed; create a new one.');
    }
  }
}

/** Construct a streaming engine over a prepared session. */
export function createStreamEngine(
  plan: SessionPlan,
  options: StreamEngineOptions = {},
): StreamEngine {
  return new ToneStreamEngine(plan, options);
}

/**
 * Render a slice of the living piece offline, faster than real time.
 *
 * `fromSeconds` may land anywhere: chord voices already sounding are started
 * part-way through their swell, so a bloom clip opens with the bed in the air.
 */
export async function renderStreamOffline(
  plan: SessionPlan,
  fromSeconds: number,
  toSeconds: number,
  options: StreamEngineOptions = {},
): Promise<AudioBuffer> {
  const duration = toSeconds - fromSeconds;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Cosmophony: render span must be positive, got [${fromSeconds}, ${toSeconds}).`);
  }

  // Deliberately NOT `Tone.Offline`.
  //
  // `Tone.Offline` calls `OfflineContext.render()` with `asynchronous = true`,
  // which yields to `setTimeout(done, 1)` every render block. `setTimeout` is
  // precisely what Chrome throttles in a background tab — under intensive
  // throttling it fires about once a minute, so a render that should take two
  // minutes never finishes. That is what defeated every attempt to produce a
  // full-length clip in Slice A2, and the diagnosis was a guess until the
  // `_renderClock` source confirmed it.
  //
  // Rendering synchronously skips the yields entirely: immune to timer
  // throttling and faster, at the cost of blocking the main thread while it
  // works. For an offline render that is exactly the trade we want.
  const original = Tone.getContext();
  const context = new Tone.OfflineContext(
    2,
    duration,
    options.sampleRate ?? original.sampleRate,
  );
  Tone.setContext(context);

  let rendered: Tone.ToneAudioBuffer;
  try {
    const engine = new ToneStreamEngine(plan, { meters: false, ...options });
    await engine.ready();
    engine.scheduleWhole(fromSeconds, toSeconds, 0);
    rendered = await context.render(false);
  } finally {
    Tone.setContext(original);
  }

  return rendered.get() as AudioBuffer;
}
