/**
 * Slice B4 — the TONIGHT score, exported for the ear gate.
 *
 * Same shape and same reasoning as `b2ScoreExport.test.ts`, and deliberately the
 * SAME SKY: Shambu's own, at the same coordinates and date B2's arrival gate was
 * judged on. The point of the gate is to hear what B4 changed — the echo gone,
 * the bed gone, a pulse underneath — and a different sky would change the
 * comparison as well as the engine.
 *
 * Ten minutes of endless mode with the arrival in it, so the render can print
 * the opening and still calibrate its faders on a steady state the arrival is
 * not in. It asserts on every run and WRITES only when asked — see the note on
 * `WRITE` below, which is this slice closing the side-effect its predecessors
 * left open.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseStarCatalog, type ObserverInput } from '../src/engine/model/index.ts';
import {
  LEAD_QUANTISE_SECONDS,
  PULSE,
  STEP_SECONDS,
  prepareSession,
  renderWindow,
} from '../src/engine/mapping/index.ts';

const catalog = parseStarCatalog(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../public/data/stars.hyg.subset.json', import.meta.url)),
      'utf8',
    ),
  ),
);

/** Shambu's own sky — the one every ear gate since B2 has been judged on. */
const BENGALURU: ObserverInput = {
  latitude: 12.9719,
  longitude: 77.5937,
  dateISO: '1993-08-01',
  timeMinutes: 0,
  tzOffsetMinutes: 330,
};

const SECONDS = 600;

/**
 * THE EXPORT IS AN ACT — Slice B4, 2026-09-11.
 *
 * This file writes a score into `docs/`, and those scores are the EVIDENCE a
 * finished slice was judged on. Running `npm test` for an unrelated reason
 * rewrites them with the current engine's output — B4 did exactly that to
 * `docs/a4-score.json` and `docs/b2-tonight-score.json`, and both had to be
 * restored from git. It is the same defect B3 closed twice already: an audition
 * republishing the live calibration, and an e2e run re-arming a closed visual
 * gate. Publication is deliberate.
 *
 * The ASSERTIONS still run on every push — a broken export still fails the
 * suite. Only the WRITE is gated:
 *
 *   B4_SCORE=1 npx vitest run test/b4ScoreExport.test.ts
 */
const WRITE = Boolean(process.env.B4_SCORE);

describe('B4 tonight score export — the pulse, the bedless lens, no echo', () => {
  it('exports ten minutes of endless mode with the arrival and the grid in it', () => {
    const plan = prepareSession(catalog, BENGALURU, { mode: 'endless' });
    const window = renderWindow(plan, 0, SECONDS);
    const arrival = plan.arrival;

    expect(arrival.seconds).toBeGreaterThan(0);
    expect(window.events.length).toBeGreaterThan(100);

    const roleFirst = (role: string): number =>
      Math.min(...window.events.filter((e) => e.role === role).map((e) => e.startSeconds));

    // THE B2 ARRIVAL IS KEPT. The pulse enters with the figuration, not before:
    // the opening gesture is still a sky arriving, and the grid arrives with the
    // weave that rides it.
    expect(roleFirst('ground')).toBe(0);
    expect(roleFirst('chord')).toBe(0);
    expect(roleFirst('figuration')).toBeGreaterThanOrEqual(arrival.gestureSeconds);
    expect(roleFirst('lead')).toBeGreaterThanOrEqual(arrival.leadInSeconds);
    expect(arrival.seconds).toBeLessThan(200);

    // THE PULSE IS IN THE FILE, not just in the engine that wrote it.
    const figuration = window.events.filter((e) => e.role === 'figuration');
    for (const note of figuration) {
      const off = note.startSeconds - Math.round(note.startSeconds / STEP_SECONDS) * STEP_SECONDS;
      expect(Math.abs(off), `figuration at ${note.startSeconds}s is off the grid`).toBeLessThan(1e-3);
    }
    const lead = window.events.filter((e) => e.role === 'lead');
    for (const note of lead) {
      const off =
        note.startSeconds -
        Math.round(note.startSeconds / LEAD_QUANTISE_SECONDS) * LEAD_QUANTISE_SECONDS;
      expect(Math.abs(off), `lead at ${note.startSeconds}s is off the half-bar`).toBeLessThan(1e-3);
    }

    const payload = {
      exportedFor: 'Slice B4 ear gate — simple music (HALT: the echo, the bed, the pulse)',
      pulse: {
        bpm: PULSE.bpm,
        stepSeconds: STEP_SECONDS,
        stepsPerBar: PULSE.stepsPerBar,
        leadQuantiseSeconds: LEAD_QUANTISE_SECONDS,
        humanizeSeconds: PULSE.humanizeSeconds,
      },
      arrival: {
        seconds: arrival.seconds,
        gestureSeconds: arrival.gestureSeconds,
        figurationInSeconds: arrival.figurationInSeconds,
        leadInSeconds: arrival.leadInSeconds,
      },
      endless: {
        seconds: SECONDS,
        horizonSeconds: plan.movementPlan.horizonSeconds,
        movements: plan.movementPlan.movements
          .filter((m) => m.fromSeconds < SECONDS)
          .map((m) => ({
            index: m.index,
            fromSeconds: m.fromSeconds,
            toSeconds: m.toSeconds,
            transitionSeconds: m.transitionSeconds,
            pattern: m.pattern,
            registerOffset: m.registerOffset,
            anchor: m.anchor,
          })),
        window,
      },
    };

    if (WRITE) {
      writeFileSync(
        fileURLToPath(new URL('../docs/b4-tonight-score.json', import.meta.url)),
        `${JSON.stringify(payload, null, 2)}\n`,
      );
    }
  });
});
