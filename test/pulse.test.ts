/**
 * SLICE B4 — the three ratified decisions, pinned where a unit test can reach
 * them: THE ECHO (one table, delay zero, a room not a hall), THE PULSE (one
 * grid, stated once), and THE HONESTY LINE (the panel says what the engine
 * does).
 *
 * These are decisions rather than audio, so they are tested as decisions. The
 * sound they produce is judged by the owner's ear, which is the only gate that
 * can judge it; what a test can guarantee is that the two paths are reading the
 * same numbers, and that the numbers are the ones that were ratified.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  REVERB,
  ROLE_SENDS,
  reverbDecaySeconds,
} from '../scripts/lib/mixlaw.mjs';
import { SEND_LEVELS } from '../src/engine/audio/index.ts';
import {
  BAR_SECONDS,
  LEAD_QUANTISE_SECONDS,
  PULSE,
  STEP_SECONDS,
  accentAt,
  poolIndexAt,
  quantiseToHalfBar,
  stepIndexAt,
  stepStartSeconds,
} from '../src/engine/mapping/index.ts';
import { DEFAULT_LIVING_SKY_CONFIG } from '../src/engine/mapping/index.ts';
import { HONESTY_TEXT } from '../src/app/format.ts';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('THE ECHO — ratified 2026-09-11', () => {
  it('is gone: every role sends zero to the delay', () => {
    // The owner heard it as "resound". It was a literal ping-pong repeat of
    // every note in the two roles that carry the melody — figuration 0.18, lead
    // 0.22 — and it had never been put in front of his ear as a choice.
    for (const [role, send] of Object.entries(ROLE_SENDS)) {
      expect(send.delay, `${role} still sends to the delay`).toBe(0);
    }
  });

  it('sends each role to the room by the ratified amount', () => {
    expect(ROLE_SENDS).toEqual({
      ground: { reverb: 0.06, delay: 0 },
      chord: { reverb: 0.1, delay: 0 },
      figuration: { reverb: 0.07, delay: 0 },
      lead: { reverb: 0.1, delay: 0 },
      weather: { reverb: 0.2, delay: 0 },
    });
  });

  it('is ONE table — the live graph and the renderer cannot disagree', () => {
    // B3 found the master fader written out twice and unified it; this is the
    // same defect in the same shape. `SEND_LEVELS` must BE `ROLE_SENDS`, not
    // equal a copy of it: a copy is what drifted last time.
    expect(SEND_LEVELS).toBe(ROLE_SENDS);
    // And neither path may keep a private table of its own.
    expect(read('scripts/render-score.mjs')).toContain('const SEND = ROLE_SENDS;');
    expect(read('src/engine/audio/mixLaw.ts')).toContain(
      'export const SEND_LEVELS: Record<VoiceRole, { reverb: number; delay: number }> = ROLE_SENDS;',
    );
  });

  it('is a room, not a hall — and both paths build the same one', () => {
    expect(REVERB.combFeedback).toBe(0.55);
    expect(REVERB.dampHz).toBe(1800);
    // The live graph wants an RT60 in seconds and the offline network wants a
    // comb coefficient. Deriving one from the other is what stopped the two
    // rooms being a factor of five apart (the renderer's tail was ~1.5 s and the
    // live graph's was 8 s from the same ratified word "reverb").
    expect(reverbDecaySeconds(0.84)).toBeCloseTo(1.5, 1);
    expect(reverbDecaySeconds()).toBeCloseTo(0.44, 2);
    expect(reverbDecaySeconds()).toBeLessThan(reverbDecaySeconds(0.84));
    // Neither path may hardcode a tail of its own.
    expect(read('src/engine/audio/sampledStream.ts')).toContain('decay: reverbDecaySeconds(),');
    expect(read('scripts/render-score.mjs')).toContain('decay: REVERB.combFeedback,');
  });
});

describe('THE PULSE — the sky decides which note, the grid decides when', () => {
  it('is 66 bpm in eighth notes', () => {
    expect(PULSE.bpm).toBe(66);
    expect(PULSE.stepsPerBeat).toBe(2);
    expect(STEP_SECONDS).toBeCloseTo(0.4545, 4);
    expect(BAR_SECONDS).toBeCloseTo(STEP_SECONDS * 8, 12);
    expect(LEAD_QUANTISE_SECONDS).toBeCloseTo(STEP_SECONDS * 4, 12);
  });

  it('is a pure function of absolute piece time, so partitioning cannot move it', () => {
    for (const t of [0, 0.4, 3.999, 120, 2207.273, 86400]) {
      expect(stepStartSeconds(stepIndexAt(t))).toBeLessThanOrEqual(t + 1e-9);
      expect(stepStartSeconds(stepIndexAt(t) + 1)).toBeGreaterThan(t - 1e-9);
    }
    // No accumulated phase anywhere: step i begins at i × STEP_SECONDS, always.
    expect(stepStartSeconds(1000)).toBeCloseTo(1000 * STEP_SECONDS, 9);
  });

  it('accents every 4th step and half-accents every 2nd', () => {
    const bar = Array.from({ length: 8 }, (_, i) => accentAt(i));
    expect(bar).toEqual([
      PULSE.accentVelocity,
      PULSE.plainVelocity,
      PULSE.halfAccentVelocity,
      PULSE.plainVelocity,
      PULSE.accentVelocity,
      PULSE.plainVelocity,
      PULSE.halfAccentVelocity,
      PULSE.plainVelocity,
    ]);
    // The same bar of the piece is accented the same way, forever.
    for (let i = 0; i < 64; i++) expect(accentAt(i + 8)).toBe(accentAt(i));
    expect(PULSE.accentVelocity).toBeGreaterThan(PULSE.halfAccentVelocity);
    expect(PULSE.halfAccentVelocity).toBeGreaterThan(PULSE.plainVelocity);
  });

  it('CYCLES the pool in a fixed order rather than re-picking from it', () => {
    // One member per step, wrapping — which is what makes a repeating figure.
    const size = 5;
    const walk = Array.from({ length: 12 }, (_, i) => poolIndexAt(i, size));
    expect(walk).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1]);
    expect(PULSE.poolAdvancePerStep).toBe(1);
    // A pool that has changed size shifts the figure; it does not restart it.
    expect(poolIndexAt(7, 6)).toBe(1);
    // And an empty pool is answered, not divided by.
    expect(poolIndexAt(3, 0)).toBe(0);
  });

  it('quantises the lead to the NEAREST half-bar, never before zero', () => {
    expect(quantiseToHalfBar(0)).toBe(0);
    expect(quantiseToHalfBar(0.2)).toBe(0);
    expect(quantiseToHalfBar(LEAD_QUANTISE_SECONDS * 3 + 0.1)).toBeCloseTo(
      LEAD_QUANTISE_SECONDS * 3,
      9,
    );
    expect(quantiseToHalfBar(LEAD_QUANTISE_SECONDS * 3 - 0.1)).toBeCloseTo(
      LEAD_QUANTISE_SECONDS * 3,
      9,
    );
    // Nearest, so a note never moves by more than half of the interval.
    for (const t of [12.3, 61.7, 420.04, 2207.9]) {
      expect(Math.abs(quantiseToHalfBar(t) - t)).toBeLessThanOrEqual(
        LEAD_QUANTISE_SECONDS / 2 + 1e-9,
      );
    }
  });

  it('is SIMPLE by ratification: no humanisation, no swing', () => {
    expect(PULSE.humanizeSeconds).toBe(0);
    expect(PULSE.swingRatio).toBe(0);
    // …and the mapping config reads the grid rather than choosing its own tempo.
    expect(DEFAULT_LIVING_SKY_CONFIG.figurationSlotSeconds).toBe(STEP_SECONDS);
    expect(DEFAULT_LIVING_SKY_CONFIG.figurationSlots).toBe(PULSE.stepsPerBar);
    expect(DEFAULT_LIVING_SKY_CONFIG.figurationHumanizeSeconds).toBe(0);
  });
});

describe('THE HONESTY LINE — it says what the engine does', () => {
  it('no longer claims a star sounds when it really rises', () => {
    // True until B4 put a grid under the figuration. The panel is the product's
    // spine: it is rewritten when the engine changes, never quietly dropped.
    expect(HONESTY_TEXT).not.toMatch(/really rises|truly rises/);
    expect(read('index.html')).not.toMatch(/truly rises/);
  });

  it('says that the sky chooses the notes and the rhythm is composed', () => {
    expect(HONESTY_TEXT).toMatch(/sky chooses the notes/);
    expect(HONESTY_TEXT).toMatch(/rhythm is composed/);
    // The parts that were true before are still there, unsoftened.
    expect(HONESTY_TEXT).toMatch(/these are the real stars above this place/);
    expect(HONESTY_TEXT).toMatch(/artistic choices/);
    expect(HONESTY_TEXT).toMatch(/never a claim about what space literally sounds like/);
  });
});
