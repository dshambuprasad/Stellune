/**
 * Slice B2 — the TONIGHT score, exported for the arrival's ear gate.
 *
 * `docs/a4-score.json` carries three minutes of endless mode, which was the
 * right length when endless mode had no shape: any three minutes of it were the
 * same three minutes. The arrival changes that. Its ear gate needs two things
 * in one file — the composed opening itself, and enough genuine steady state
 * AFTER it that `render-score.mjs` can calibrate its faders somewhere the
 * arrival is not. Calibrating on a window that is mostly arrival would measure
 * the deliberately-quiet opening and trim it back up, which is precisely the
 * shape the slice exists to put in.
 *
 * So: ten minutes of Tonight over Shambu's own sky, from which the ear gate
 * prints the first 150 seconds and calibrates on t = 200–400 s.
 *
 * Like `a4ScoreExport.test.ts`, this writes a file as a side effect and is a
 * test only in the sense that it refuses to export something broken.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseStarCatalog, type ObserverInput } from '../src/engine/model/index.ts';
import { prepareSession, renderWindow } from '../src/engine/mapping/index.ts';

const catalog = parseStarCatalog(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../public/data/stars.hyg.subset.json', import.meta.url)),
      'utf8',
    ),
  ),
);

/** Shambu's own sky — the one the ear gate is judged on. */
const BENGALURU: ObserverInput = {
  latitude: 12.9719,
  longitude: 77.5937,
  dateISO: '1993-08-01',
  timeMinutes: 0,
  tzOffsetMinutes: 330,
};

const SECONDS = 600;

describe('B2 tonight score export — the arrival, plus a steady state to calibrate on', () => {
  it('exports ten minutes of endless mode with the arrival in it', () => {
    const plan = prepareSession(catalog, BENGALURU, { mode: 'endless' });
    const window = renderWindow(plan, 0, SECONDS);
    const arrival = plan.arrival;

    // The export is only useful if the thing being auditioned is actually in it.
    expect(arrival.seconds).toBeGreaterThan(0);
    expect(window.events.length).toBeGreaterThan(100);

    const roleFirst = (role: string): number =>
      Math.min(...window.events.filter((e) => e.role === role).map((e) => e.startSeconds));

    expect(roleFirst('ground')).toBe(0);
    expect(roleFirst('chord')).toBe(0);
    expect(roleFirst('figuration')).toBeGreaterThanOrEqual(arrival.gestureSeconds);
    expect(roleFirst('lead')).toBeGreaterThanOrEqual(arrival.leadInSeconds);

    // And the calibration window the render will use must be past the arrival,
    // or the faders get set by the opening they are supposed to leave alone.
    expect(arrival.seconds).toBeLessThan(200);

    const payload = {
      exportedFor: 'Slice B2 ear gate — the arrival (HALT #1)',
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

    writeFileSync(
      fileURLToPath(new URL('../docs/b2-tonight-score.json', import.meta.url)),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  });
});
