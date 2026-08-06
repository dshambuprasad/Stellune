/**
 * Layer 3 — the Tone.js graph. THE ONLY FILE IN THE PROJECT THAT IMPORTS TONE.
 *
 * `test/boundaries.test.ts` fails the build if that stops being true.
 *
 * The graph:
 *
 *      drone osc ×2 (detuned, drifting) → filter → gain ──┐
 *        ▲ breath LFO      ▲ sweep LFO   ▲ drift LFO      │
 *                                                          ├→ bus ─┬→ chorus → widener → reverb → master → limiter → out
 *      voice synth → lowpass → twinkle gain → panner ──────┘       │                                ▲
 *        (octave-only partials)  ▲ twinkle LFO                     │                                │
 *                                                                  └→ shimmer send → pitch +12 ──┐  │
 *                                                                       ▲                        │  │
 *                                                                       └── feedback ── lowpass ←┘  │
 *                                                                                          ↓        │
 *                                                                                    long reverb ───┘
 *
 * Every number in it comes from `planAudio()`, which is pure and tested. This
 * file's only job is wiring, lifecycle, and the browser's autoplay rules.
 *
 * Seamless looping: every LFO runs at a whole number of cycles per
 * `loopSeconds`, so at the end of a loop each one is exactly where it started.
 * The loop is seamless by construction — there is no crossfade and no retrigger.
 * v1 is one sustained chord that breathes, so nothing has to restart at all.
 */

import * as Tone from 'tone';

import type { MusicalScore } from '../mapping/index.ts';
import { planAudio, type AudioPlan, type AudioStyle, type VoicePlan } from './voicing.ts';
import type { AudioEngine } from './types.ts';

/** Everything belonging to one sounding star, kept together so it can be freed. */
interface Voice {
  plan: VoicePlan;
  synth: Tone.Synth;
  filter: Tone.Filter;
  tremolo: Tone.Gain;
  lfo: Tone.LFO;
  panner: Tone.Panner;
  meter: Tone.Meter;
}

class ToneAudioEngine implements AudioEngine {
  readonly #style: AudioStyle;
  #plan: AudioPlan | null = null;

  constructor(style: AudioStyle = 'lush') {
    this.#style = style;
  }

  #voices: Voice[] = [];
  #levels = new Float32Array(0);
  #playing = false;
  #disposed = false;

  // Shared tail of the graph, built once and reused across loads.
  #bus: Tone.Gain | null = null;
  #chorus: Tone.Chorus | null = null;
  #widener: Tone.StereoWidener | null = null;
  #reverb: Tone.Reverb | null = null;
  #master: Tone.Gain | null = null;
  #limiter: Tone.Compressor | null = null;

  // The shimmer path: an octave-up feedback haze hung off the same bus.
  #shimmerSend: Tone.Gain | null = null;
  #shimmerShift: Tone.PitchShift | null = null;
  #shimmerTone: Tone.Filter | null = null;
  #shimmerVerb: Tone.Reverb | null = null;
  #shimmerReturn: Tone.Gain | null = null;

  // The drone bed.
  #droneOscA: Tone.Oscillator | null = null;
  #droneOscB: Tone.Oscillator | null = null;
  #droneFilter: Tone.Filter | null = null;
  #droneGain: Tone.Gain | null = null;
  #droneBreath: Tone.LFO | null = null;
  #droneSweep: Tone.LFO | null = null;
  #droneDrift: Tone.LFO | null = null;

  // ------------------------------------------------------------- loading

  load(score: MusicalScore): void {
    this.#assertLive();
    if (this.#playing) this.stop();

    this.#teardownVoices();
    this.#teardownDrone();

    const plan = planAudio(score, this.#style);
    this.#plan = plan;

    const bus = this.#ensureTail();

    // ---- the drone bed: two detuned oscillators under a slow filter sweep
    const droneGain = new Tone.Gain(0).connect(bus);
    const droneFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: plan.drone.filterHz,
      rolloff: -24,
    }).connect(droneGain);

    const droneOscA = new Tone.Oscillator({
      frequency: plan.drone.frequency,
      type: 'sine',
    }).connect(droneFilter);
    // The body oscillator sits an octave above the weight, so the bed still has
    // a pitch on speakers that cannot reproduce ~55 Hz at all. Its slight detune
    // against the weight's harmonic gives the bed a slow, living beat.
    const droneOscB = new Tone.Oscillator({
      frequency: plan.drone.bodyFrequency,
      type: 'custom',
      partials: plan.drone.partials,
      detune: plan.drone.detuneCents,
    }).connect(droneFilter);

    // Breathing: the bed swells and recedes once per loop.
    const droneBreath = new Tone.LFO({
      frequency: plan.drone.breathHz,
      min: plan.drone.gain * (1 - plan.drone.breathDepth),
      max: plan.drone.gain,
    });
    droneBreath.connect(droneGain.gain);

    // …and opens its filter twice per loop, a half-cycle out of step.
    const droneSweep = new Tone.LFO({
      frequency: plan.drone.filterSweepHz,
      min: plan.drone.filterHz * 0.6,
      max: plan.drone.filterHz * 1.4,
      phase: 90,
    });
    droneSweep.connect(droneFilter.frequency);

    // The body's detune wanders slowly, so the beat against the weight never
    // settles into a pattern the ear can predict.
    const droneDrift = new Tone.LFO({
      frequency: plan.drone.driftHz,
      min: plan.drone.detuneCents - plan.drone.driftCents,
      max: plan.drone.detuneCents + plan.drone.driftCents,
      phase: 180,
    });
    droneDrift.connect(droneOscB.detune);

    this.#droneDrift = droneDrift;
    this.#droneGain = droneGain;
    this.#droneFilter = droneFilter;
    this.#droneOscA = droneOscA;
    this.#droneOscB = droneOscB;
    this.#droneBreath = droneBreath;
    this.#droneSweep = droneSweep;

    // ---- one voice per star
    this.#voices = plan.voices.map((voicePlan) => this.#buildVoice(voicePlan, bus));
    this.#levels = new Float32Array(this.#voices.length);
  }

  #buildVoice(plan: VoicePlan, bus: Tone.Gain): Voice {
    const panner = new Tone.Panner(plan.pan).connect(bus);

    // A meter per voice, so Phase 4 can glow each star in time with its own tone.
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.85 });
    panner.connect(meter);

    // Tremolo lives in its own gain node rather than on the synth's output, so
    // the LFO can be started and stopped independently of the note.
    const tremolo = new Tone.Gain(1).connect(panner);

    const lfo = new Tone.LFO({
      frequency: plan.twinkleHz,
      min: 1 - plan.twinkleDepth,
      max: 1,
      phase: plan.twinklePhase,
    });
    lfo.connect(tremolo.gain);

    const filter = new Tone.Filter({
      type: 'lowpass',
      frequency: plan.filterHz,
      rolloff: -12,
      Q: 0.7,
    }).connect(tremolo);

    // An octave-only partial stack plus a lowpass gives the struck-glass core;
    // the cutoff (from B-V) is what moves it between wooden and glassy. Using
    // only octave partials means every frequency this voice can produce is the
    // same pitch class as the note the sky chose — see `timbreToPartials`.
    const synth = new Tone.Synth({
      oscillator: { type: 'custom', partials: plan.partials },
      envelope: {
        attack: plan.attackSeconds,
        attackCurve: 'sine',
        decay: 0.1,
        sustain: 1,
        release: plan.releaseSeconds,
        releaseCurve: 'sine',
      },
      volume: Tone.gainToDb(plan.gain),
    }).connect(filter);

    return { plan, synth, filter, tremolo, lfo, panner, meter };
  }

  /** Build the shared tail once; loading a new score reuses it. */
  #ensureTail(): Tone.Gain {
    if (this.#bus) return this.#bus;

    // A true safety limiter, not a glue compressor.
    //
    // `Tone.Limiter` leaves `knee` at Web Audio's default of 30 dB, so it starts
    // compressing far below its threshold — measurably ~1.8 dB of reduction on a
    // mix peaking at −10 dBFS, which flattens exactly the slow breathing this
    // piece is made of. A zero knee means it does nothing at all until a stray
    // peak actually approaches full scale.
    const limiter = new Tone.Compressor({
      threshold: -1,
      ratio: 20,
      knee: 0,
      attack: 0.003,
      release: 0.05,
    }).toDestination();
    const master = new Tone.Gain(1).connect(limiter);
    const reverb = new Tone.Reverb({
      decay: REVERB_FALLBACK.decaySeconds,
      preDelay: REVERB_FALLBACK.preDelay,
      wet: REVERB_FALLBACK.wet,
    }).connect(master);
    const widener = new Tone.StereoWidener(REVERB_FALLBACK.width).connect(reverb);
    const chorus = new Tone.Chorus({
      frequency: REVERB_FALLBACK.chorusHz,
      delayTime: REVERB_FALLBACK.chorusDelayMs,
      depth: REVERB_FALLBACK.chorusDepth,
      wet: REVERB_FALLBACK.chorusWet,
      // Spread 0, not the usual 180.
      //
      // With the channels modulated in opposite phase the two delay lines comb
      // left and right differently, which on an input the sky has already placed
      // off-centre adds a standing level difference of its own — about 0.7 dB on
      // this sky. Small, but the stereo image is the score's to decide and not
      // the chorus's, so both channels get identical modulation. Width still
      // comes from the panner and the widener, where it is answerable to the
      // real azimuths.
      spread: 0,
    }).connect(widener);
    const bus = new Tone.Gain(1).connect(chorus);

    // ---- the shimmer path
    //
    // A parallel send is pitch-shifted up an octave and fed back into the
    // shifter, so each pass climbs another octave, then poured into a long
    // reverb. Tails rise instead of just fading. Every step is +12 semitones —
    // the same pitch class — so nothing off-scale can appear no matter how many
    // times the cascade goes round.
    //
    // The lowpass sits between the shifter's output and the reverb, which also
    // tames the grain noise a granular shifter produces at high feedback.
    const shimmerReturn = new Tone.Gain(0).connect(master);
    const shimmerVerb = new Tone.Reverb({
      decay: REVERB_FALLBACK.shimmerDecay,
      preDelay: 0.02,
      wet: 1,
    }).connect(shimmerReturn);
    const shimmerTone = new Tone.Filter({
      type: 'lowpass',
      frequency: REVERB_FALLBACK.shimmerToneHz,
      rolloff: -24,
    }).connect(shimmerVerb);
    const shimmerShift = new Tone.PitchShift({
      pitch: REVERB_FALLBACK.shimmerPitch,
      windowSize: REVERB_FALLBACK.shimmerWindow,
      feedback: 0,
      wet: 1,
    }).connect(shimmerTone);
    const shimmerSend = new Tone.Gain(0).connect(shimmerShift);
    bus.connect(shimmerSend);

    this.#limiter = limiter;
    this.#master = master;
    this.#reverb = reverb;
    this.#widener = widener;
    this.#chorus = chorus;
    this.#shimmerSend = shimmerSend;
    this.#shimmerShift = shimmerShift;
    this.#shimmerTone = shimmerTone;
    this.#shimmerVerb = shimmerVerb;
    this.#shimmerReturn = shimmerReturn;
    this.#bus = bus;
    return bus;
  }

  // ------------------------------------------------------------ playback

  /**
   * Start the sound.
   *
   * MUST be called from a user gesture: browsers keep the audio context
   * suspended until one, and `Tone.start()` is what resumes it. Calling this
   * from a timer or on page load will silently produce nothing.
   */
  async play(): Promise<void> {
    this.#assertLive();
    if (!this.#plan) {
      throw new Error('Cosmophony: call load(score) before play().');
    }
    if (this.#playing) return;

    await Tone.start();

    // Tone.Reverb synthesises its impulse response asynchronously; without this
    // the first second or so would be dry.
    if (this.#reverb) await this.#reverb.ready;

    // Apply the plan's mix settings now that the tail definitely exists.
    const plan = this.#plan;
    if (this.#master) this.#master.gain.value = plan.masterGain;
    if (this.#widener) this.#widener.width.value = plan.stereoWidth;
    if (this.#reverb) {
      this.#reverb.decay = plan.reverb.decaySeconds;
      this.#reverb.preDelay = plan.reverb.preDelay;
      this.#reverb.wet.value = plan.reverb.wet;
    }
    if (this.#chorus) {
      this.#chorus.frequency.value = plan.chorus.frequency;
      this.#chorus.delayTime = plan.chorus.delayMs;
      this.#chorus.depth = plan.chorus.depth;
      this.#chorus.wet.value = plan.chorus.wet;
    }
    if (this.#shimmerShift) {
      this.#shimmerShift.pitch = plan.shimmer.pitchSemitones;
      this.#shimmerShift.windowSize = plan.shimmer.windowSize;
      this.#shimmerShift.feedback.value = plan.shimmer.feedback;
    }
    if (this.#shimmerTone) this.#shimmerTone.frequency.value = plan.shimmer.toneHz;
    if (this.#shimmerVerb) {
      this.#shimmerVerb.decay = plan.shimmer.decaySeconds;
      await this.#shimmerVerb.ready;
    }
    if (this.#shimmerSend) this.#shimmerSend.gain.value = plan.shimmer.send;
    if (this.#shimmerReturn) this.#shimmerReturn.gain.value = plan.shimmer.returnGain;

    const now = Tone.now();

    this.#chorus?.start(now);
    this.#droneOscA?.start(now);
    this.#droneOscB?.start(now);
    this.#droneBreath?.start(now);
    this.#droneSweep?.start(now);
    this.#droneDrift?.start(now);

    for (const voice of this.#voices) {
      // LFOs run from the top so their whole-cycles-per-loop alignment is
      // measured from one shared origin; only the note waits its turn.
      voice.lfo.start(now);
      voice.synth.triggerAttack(voice.plan.frequency, now + voice.plan.startDelaySeconds);
    }

    this.#playing = true;
  }

  /** Fade out and silence, but keep the graph loaded so play() can resume it. */
  stop(): void {
    this.#assertLive();
    if (!this.#playing) return;

    const now = Tone.now();

    for (const voice of this.#voices) {
      voice.synth.triggerRelease(now);
      voice.lfo.stop(now + voice.plan.releaseSeconds);
    }

    // Let the drone fall away over the same span rather than cutting.
    const release = this.#voices[0]?.plan.releaseSeconds ?? 2;
    this.#droneBreath?.stop(now);
    this.#droneGain?.gain.rampTo(0, release, now);
    this.#droneOscA?.stop(now + release);
    this.#droneOscB?.stop(now + release);
    this.#droneSweep?.stop(now + release);
    this.#droneDrift?.stop(now + release);

    // Close the shimmer send so the haze stops regenerating and simply decays.
    this.#shimmerSend?.gain.rampTo(0, release, now);

    this.#playing = false;
  }

  /**
   * Per-voice output levels in 0..1, in the same order as `score.events`.
   *
   * Reuses one array rather than allocating on every animation frame — Phase 4
   * calls this at 60 Hz.
   */
  getLevels(): Float32Array {
    if (this.#disposed) return new Float32Array(0);
    for (let i = 0; i < this.#voices.length; i++) {
      const value = this.#voices[i]?.meter.getValue();
      this.#levels[i] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    return this.#levels;
  }

  // ------------------------------------------------------------- teardown

  dispose(): void {
    if (this.#disposed) return;
    this.#teardownVoices();
    this.#teardownDrone();

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

    this.#bus = null;
    this.#chorus = null;
    this.#widener = null;
    this.#reverb = null;
    this.#shimmerSend = null;
    this.#shimmerShift = null;
    this.#shimmerTone = null;
    this.#shimmerVerb = null;
    this.#shimmerReturn = null;
    this.#master = null;
    this.#limiter = null;

    this.#plan = null;
    this.#levels = new Float32Array(0);
    this.#playing = false;
    this.#disposed = true;
  }

  #teardownVoices(): void {
    for (const voice of this.#voices) {
      voice.lfo.dispose();
      voice.synth.dispose();
      voice.filter.dispose();
      voice.tremolo.dispose();
      voice.panner.dispose();
      voice.meter.dispose();
    }
    this.#voices = [];
    this.#levels = new Float32Array(0);
  }

  #teardownDrone(): void {
    this.#droneBreath?.dispose();
    this.#droneSweep?.dispose();
    this.#droneDrift?.dispose();
    this.#droneOscA?.dispose();
    this.#droneOscB?.dispose();
    this.#droneFilter?.dispose();
    this.#droneGain?.dispose();

    this.#droneBreath = null;
    this.#droneSweep = null;
    this.#droneDrift = null;
    this.#droneOscA = null;
    this.#droneOscB = null;
    this.#droneFilter = null;
    this.#droneGain = null;
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error('Cosmophony: this AudioEngine has been disposed; create a new one.');
    }
  }
}

/**
 * Defaults for the shared tail, which is built before any score is loaded.
 * `play()` overwrites them from the plan.
 */
const REVERB_FALLBACK = {
  decaySeconds: 9,
  preDelay: 0.06,
  wet: 0.42,
  width: 0.7,
  chorusHz: 0.11,
  chorusDelayMs: 8,
  chorusDepth: 0.4,
  chorusWet: 0.3,
  shimmerPitch: 12,
  shimmerWindow: 0.12,
  shimmerDecay: 14,
  shimmerToneHz: 3800,
};

/**
 * Construct the Tone.js-backed engine.
 *
 * `style` picks how heavily the shimmer and the long tails are leaned on. It
 * changes only the dressing — never a pitch, a pan, an amplitude, or which stars
 * sound. Those come from the score and are not this layer's to touch.
 */
export function createAudioEngine(style: AudioStyle = 'lush'): AudioEngine {
  return new ToneAudioEngine(style);
}

/**
 * Render a score to an AudioBuffer offline, faster than real time.
 *
 * Lives here rather than in the caller because this layer owns Tone entirely —
 * `Tone.Offline` is a Tone API, and letting a harness or an exporter reach for
 * it directly would put Tone above the audio layer. (The Phase 3 boundary test
 * caught exactly that mistake and was right to.)
 *
 * The offline graph is built by the same `load`/`play` path as the live one, so
 * what is rendered is what is heard — and because every value comes from the
 * deterministic plan, the same score always renders to the same audio.
 */
export async function renderOffline(
  score: MusicalScore,
  seconds: number,
  style: AudioStyle = 'lush',
): Promise<AudioBuffer> {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Cosmophony: render length must be greater than 0, got ${seconds}.`);
  }
  const rendered = await Tone.Offline(async () => {
    const engine = new ToneAudioEngine(style);
    engine.load(score);
    await engine.play();
  }, seconds);
  return rendered.get() as AudioBuffer;
}
