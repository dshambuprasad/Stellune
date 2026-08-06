/**
 * Layer 3 — voicing: every synthesis *decision*, with no Tone.js in sight.
 *
 * The audio layer splits in two. This half turns a `MusicalScore` into a plain,
 * serializable `AudioPlan`: frequencies, gains, filter cutoffs, LFO rates. It is
 * pure, so all the taste in the sound design can be unit-tested in Node. The
 * other half (`engine.ts`) only wires Tone nodes to these numbers.
 *
 * Nothing here is physically claimed. Phase 2 decided *what* is true about the
 * sky; this file decides how it is dressed, and the UI says so plainly.
 */

import type { MusicalScore, TimbreParams } from '../mapping/index.ts';

// ------------------------------------------------------------ the dials

/** Concert A. */
const A4_HZ = 440;
const A4_MIDI = 69;

/**
 * The drone's weight sits this far below the score's root.
 *
 * One octave, not two. Two octaves below A2 is A0 at 27.5 Hz — near the bottom
 * of human hearing and reproduced by essentially no laptop or phone speaker, so
 * the bed would simply vanish for most listeners. A1 at 55 Hz is felt on decent
 * speakers, and the body oscillator an octave above it (below) carries the pitch
 * everywhere else.
 */
const DRONE_OCTAVES_BELOW = 1;

/**
 * Lowest MIDI note the drone's weight may occupy — A1, 55 Hz.
 *
 * Pitch classes below A in the octave (C, D, E…) would otherwise land in the
 * 30 Hz region, which most speakers simply do not produce. When that happens the
 * bed is transposed up by a whole octave: the key is unchanged, only the
 * register moves.
 */
const DRONE_MIN_MIDI = 33;

/**
 * Slow fades. A chord that arrives instantly sounds like a keyboard; one that
 * takes a few seconds to bloom sounds like a place you walked into.
 *
 * The brightest star leads and the rest follow, so the chord assembles the way
 * stars actually appear at dusk rather than landing as a block. Both numbers are
 * per-voice-index, so the ordering is the score's own brightness ordering.
 */
const VOICE_ATTACK_SECONDS = 4.5;
const VOICE_ATTACK_SPREAD = 0.32;
const VOICE_STAGGER_SECONDS = 0.7;
const VOICE_RELEASE_SECONDS = 8;

/** Per-voice level before the master stage. Leaves room for eight of them. */
const VOICE_GAIN = 0.22;

/** The drone is felt more than heard. */
const DRONE_GAIN = 0.13;

/**
 * Lowpass cutoff as a multiple of each voice's own fundamental, so high voices
 * are not dulled by an absolute ceiling. Cool red stars keep only the first
 * couple of partials (round, wooden); hot blue stars keep a dozen (glassy).
 */
const CUTOFF_HARMONICS_WARM = 2.2;
const CUTOFF_HARMONICS_BRIGHT = 12;
const CUTOFF_MIN_HZ = 180;
const CUTOFF_MAX_HZ = 14000;

/** Tremolo depth at twinkle = 1. Full depth would chop; this shimmers. */
const TWINKLE_MAX_DEPTH = 0.34;

/**
 * Twinkle rates, in whole cycles per loop.
 *
 * Whole numbers are the point: an LFO that completes an integer number of cycles
 * per loop is at exactly the same place at the end of the loop as at the start,
 * so the loop is seamless *by construction* rather than by crossfade. The values
 * are mutually prime-ish so the voices drift in and out of phase with each other
 * across the loop instead of pulsing together.
 */
const TWINKLE_CYCLES = [5, 7, 9, 11, 13, 17, 19, 23] as const;

/** The drone breathes once per loop, with its filter opening twice. */
const DRONE_BREATH_CYCLES = 1;
const DRONE_FILTER_CYCLES = 2;
const DRONE_BREATH_DEPTH = 0.35;

/** Two slightly detuned drone oscillators beat slowly against each other. */
const DRONE_DETUNE_CENTS = 9;

/** …and that detune itself wanders, so the beat never settles into a pattern. */
const DRONE_DRIFT_CENTS = 7;
const DRONE_DRIFT_CYCLES = 1;

/** A large, slow space. Vastness comes from decay length, not from wetness. */
const REVERB_PRE_DELAY = 0.06;

/**
 * Shimmer — the largest single lever on "wonder".
 *
 * A send is pitch-shifted up an OCTAVE and fed back into itself, so each
 * repetition climbs another octave into a long reverb: tails bloom upward into a
 * haze instead of simply decaying. The octave is not an aesthetic preference, it
 * is a correctness requirement — +12 semitones is the same pitch class, so the
 * mapping layer's guarantee that nothing off-scale can sound survives intact. A
 * shimmer at +7 (the more common choice) would inject a fifth, which in A
 * minor-pentatonic means a B that the sky never put there.
 *
 * The feedback path is lowpassed, both to stop the cascade turning into hiss and
 * because distant light really does arrive dimmer at the top end.
 */
const SHIMMER_PITCH_SEMITONES = 12;
const SHIMMER_WINDOW = 0.12;
const SHIMMER_DECAY_SECONDS = 14;
const SHIMMER_TONE_HZ = 3800;

/**
 * Gentle ensemble detune. Barely-there movement so the image breathes and widens
 * rather than sitting still. Rate is a whole number of cycles per loop.
 */
const CHORUS_CYCLES = 2;
const CHORUS_DELAY_MS = 8;

/**
 * Ceiling for the summed mix, before the limiter.
 *
 * Calibrated by measuring an actual render rather than by taste: the first pass
 * at 0.85 produced a clip peaking at −17.8 dBFS with −30 dBFS RMS, which is far
 * below the roughly −20 dBFS RMS that ambient music sits at — quiet enough that
 * a listener would reach for the volume and then be startled by the next thing
 * they played. Retuned again in Phase 3.5, because the shimmer send and the added
 * octave partials both put more energy into the mix; the target is unchanged at
 * roughly −19 dBFS RMS with peaks a comfortable distance under the −1 dB limiter.
 *
 * Measured against the STEADY STATE, not the whole file: the staggered bloom
 * means the opening few seconds are deliberately quiet, so a whole-file average
 * understates what someone leaving the loop running actually hears.
 */
const MASTER_GAIN = 2.45;

// --------------------------------------------------------------- shapes

export interface VoicePlan {
  /** The star this voice came from. */
  sourceId: string;
  frequency: number;
  /** Linear gain, 0..1, before the master stage. */
  gain: number;
  pan: number;
  /** Lowpass cutoff in Hz. */
  filterHz: number;
  /** Octave-only harmonic amplitudes; index i is harmonic i+1. */
  partials: number[];
  attackSeconds: number;
  releaseSeconds: number;
  /** Seconds after the start before this voice begins — brightest leads. */
  startDelaySeconds: number;
  /** Tremolo depth, 0..1. */
  twinkleDepth: number;
  /** Tremolo rate in Hz — always a whole number of cycles per loop. */
  twinkleHz: number;
  /** Starting phase in degrees, so voices do not pulse in lockstep. */
  twinklePhase: number;
}

export interface DronePlan {
  /** The low weight oscillator, an octave under the score's root. */
  frequency: number;
  /**
   * The body oscillator, an octave above `frequency` (i.e. at the root itself).
   * Carries the pitch on speakers that cannot reproduce the low one at all.
   */
  bodyFrequency: number;
  detuneCents: number;
  gain: number;
  filterHz: number;
  breathHz: number;
  breathDepth: number;
  filterSweepHz: number;
  /** Octave-only harmonic amplitudes for the body oscillator. */
  partials: number[];
  /** Slow detune wander, in cents, for a bed that is never quite still. */
  driftCents: number;
  /** Rate of that wander — a whole number of cycles per loop. */
  driftHz: number;
}

/** The octave-up feedback haze. */
export interface ShimmerPlan {
  /** How much of the mix is fed into the shimmer path, 0..1. */
  send: number;
  /** Always +12 semitones. See `SHIMMER_PITCH_SEMITONES`. */
  pitchSemitones: number;
  /** Grain window for the pitch shifter, in seconds. */
  windowSize: number;
  /** How much of the shifted signal re-enters the shifter, climbing an octave each pass. */
  feedback: number;
  decaySeconds: number;
  /** Lowpass on the shimmer path, so the cascade stays soft. */
  toneHz: number;
  /** Level of the returned haze. */
  returnGain: number;
}

export interface ChorusPlan {
  frequency: number;
  delayMs: number;
  depth: number;
  wet: number;
}

/**
 * Two directions, so the ear can choose rather than the author guessing.
 * `lush` leans into the shimmer and the long tails; `subtle` keeps the same
 * shapes but much closer to bare.
 */
export type AudioStyle = 'lush' | 'subtle';

export interface AudioPlan {
  style: AudioStyle;
  voices: VoicePlan[];
  drone: DronePlan;
  reverb: { decaySeconds: number; preDelay: number; wet: number };
  shimmer: ShimmerPlan;
  chorus: ChorusPlan;
  stereoWidth: number;
  masterGain: number;
  loopSeconds: number;
}

/** The per-style dials. Everything else is shared. */
export const STYLES: Record<AudioStyle, {
  shimmerSend: number;
  shimmerFeedback: number;
  shimmerReturn: number;
  reverbWet: number;
  reverbDecay: number;
  chorusDepth: number;
  chorusWet: number;
  stereoWidth: number;
  masterScale: number;
}> = {
  lush: {
    shimmerSend: 0.55,
    shimmerFeedback: 0.38,
    shimmerReturn: 0.5,
    reverbWet: 0.52,
    reverbDecay: 14,
    chorusDepth: 0.45,
    chorusWet: 0.35,
    stereoWidth: 0.78,
    masterScale: 1,
  },
  subtle: {
    shimmerSend: 0.24,
    shimmerFeedback: 0.16,
    shimmerReturn: 0.28,
    reverbWet: 0.4,
    reverbDecay: 9,
    chorusDepth: 0.22,
    chorusWet: 0.18,
    stereoWidth: 0.7,
    masterScale: 1.12,
  },
};

// ------------------------------------------------------------ utilities

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Equal-temperament MIDI note to frequency. */
export function midiToFrequency(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / 12);
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Recover the root pitch class from a score's `key` string ("A minor-pentatonic").
 *
 * The drone needs a numeric root and `MusicalScore` carries the key only as text.
 * Rather than amend a contract that has already passed review, this parses the
 * documented format its own mapping layer produces, and falls back to A if the
 * string is ever something else — a wrong-but-consonant drone beats a crash.
 * `test/audio.test.ts` pins the parse against every scale and root the mapping
 * layer can emit, so a format change fails loudly instead of quietly detuning.
 */
export function rootPitchClass(key: string): number {
  const token = key.trim().split(/\s+/)[0] ?? '';
  const index = PITCH_CLASSES.indexOf(token as (typeof PITCH_CLASSES)[number]);
  return index >= 0 ? index : 9; // 9 = A
}

/**
 * Harmonic amplitudes for one voice — a struck-glass spectrum built from
 * OCTAVES ONLY.
 *
 * Index `i` is harmonic `i + 1`, so index 1 is 2f, index 3 is 4f and index 7 is
 * 8f: one, two and three octaves above the fundamental. Every other harmonic is
 * zero. This is stricter than physics — a real bell is full of inharmonic
 * partials, and even the plain triangle wave this replaces carried 3f, a twelfth
 * above the root — but it makes the on-scale guarantee airtight rather than
 * merely probable: every frequency this oscillator can produce is the same pitch
 * class as the note the sky chose.
 *
 * Hot blue stars get more of the upper octaves (glassier, more air); cool red
 * stars keep almost only the fundamental (round, wooden). The fundamental always
 * dominates, so the true score pitch is never in doubt.
 */
export function timbreToPartials(timbre: TimbreParams): number[] {
  const brightness = clamp(timbre.brightness, 0, 1);
  return [
    1, //          1f  — the note itself, always dominant
    0.16 + 0.26 * brightness, // 2f  — one octave up
    0, //          3f  — a twelfth: silenced, it is a different pitch class
    0.04 + 0.15 * brightness, // 4f  — two octaves up
    0, //          5f  — a major seventeenth: silenced
    0, //          6f  — a nineteenth: silenced
    0, //          7f  — silenced
    0.01 + 0.06 * brightness, // 8f  — three octaves up, the "starlight" glint
  ];
}

/** Lowpass cutoff for one voice: warm stars round, hot stars glassy. */
export function timbreToCutoff(frequency: number, timbre: TimbreParams): number {
  const brightness = clamp(timbre.brightness, 0, 1);
  const harmonics =
    CUTOFF_HARMONICS_WARM + brightness * (CUTOFF_HARMONICS_BRIGHT - CUTOFF_HARMONICS_WARM);
  return clamp(frequency * harmonics, CUTOFF_MIN_HZ, CUTOFF_MAX_HZ);
}

// ------------------------------------------------------------ planning

/**
 * Turn a score into a complete, plain description of the sound to build.
 *
 * Deterministic: same score in, same numbers out — including the LFO rates and
 * phases, which are derived from each voice's index rather than from randomness.
 */
export function planAudio(score: MusicalScore, style: AudioStyle = 'lush'): AudioPlan {
  const loopSeconds = score.loopSeconds > 0 ? score.loopSeconds : 1;
  const dials = STYLES[style] ?? STYLES.lush;

  const voices: VoicePlan[] = score.events.map((event, index) => {
    const frequency = midiToFrequency(event.midi);
    const cycles = TWINKLE_CYCLES[index % TWINKLE_CYCLES.length] as number;

    return {
      sourceId: event.sourceId,
      frequency,
      gain: clamp(event.amplitude, 0, 1) * VOICE_GAIN,
      pan: clamp(event.pan, -1, 1),
      filterHz: timbreToCutoff(frequency, event.timbre),
      partials: timbreToPartials(event.timbre),
      // Later (dimmer) voices open a little more slowly still, so the chord
      // gathers rather than snapping into place.
      attackSeconds: VOICE_ATTACK_SECONDS + index * VOICE_ATTACK_SPREAD,
      releaseSeconds: VOICE_RELEASE_SECONDS,
      // The score is already sorted brightest-first, so index IS the brightness
      // rank: the brightest star leads and the rest arrive like dusk.
      startDelaySeconds: index * VOICE_STAGGER_SECONDS,
      twinkleDepth: clamp(event.twinkle, 0, 1) * TWINKLE_MAX_DEPTH,
      twinkleHz: cycles / loopSeconds,
      // Spread the starting phases evenly around the circle.
      twinklePhase: (index * (360 / TWINKLE_CYCLES.length)) % 360,
    };
  });

  // Root pitch class, dropped into a low octave. Pitch class c in octave n is
  // MIDI 12·(n + 1) + c, so octave 2 gives A2 = 45 — the mapping layer's own
  // default root — and DRONE_OCTAVES_BELOW takes the weight down from there.
  const rootMidi = 12 * (2 + 1) + rootPitchClass(score.key);
  let droneMidi = rootMidi - 12 * DRONE_OCTAVES_BELOW;
  while (droneMidi < DRONE_MIN_MIDI) droneMidi += 12;
  const droneFrequency = midiToFrequency(droneMidi);

  return {
    style,
    voices,
    drone: {
      frequency: droneFrequency,
      bodyFrequency: droneFrequency * 2,
      detuneCents: DRONE_DETUNE_CENTS,
      gain: DRONE_GAIN,
      // Deliberately dull: the bed is a floor, not a voice competing for attention.
      filterHz: clamp(droneFrequency * 6, CUTOFF_MIN_HZ, CUTOFF_MAX_HZ),
      breathHz: DRONE_BREATH_CYCLES / loopSeconds,
      breathDepth: DRONE_BREATH_DEPTH,
      filterSweepHz: DRONE_FILTER_CYCLES / loopSeconds,
      // The bed gets the same octave-only treatment, weighted warm — it should
      // sit under everything, not glitter.
      partials: timbreToPartials({ warmth: 0.8, brightness: 0.2 }),
      // A bed that is never quite still. One cycle per loop keeps the seam.
      driftCents: DRONE_DRIFT_CENTS,
      driftHz: DRONE_DRIFT_CYCLES / loopSeconds,
    },
    reverb: {
      decaySeconds: dials.reverbDecay,
      preDelay: REVERB_PRE_DELAY,
      wet: dials.reverbWet,
    },
    shimmer: {
      send: dials.shimmerSend,
      pitchSemitones: SHIMMER_PITCH_SEMITONES,
      windowSize: SHIMMER_WINDOW,
      feedback: dials.shimmerFeedback,
      decaySeconds: SHIMMER_DECAY_SECONDS,
      toneHz: SHIMMER_TONE_HZ,
      returnGain: dials.shimmerReturn,
    },
    chorus: {
      frequency: CHORUS_CYCLES / loopSeconds,
      delayMs: CHORUS_DELAY_MS,
      depth: dials.chorusDepth,
      wet: dials.chorusWet,
    },
    stereoWidth: dials.stereoWidth,
    // Keep the summed mix roughly level whatever the voice count: eight quiet
    // voices and two loud ones should not differ by 12 dB.
    masterGain: (MASTER_GAIN * dials.masterScale) / Math.sqrt(Math.max(1, voices.length)),
    loopSeconds,
  };
}
