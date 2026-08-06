/**
 * Phase 2 — the sonification must be deterministic, always on-scale, and calm
 * about strange skies.
 *
 * The three properties that matter most, in order:
 *   1. Every emitted pitch is a member of the configured scale. Not "usually" —
 *      an off-scale pitch must be unrepresentable.
 *   2. Identical input yields a deep-equal score, forever.
 *   3. A sky with nothing in it is an ordinary sky, not an exception.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  parseStarCatalog,
  type HorizonStar,
  type ObserverInput,
  type Star,
} from '../src/engine/model/index.ts';
import {
  DEFAULT_MAPPING_CONFIG,
  PITCH_SPAN_OCTAVES,
  SCALE_NAMES,
  altitudeToMidi,
  altitudeToTwinkle,
  azimuthToPan,
  colourToTimbre,
  magnitudeToAmplitude,
  scaleDegrees,
  sonify,
  starsAboveHorizon,
  type MappingConfig,
} from '../src/engine/mapping/index.ts';

const catalog: Star[] = parseStarCatalog(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../public/data/stars.hyg.subset.json', import.meta.url)), 'utf8'),
  ),
);

/** Shambu's own sky: Bengaluru, local midnight. */
const BENGALURU: ObserverInput = {
  latitude: 12.9719,
  longitude: 77.5937,
  dateISO: '1993-08-01',
  timeMinutes: 0,
  tzOffsetMinutes: 330,
};

const realSky = (obs: ObserverInput = BENGALURU): HorizonStar[] => starsAboveHorizon(catalog, obs);

/** A hand-built sky, for tests that need exact control. */
const fakeStar = (over: Partial<Star> & { id: string }): Star => ({
  ra: 0,
  dec: 0,
  mag: 3,
  ...over,
});

const at = (star: Star, altitude: number, azimuth = 90): HorizonStar => ({ star, altitude, azimuth });

const config = (over: Partial<MappingConfig> = {}): MappingConfig => ({
  ...DEFAULT_MAPPING_CONFIG,
  ...over,
});

// ---------------------------------------------------------------------------

describe('THE GATE — every emitted pitch is on the scale', () => {
  it.each(SCALE_NAMES)('for scale %s, across many real skies', (scale) => {
    const degrees = scaleDegrees(scale);

    for (const rootMidi of [33, 45, 52, 60]) {
      for (let timeMinutes = 0; timeMinutes < 1440; timeMinutes += 180) {
        const score = sonify(
          realSky({ ...BENGALURU, timeMinutes }),
          config({ scale, rootMidi, maxVoices: 12 }),
        );
        for (const event of score.events) {
          const interval = event.midi - rootMidi;
          expect(interval).toBeGreaterThanOrEqual(0);
          expect(
            degrees.includes(((interval % 12) + 12) % 12),
            `midi ${event.midi} is ${interval % 12} semitones above the root — not in ${scale}`,
          ).toBe(true);
        }
      }
    }
  });

  it('cannot emit an off-scale pitch at any altitude whatsoever', () => {
    // Sweep the entire horizon-to-zenith range in fine steps.
    const degrees = scaleDegrees('minor-pentatonic');
    for (let altitude = -20; altitude <= 110; altitude += 0.1) {
      const midi = altitudeToMidi(altitude, 45, 'minor-pentatonic');
      expect(degrees.includes(((midi - 45) % 12 + 12) % 12)).toBe(true);
    }
  });

  it('rejects an unknown scale by name, listing the real ones', () => {
    expect(() => sonify(realSky(), config({ scale: 'phrygian-dominant' }))).toThrow(
      /unknown scale "phrygian-dominant".*Available scales: minor-pentatonic/s,
    );
  });
});

describe('THE GATE — determinism', () => {
  it('produces deep-equal scores on repeated calls', () => {
    const sky = realSky();
    expect(sonify(sky, DEFAULT_MAPPING_CONFIG)).toEqual(sonify(sky, DEFAULT_MAPPING_CONFIG));
  });

  it('produces deep-equal scores from a freshly computed identical sky', () => {
    // Recomputes the horizon reduction too, not just the sonification.
    expect(sonify(realSky(), DEFAULT_MAPPING_CONFIG)).toEqual(
      sonify(realSky(), DEFAULT_MAPPING_CONFIG),
    );
  });

  it('is stable across many different skies', () => {
    for (const timeMinutes of [0, 313, 727, 1094, 1439]) {
      const sky = realSky({ ...BENGALURU, timeMinutes });
      expect(sonify(sky, DEFAULT_MAPPING_CONFIG)).toEqual(sonify(sky, DEFAULT_MAPPING_CONFIG));
    }
  });

  it('serialises to JSON and back unchanged', () => {
    // The score is the seam between the pure layers and the audio layer; it has
    // to survive being written down.
    const score = sonify(realSky(), DEFAULT_MAPPING_CONFIG);
    expect(JSON.parse(JSON.stringify(score))).toEqual(score);
  });

  it('breaks magnitude ties by catalogue id, never by array order', () => {
    const a = fakeStar({ id: '200', mag: 2 });
    const b = fakeStar({ id: '100', mag: 2 }); // same magnitude, lower id
    const forwards = sonify([at(a, 40), at(b, 40)], config({ maxVoices: 1 }));
    const backwards = sonify([at(b, 40), at(a, 40)], config({ maxVoices: 1 }));
    expect(forwards).toEqual(backwards);
    expect(forwards.events[0]?.sourceId).toBe('100');
  });

  it('gives a different sky a different score', () => {
    const midnight = sonify(realSky({ ...BENGALURU, timeMinutes: 0 }), DEFAULT_MAPPING_CONFIG);
    const noon = sonify(realSky({ ...BENGALURU, timeMinutes: 720 }), DEFAULT_MAPPING_CONFIG);
    expect(midnight.events).not.toEqual(noon.events);
  });
});

describe('THE GATE — strange skies produce valid scores, never exceptions', () => {
  it('handles nothing above the horizon with an honest label', () => {
    const score = sonify([], DEFAULT_MAPPING_CONFIG);
    expect(score.events).toEqual([]);
    expect(score.meta.visibleCount).toBe(0);
    expect(score.meta.objectCount).toBe(0);
    expect(score.meta.label).toBe('no stars above the horizon');
    expect(score.loopSeconds).toBe(DEFAULT_MAPPING_CONFIG.loopSeconds);
    expect(score.key).toBe('A minor-pentatonic');
  });

  it('handles a sky where every star is below the horizon', () => {
    const belowOnly: HorizonStar[] = [at(fakeStar({ id: '1' }), -30), at(fakeStar({ id: '2' }), -0.5)];
    const score = sonify(belowOnly, DEFAULT_MAPPING_CONFIG);
    expect(score.events).toEqual([]);
    expect(score.meta.objectCount).toBe(2);
    expect(score.meta.visibleCount).toBe(0);
    expect(score.meta.label).toBe('no stars above the horizon');
  });

  it('uses what is there when fewer stars are visible than maxVoices', () => {
    const three: HorizonStar[] = [
      at(fakeStar({ id: '1', mag: 1 }), 70),
      at(fakeStar({ id: '2', mag: 2 }), 40),
      at(fakeStar({ id: '3', mag: 3 }), 10),
    ];
    const score = sonify(three, config({ maxVoices: 8 }));
    expect(score.events).toHaveLength(3);
    expect(score.meta.visibleCount).toBe(3);
    expect(score.meta.label).toBe('3 stars above the horizon, all sounding');
  });

  it('handles a single star', () => {
    const score = sonify([at(fakeStar({ id: '1' }), 45)], DEFAULT_MAPPING_CONFIG);
    expect(score.events).toHaveLength(1);
    expect(score.meta.label).toBe('1 star above the horizon, all sounding');
  });

  it('handles maxVoices of zero without complaint', () => {
    const score = sonify(realSky(), config({ maxVoices: 0 }));
    expect(score.events).toEqual([]);
    expect(score.meta.visibleCount).toBeGreaterThan(0);
    expect(score.meta.label).toMatch(/none sounding/);
  });

  it('survives a real polar sky', () => {
    for (const latitude of [89.9, -89.9]) {
      const score = sonify(
        starsAboveHorizon(catalog, { ...BENGALURU, latitude }),
        DEFAULT_MAPPING_CONFIG,
      );
      expect(score.events.length).toBeGreaterThan(0);
      expect(score.events.length).toBeLessThanOrEqual(DEFAULT_MAPPING_CONFIG.maxVoices);
    }
  });

  it('survives a star sitting exactly on the horizon', () => {
    const score = sonify([at(fakeStar({ id: '1' }), 0)], DEFAULT_MAPPING_CONFIG);
    // Exactly 0 is below the geometric horizon — conservative and consistent.
    expect(score.events).toEqual([]);
  });

  it('survives a star with no colour information', () => {
    const score = sonify([at(fakeStar({ id: '1', bv: undefined }), 45)], DEFAULT_MAPPING_CONFIG);
    expect(score.events[0]?.timbre.warmth).toBeGreaterThan(0);
    expect(score.events[0]?.timbre.brightness).toBeGreaterThan(0);
  });
});

describe('config validation — a broken config is a bug, and says so', () => {
  it('rejects a non-positive loop length', () => {
    expect(() => sonify([], config({ loopSeconds: 0 }))).toThrow(/loopSeconds must be greater than 0/);
    expect(() => sonify([], config({ loopSeconds: -5 }))).toThrow(/loopSeconds/);
  });

  it('rejects a root outside the MIDI range', () => {
    expect(() => sonify([], config({ rootMidi: -1 }))).toThrow(/rootMidi/);
    expect(() => sonify([], config({ rootMidi: 200 }))).toThrow(/rootMidi/);
  });

  it('rejects non-finite numbers', () => {
    expect(() => sonify([], config({ maxVoices: Number.NaN }))).toThrow(/maxVoices/);
    expect(() => sonify([], config({ seed: Number.POSITIVE_INFINITY }))).toThrow(/seed/);
  });

  it('accepts an omitted seed', () => {
    expect(() => sonify([], config({ seed: undefined }))).not.toThrow();
  });
});

describe('altitude → pitch', () => {
  it('rises monotonically with altitude', () => {
    let previous = -Infinity;
    for (let altitude = 0; altitude <= 90; altitude += 1) {
      const midi = altitudeToMidi(altitude, 45, 'minor-pentatonic');
      expect(midi).toBeGreaterThanOrEqual(previous);
      previous = midi;
    }
  });

  it('puts the horizon at the root and the zenith at the top of the span', () => {
    expect(altitudeToMidi(0, 45, 'minor-pentatonic')).toBe(45);
    // Last degree of the top octave: 5 degrees per octave, 3 octaves.
    expect(altitudeToMidi(90, 45, 'minor-pentatonic')).toBe(45 + 12 * (PITCH_SPAN_OCTAVES - 1) + 10);
  });

  it('clamps rather than escaping the range', () => {
    expect(altitudeToMidi(-40, 45, 'minor-pentatonic')).toBe(45);
    expect(altitudeToMidi(200, 45, 'minor-pentatonic')).toBe(altitudeToMidi(90, 45, 'minor-pentatonic'));
  });

  it('never exceeds the MIDI range even with an extreme root', () => {
    expect(altitudeToMidi(90, 127, 'lydian')).toBeLessThanOrEqual(127);
  });

  it('gives two stars at the same altitude the same pitch', () => {
    // Deliberate: they really are at the same height, and the unison is
    // consonant. Their pans and timbres differ, so it reads as chorus.
    const score = sonify(
      [at(fakeStar({ id: '1', mag: 1 }), 42, 90), at(fakeStar({ id: '2', mag: 2 }), 42, 270)],
      DEFAULT_MAPPING_CONFIG,
    );
    expect(score.events[0]?.midi).toBe(score.events[1]?.midi);
    expect(score.events[0]?.pan).toBeCloseTo(-(score.events[1]?.pan ?? 0), 6);
  });
});

describe('magnitude → amplitude', () => {
  it('makes brighter stars louder', () => {
    expect(magnitudeToAmplitude(-1.44)).toBeGreaterThan(magnitudeToAmplitude(0));
    expect(magnitudeToAmplitude(0)).toBeGreaterThan(magnitudeToAmplitude(3));
    expect(magnitudeToAmplitude(3)).toBeGreaterThan(magnitudeToAmplitude(6));
  });

  it('keeps every amplitude inside 0..1', () => {
    for (let mag = -30; mag <= 30; mag += 0.25) {
      const amplitude = magnitudeToAmplitude(mag);
      expect(amplitude).toBeGreaterThan(0);
      expect(amplitude).toBeLessThanOrEqual(1);
    }
  });

  it('lets the faintest naked-eye star still whisper', () => {
    // 24 dB below the brightest, not silent.
    expect(magnitudeToAmplitude(6.5)).toBeCloseTo(10 ** (-24 / 20), 6);
    expect(magnitudeToAmplitude(6.5)).toBeGreaterThan(0.05);
  });

  it('maps equal magnitude steps to equal decibel steps', () => {
    const db = (mag: number): number => 20 * Math.log10(magnitudeToAmplitude(mag));
    expect(db(1) - db(2)).toBeCloseTo(db(3) - db(4), 9);
  });
});

describe('B–V → timbre', () => {
  it('makes hot blue stars brighter and cool red stars warmer', () => {
    const rigel = colourToTimbre(-0.03); // blue-white supergiant
    const betelgeuse = colourToTimbre(1.5); // red supergiant
    expect(rigel.brightness).toBeGreaterThan(betelgeuse.brightness);
    expect(betelgeuse.warmth).toBeGreaterThan(rigel.warmth);
  });

  it('keeps warmth and brightness complementary and inside 0..1', () => {
    for (let bv = -1; bv <= 6; bv += 0.05) {
      const { warmth, brightness } = colourToTimbre(bv);
      expect(warmth).toBeGreaterThanOrEqual(0);
      expect(warmth).toBeLessThanOrEqual(1);
      expect(warmth + brightness).toBeCloseTo(1, 6);
    }
  });

  it('falls back to a neutral, roughly solar colour when none is recorded', () => {
    const missing = colourToTimbre(undefined);
    expect(missing.warmth).toBeGreaterThan(0.2);
    expect(missing.warmth).toBeLessThan(0.8);
    expect(missing).toEqual(colourToTimbre(0.65));
  });
});

describe('azimuth → pan', () => {
  it('sends east right and west left', () => {
    expect(azimuthToPan(90)).toBeGreaterThan(0.8); // due east
    expect(azimuthToPan(270)).toBeLessThan(-0.8); // due west
  });

  it('centres north and south, which have no left-right bias', () => {
    expect(azimuthToPan(0)).toBeCloseTo(0, 9);
    expect(azimuthToPan(180)).toBeCloseTo(0, 9);
  });

  it('never hard-pans a voice out of the image', () => {
    for (let azimuth = 0; azimuth < 360; azimuth += 1) {
      expect(Math.abs(azimuthToPan(azimuth))).toBeLessThanOrEqual(0.85);
    }
  });

  it('is symmetric about the meridian', () => {
    expect(azimuthToPan(45)).toBeCloseTo(-azimuthToPan(315), 9);
  });
});

describe('altitude → twinkle', () => {
  it('is calm overhead and agitated near the horizon', () => {
    expect(altitudeToTwinkle(90)).toBeCloseTo(0, 6);
    expect(altitudeToTwinkle(5)).toBeCloseTo(1, 6);
  });

  it('decreases monotonically as a star climbs', () => {
    let previous = Infinity;
    for (let altitude = 1; altitude <= 90; altitude += 1) {
      const twinkle = altitudeToTwinkle(altitude);
      expect(twinkle).toBeLessThanOrEqual(previous);
      previous = twinkle;
    }
  });

  it('stays inside 0..1', () => {
    for (let altitude = 0; altitude <= 90; altitude += 0.5) {
      expect(altitudeToTwinkle(altitude)).toBeGreaterThanOrEqual(0);
      expect(altitudeToTwinkle(altitude)).toBeLessThanOrEqual(1);
    }
  });

  it('reaches full depth at an airmass of 5 (~11.5 degrees)', () => {
    expect(altitudeToTwinkle(Math.asin(1 / 5) * (180 / Math.PI))).toBeCloseTo(1, 6);
  });
});

describe('the score as a whole', () => {
  const score = sonify(realSky(), DEFAULT_MAPPING_CONFIG);

  it('fills every field of every event', () => {
    expect(score.events.length).toBe(DEFAULT_MAPPING_CONFIG.maxVoices);
    for (const event of score.events) {
      expect(typeof event.sourceId).toBe('string');
      expect(Number.isFinite(event.midi)).toBe(true);
      expect(event.amplitude).toBeGreaterThan(0);
      expect(Math.abs(event.pan)).toBeLessThanOrEqual(1);
      expect(event.twinkle).toBeGreaterThanOrEqual(0);
      expect(event.startSeconds).toBe(0);
      expect(event.durationSeconds).toBe(DEFAULT_MAPPING_CONFIG.loopSeconds);
    }
  });

  it('picks the brightest visible stars, in brightness order', () => {
    const magnitudes = score.events.map(
      (event) => catalog.find((s) => s.id === event.sourceId)?.mag ?? NaN,
    );
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => a - b));

    const brightestVisible = [...realSky()].sort((a, b) => a.star.mag - b.star.mag)[0];
    expect(score.events[0]?.sourceId).toBe(brightestVisible?.star.id);
  });

  it('sounds distinct stars — no star claims two voices', () => {
    const ids = score.events.map((event) => event.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the key from the root and scale', () => {
    expect(sonify([], config({ rootMidi: 45, scale: 'minor-pentatonic' })).key).toBe('A minor-pentatonic');
    expect(sonify([], config({ rootMidi: 60, scale: 'dorian' })).key).toBe('C dorian');
  });

  it('reports counts that match the sky it was given', () => {
    const sky = realSky();
    const full = sonify(sky, DEFAULT_MAPPING_CONFIG);
    expect(full.meta.objectCount).toBe(sky.length);
    expect(full.meta.visibleCount).toBe(sky.length);
    expect(full.meta.label).toMatch(/^the 8 brightest of [\d,]+ stars above the horizon$/);
  });

  it('gives Bengaluru at local midnight a plausible, calm chord', () => {
    // A concrete, human-checkable snapshot of Shambu's own sky.
    const named = score.events.map((event) => ({
      star: catalog.find((s) => s.id === event.sourceId)?.name ?? event.sourceId,
      midi: event.midi,
    }));
    expect(named.length).toBe(8);
    // Every voice inside the three-octave span above A2.
    for (const { midi } of named) {
      expect(midi).toBeGreaterThanOrEqual(45);
      expect(midi).toBeLessThanOrEqual(45 + 12 * PITCH_SPAN_OCTAVES);
    }
  });
});
