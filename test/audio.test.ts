/**
 * Phase 3 — the audio layer's decisions, tested without a browser.
 *
 * The Tone graph itself needs Web Audio and is verified by listening (that is the
 * phase's stated review gate). But every *number* fed into that graph comes from
 * `planAudio`, which is pure — so the sound design can be pinned here: seamless
 * loop maths, the timbre ramp, level headroom, and the key-string parse the drone
 * depends on.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAPPING_CONFIG,
  SCALE_NAMES,
  pitchClassName,
  sonify,
  type MusicalScore,
} from '../src/engine/mapping/index.ts';
import {
  midiToFrequency,
  planAudio,
  rootPitchClass,
  timbreToCutoff,
  timbreToPartials,
} from '../src/engine/audio/voicing.ts';
import type { HorizonStar, Star } from '../src/engine/model/index.ts';

const fakeStar = (over: Partial<Star> & { id: string }): Star => ({
  ra: 0,
  dec: 0,
  mag: 3,
  ...over,
});

const at = (star: Star, altitude: number, azimuth = 90): HorizonStar => ({ star, altitude, azimuth });

/** A score with `count` voices spread across the sky. */
const sampleScore = (count = 8): MusicalScore =>
  sonify(
    Array.from({ length: count }, (_, i) =>
      at(
        fakeStar({ id: String(i + 1), mag: i * 0.7 - 1, bv: -0.3 + i * 0.28 }),
        5 + i * 10,
        (i * 47) % 360,
      ),
    ),
    DEFAULT_MAPPING_CONFIG,
  );

describe('midiToFrequency', () => {
  it('anchors on concert A', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 9);
  });

  it('doubles every octave', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 9);
    expect(midiToFrequency(57)).toBeCloseTo(220, 9);
    expect(midiToFrequency(45)).toBeCloseTo(110, 9);
  });

  it('matches known equal-temperament pitches', () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3); // middle C
    expect(midiToFrequency(21)).toBeCloseTo(27.5, 6); // A0
  });
});

describe('rootPitchClass — the drone must land in the right key', () => {
  it('reads every key string the mapping layer can produce', () => {
    // If the `key` format ever changes, this fails loudly rather than quietly
    // detuning the drone bed against the chord above it.
    for (const scale of SCALE_NAMES) {
      for (let rootMidi = 21; rootMidi <= 108; rootMidi++) {
        const key = sonify([], { ...DEFAULT_MAPPING_CONFIG, scale, rootMidi }).key;
        expect(rootPitchClass(key), `key string "${key}"`).toBe(rootMidi % 12);
      }
    }
  });

  it('agrees with the mapping layer’s own note naming', () => {
    for (let midi = 0; midi < 128; midi++) {
      expect(pitchClassName(midi)).toBe(
        ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][rootPitchClass(`${pitchClassName(midi)} x`)],
      );
    }
  });

  it('falls back to A rather than throwing on an unrecognised key', () => {
    // A wrong-but-consonant drone beats a crash mid-listen.
    expect(rootPitchClass('')).toBe(9);
    expect(rootPitchClass('not-a-note major')).toBe(9);
  });
});

describe('timbreToCutoff — B–V becomes colour', () => {
  it('opens the filter for hot blue stars and closes it for cool red ones', () => {
    const blue = timbreToCutoff(440, { warmth: 0.05, brightness: 0.95 });
    const red = timbreToCutoff(440, { warmth: 0.95, brightness: 0.05 });
    expect(blue).toBeGreaterThan(red * 3);
  });

  it('scales with the fundamental, so high voices are not dulled', () => {
    const timbre = { warmth: 0.5, brightness: 0.5 };
    expect(timbreToCutoff(880, timbre)).toBeCloseTo(2 * timbreToCutoff(440, timbre), 6);
  });

  it('always keeps at least the first two partials audible', () => {
    for (let brightness = 0; brightness <= 1; brightness += 0.05) {
      const cutoff = timbreToCutoff(440, { warmth: 1 - brightness, brightness });
      expect(cutoff).toBeGreaterThan(440 * 2);
    }
  });

  it('stays inside audible bounds even at extremes', () => {
    expect(timbreToCutoff(20, { warmth: 1, brightness: 0 })).toBeGreaterThanOrEqual(180);
    expect(timbreToCutoff(8000, { warmth: 0, brightness: 1 })).toBeLessThanOrEqual(14000);
  });
});

describe('planAudio — seamless looping is structural, not a crossfade', () => {
  it('gives every LFO a whole number of cycles per loop', () => {
    const score = sampleScore();
    const plan = planAudio(score);

    for (const voice of plan.voices) {
      const cycles = voice.twinkleHz * plan.loopSeconds;
      expect(
        Math.abs(cycles - Math.round(cycles)),
        `voice ${voice.sourceId} runs ${cycles} twinkle cycles per loop`,
      ).toBeLessThan(1e-9);
      expect(Math.round(cycles)).toBeGreaterThan(0);
    }

    const breathCycles = plan.drone.breathHz * plan.loopSeconds;
    const sweepCycles = plan.drone.filterSweepHz * plan.loopSeconds;
    expect(Math.abs(breathCycles - Math.round(breathCycles))).toBeLessThan(1e-9);
    expect(Math.abs(sweepCycles - Math.round(sweepCycles))).toBeLessThan(1e-9);
  });

  it('holds for any loop length', () => {
    for (const loopSeconds of [7, 12, 18, 23.5, 60]) {
      const score = sonify(
        [at(fakeStar({ id: '1' }), 40), at(fakeStar({ id: '2', mag: 4 }), 20)],
        { ...DEFAULT_MAPPING_CONFIG, loopSeconds },
      );
      const plan = planAudio(score);
      for (const voice of plan.voices) {
        const cycles = voice.twinkleHz * loopSeconds;
        expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-9);
      }
    }
  });

  it('does not let two voices share a twinkle rate, so they never pulse together', () => {
    const plan = planAudio(sampleScore(8));
    const rates = plan.voices.map((v) => v.twinkleHz);
    expect(new Set(rates).size).toBe(rates.length);
  });

  it('spreads the starting phases around the circle', () => {
    const plan = planAudio(sampleScore(8));
    const phases = plan.voices.map((v) => v.twinklePhase);
    expect(new Set(phases).size).toBe(phases.length);
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(360);
    }
  });
});

describe('planAudio — levels and headroom', () => {
  it('keeps the summed mix roughly level whatever the voice count', () => {
    // Eight quiet voices and two loud ones should not differ by 12 dB.
    const one = planAudio(sampleScore(1));
    const eight = planAudio(sampleScore(8));
    const sum = (plan: ReturnType<typeof planAudio>): number =>
      plan.voices.reduce((total, v) => total + v.gain, 0) * plan.masterGain;
    const ratio = sum(eight) / sum(one);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(4);
  });

  it('never sends a voice above unity', () => {
    for (const voice of planAudio(sampleScore(8)).voices) {
      expect(voice.gain).toBeGreaterThan(0);
      expect(voice.gain).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the drone under the brightest star, as a floor not a competitor', () => {
    const plan = planAudio(sampleScore(8));
    const loudest = Math.max(...plan.voices.map((v) => v.gain));
    expect(plan.drone.gain).toBeGreaterThan(0);
    expect(plan.drone.gain).toBeLessThan(loudest);
  });

  it('puts the drone one octave below the score root', () => {
    const plan = planAudio(sonify([], { ...DEFAULT_MAPPING_CONFIG, rootMidi: 45 })); // A2
    // A2 is 110 Hz; one octave down is A1, 55 Hz.
    expect(plan.drone.frequency).toBeCloseTo(55, 4);
    expect(plan.drone.bodyFrequency).toBeCloseTo(110, 4);
  });

  it('keeps the bed audible on real speakers', () => {
    // A drone below ~40 Hz is inaudible on laptops and phones — the bed would
    // simply vanish for most listeners, which is worse than it being shallow.
    for (let rootMidi = 33; rootMidi <= 72; rootMidi++) {
      const plan = planAudio(sonify([], { ...DEFAULT_MAPPING_CONFIG, rootMidi }));
      expect(plan.drone.frequency, `root midi ${rootMidi}`).toBeGreaterThan(40);
      expect(plan.drone.bodyFrequency).toBeCloseTo(plan.drone.frequency * 2, 6);
    }
  });

  it('follows the key when the root changes', () => {
    const inC = planAudio(sonify([], { ...DEFAULT_MAPPING_CONFIG, rootMidi: 60 })); // C
    const inA = planAudio(sonify([], { ...DEFAULT_MAPPING_CONFIG, rootMidi: 45 })); // A
    expect(inC.drone.frequency).not.toBeCloseTo(inA.drone.frequency, 2);
    // C1 would be 32.7 Hz, under the audibility floor, so the bed sits at C2.
    expect(inC.drone.frequency).toBeCloseTo(midiToFrequency(36), 4); // C2
    expect(inA.drone.frequency).toBeCloseTo(midiToFrequency(33), 4); // A1
  });
});

describe('planAudio — faithful to the score', () => {
  it('makes one voice per event, in order', () => {
    const score = sampleScore(6);
    const plan = planAudio(score);
    expect(plan.voices).toHaveLength(score.events.length);
    expect(plan.voices.map((v) => v.sourceId)).toEqual(score.events.map((e) => e.sourceId));
  });

  it('carries pan through untouched', () => {
    const score = sampleScore(8);
    const plan = planAudio(score);
    for (const [i, voice] of plan.voices.entries()) {
      expect(voice.pan).toBeCloseTo(score.events[i]?.pan ?? 0, 9);
    }
  });

  it('turns each pitch into the right frequency', () => {
    const score = sampleScore(8);
    const plan = planAudio(score);
    for (const [i, voice] of plan.voices.entries()) {
      expect(voice.frequency).toBeCloseTo(midiToFrequency(score.events[i]?.midi ?? 0), 6);
    }
  });

  it('gives a low, twinkling star more tremolo than a high, steady one', () => {
    const score = sonify(
      [at(fakeStar({ id: 'low', mag: 1 }), 4), at(fakeStar({ id: 'high', mag: 1.1 }), 85)],
      DEFAULT_MAPPING_CONFIG,
    );
    const [low, high] = planAudio(score).voices;
    expect(low?.twinkleDepth).toBeGreaterThan(high?.twinkleDepth ?? 1);
  });

  it('never modulates a voice to silence', () => {
    for (const voice of planAudio(sampleScore(8)).voices) {
      expect(voice.twinkleDepth).toBeLessThan(0.5);
      expect(voice.twinkleDepth).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic', () => {
    const score = sampleScore(8);
    expect(planAudio(score)).toEqual(planAudio(score));
  });

  it('serialises — the plan is plain data', () => {
    const plan = planAudio(sampleScore(8));
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

describe('planAudio — a sky with nothing in it', () => {
  const empty = planAudio(sonify([], DEFAULT_MAPPING_CONFIG));

  it('has no voices but keeps the drone', () => {
    // An empty sky is still a sky. The bed carries the key; the stars are what
    // is missing, and the label says so.
    expect(empty.voices).toEqual([]);
    expect(empty.drone.gain).toBeGreaterThan(0);
    expect(empty.drone.frequency).toBeGreaterThan(0);
  });

  it('keeps its LFO maths finite', () => {
    expect(Number.isFinite(empty.drone.breathHz)).toBe(true);
    expect(Number.isFinite(empty.masterGain)).toBe(true);
    expect(empty.masterGain).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3.5 — the beauty pass must not cost the on-scale guarantee.
// ---------------------------------------------------------------------------

describe('octave-only purity — nothing added may introduce a new pitch class', () => {
  it('silences every non-octave harmonic in the voice spectrum', () => {
    // Index i is harmonic i+1. Only 1f, 2f, 4f and 8f — the octaves — may ring.
    // 3f is a twelfth and 5f a major seventeenth: both different pitch classes,
    // both would put a note in the air the sky never chose.
    const OCTAVE_INDICES = new Set([0, 1, 3, 7]);
    for (let brightness = 0; brightness <= 1; brightness += 0.05) {
      const partials = timbreToPartials({ warmth: 1 - brightness, brightness });
      partials.forEach((amplitude, index) => {
        if (!OCTAVE_INDICES.has(index)) {
          expect(amplitude, `harmonic ${index + 1} must be silent`).toBe(0);
        }
      });
    }
  });

  it('shimmers by exactly one octave, never a fifth', () => {
    // A +7 shimmer is the common choice and would be wrong here: in A
    // minor-pentatonic it injects B, which is not in the scale.
    for (const style of ['lush', 'subtle'] as const) {
      const plan = planAudio(sampleScore(), style);
      expect(plan.shimmer.pitchSemitones % 12).toBe(0);
      expect(plan.shimmer.pitchSemitones).toBe(12);
    }
  });

  it('keeps the shimmer cascade stable however many times it goes round', () => {
    // Feedback below 1 must converge; and since every pass is +12, even an
    // infinite cascade only ever produces octaves of the original pitch.
    for (const style of ['lush', 'subtle'] as const) {
      const plan = planAudio(sampleScore(), style);
      expect(plan.shimmer.feedback).toBeGreaterThanOrEqual(0);
      expect(plan.shimmer.feedback).toBeLessThan(0.7);
    }
  });

  it('keeps the fundamental dominant over every added partial', () => {
    for (let brightness = 0; brightness <= 1; brightness += 0.05) {
      const partials = timbreToPartials({ warmth: 1 - brightness, brightness });
      const fundamental = partials[0] ?? 0;
      expect(fundamental).toBe(1);
      for (const amplitude of partials.slice(1)) {
        expect(amplitude).toBeLessThan(fundamental);
      }
      // The upper octaves together must not out-shout the note itself.
      expect(partials.slice(1).reduce((a, b) => a + b, 0)).toBeLessThan(fundamental);
    }
  });

  it('gives hot stars more upper octaves than cool ones', () => {
    const hot = timbreToPartials({ warmth: 0.05, brightness: 0.95 });
    const cool = timbreToPartials({ warmth: 0.95, brightness: 0.05 });
    const upper = (p: number[]): number => p.slice(1).reduce((a, b) => a + b, 0);
    expect(upper(hot)).toBeGreaterThan(upper(cool) * 2);
  });
});

describe('blooming entries', () => {
  it('lets the brightest star lead and the rest follow', () => {
    const plan = planAudio(sampleScore(8));
    const delays = plan.voices.map((v) => v.startDelaySeconds);
    expect(delays[0]).toBe(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
  });

  it('gets every voice sounding well within the loop', () => {
    // A stagger that outran the loop would mean the last star never arrives.
    const plan = planAudio(sampleScore(8));
    for (const voice of plan.voices) {
      expect(voice.startDelaySeconds + voice.attackSeconds).toBeLessThan(plan.loopSeconds);
    }
  });

  it('opens slowly enough to feel like dusk, not a keyboard', () => {
    for (const voice of planAudio(sampleScore(8)).voices) {
      expect(voice.attackSeconds).toBeGreaterThanOrEqual(4);
      expect(voice.attackSeconds).toBeLessThanOrEqual(10);
    }
  });
});

describe('styles', () => {
  it('offers a lush and a restrained take', () => {
    const lush = planAudio(sampleScore(), 'lush');
    const subtle = planAudio(sampleScore(), 'subtle');
    expect(lush.style).toBe('lush');
    expect(subtle.style).toBe('subtle');
    expect(lush.shimmer.send).toBeGreaterThan(subtle.shimmer.send);
    expect(lush.shimmer.feedback).toBeGreaterThan(subtle.shimmer.feedback);
    expect(lush.reverb.decaySeconds).toBeGreaterThan(subtle.reverb.decaySeconds);
    expect(lush.chorus.wet).toBeGreaterThan(subtle.chorus.wet);
  });

  it('changes only the dressing — never a pitch, pan, or voice count', () => {
    // The score is TRUE and locked. Style may not touch what the sky decided.
    const score = sampleScore(8);
    const lush = planAudio(score, 'lush');
    const subtle = planAudio(score, 'subtle');
    expect(lush.voices.map((v) => v.frequency)).toEqual(subtle.voices.map((v) => v.frequency));
    expect(lush.voices.map((v) => v.pan)).toEqual(subtle.voices.map((v) => v.pan));
    expect(lush.voices.map((v) => v.gain)).toEqual(subtle.voices.map((v) => v.gain));
    expect(lush.voices.map((v) => v.sourceId)).toEqual(subtle.voices.map((v) => v.sourceId));
    expect(lush.drone.frequency).toBe(subtle.drone.frequency);
  });

  it('defaults to lush and is deterministic per style', () => {
    const score = sampleScore(8);
    expect(planAudio(score)).toEqual(planAudio(score, 'lush'));
    expect(planAudio(score, 'subtle')).toEqual(planAudio(score, 'subtle'));
  });

  it('still serialises as plain data', () => {
    const plan = planAudio(sampleScore(8), 'subtle');
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

describe('the new movement layers stay seamless', () => {
  it('runs the chorus and the drone drift at whole cycles per loop', () => {
    for (const loopSeconds of [7, 12, 18, 23.5, 60]) {
      const score = sonify([at(fakeStar({ id: '1' }), 40)], {
        ...DEFAULT_MAPPING_CONFIG,
        loopSeconds,
      });
      const plan = planAudio(score);
      const chorusCycles = plan.chorus.frequency * loopSeconds;
      const driftCycles = plan.drone.driftHz * loopSeconds;
      expect(Math.abs(chorusCycles - Math.round(chorusCycles))).toBeLessThan(1e-9);
      expect(Math.abs(driftCycles - Math.round(driftCycles))).toBeLessThan(1e-9);
    }
  });

  it('keeps the drone drift small enough to stay in tune', () => {
    const { drone } = planAudio(sampleScore());
    // Cents, not semitones: this is a beat, not a bend.
    expect(drone.driftCents).toBeLessThan(25);
    expect(drone.driftCents).toBeGreaterThan(0);
  });
});
