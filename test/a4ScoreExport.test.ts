/**
 * HQ audition-path export (Atlas HQ, A4 review).
 *
 * The browser render is too slow for the ear gate (~30 min/session), so HQ
 * renders the TRUE engine score with its own offline synthesizer instead. This
 * "test" dumps the full birth-sky session + 3 min of endless mode as JSON for
 * that pipeline. It asserts basic sanity so a broken export cannot pass silently.
 *
 * Deliberately NOT part of the musical test suite — it writes a file as a side
 * effect. Remove or skip once Slice B's fast sampled renderer lands.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseStarCatalog, type ObserverInput } from '../src/engine/model/index.ts';
import {
  prepareSession,
  renderWindow,
  type SessionPlan,
} from '../src/engine/mapping/index.ts';

const catalog = parseStarCatalog(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../public/data/stars.hyg.subset.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const BENGALURU: ObserverInput = {
  latitude: 12.9719,
  longitude: 77.5937,
  dateISO: '1993-08-01',
  timeMinutes: 0,
  tzOffsetMinutes: 330,
};

describe('A4 score export for the HQ audition render', () => {
  it('exports the full birth-sky session and 3 min of endless mode', () => {
    const birthPlan: SessionPlan = prepareSession(catalog, BENGALURU, {});
    const anyPlan = birthPlan as unknown as Record<string, any>;
    const T: number =
      anyPlan.config?.sessionSeconds ?? anyPlan.sessionSeconds ?? 660;

    const birth = renderWindow(birthPlan, 0, T);

    const endlessPlan = prepareSession(catalog, BENGALURU, { mode: 'endless' });
    const endless = renderWindow(endlessPlan, 0, 180);

    expect(birth.events.length).toBeGreaterThan(50);
    expect(endless.events.length).toBeGreaterThan(20);
    expect(birthPlan.movementPlan.movements.length).toBeGreaterThan(2);
    expect(
      birthPlan.movementPlan.movements.some((m) => m.anchor.kind === 'bloom'),
    ).toBe(true);

    // A4 adds the form layer, so the export carries the movement plan too — HQ's
    // renderer can then mix each section on its own terms and, more importantly,
    // the movement boundaries are auditable without re-deriving them.
    const summarise = (p: SessionPlan) =>
      p.movementPlan.movements.map((m) => ({
        index: m.index,
        fromSeconds: m.fromSeconds,
        toSeconds: m.toSeconds,
        transitionSeconds: m.transitionSeconds,
        pattern: m.pattern,
        registerOffset: m.registerOffset,
        anchor: m.anchor,
        motif: m.motif ? { constellation: m.motif.constellation, degrees: m.motif.degrees } : null,
      }));

    const payload = {
      exportedFor: 'Atlas HQ audition render (sketch-voice synthesizer)',
      birth: {
        sessionSeconds: T,
        movements: summarise(birthPlan),
        bloomSeconds: birthPlan.bloomSeconds,
        window: birth,
      },
      endless: {
        seconds: 180,
        movements: summarise(endlessPlan),
        horizonSeconds: endlessPlan.movementPlan.horizonSeconds,
        window: endless,
      },
    };
    writeFileSync(
      fileURLToPath(new URL('../docs/a4-score.json', import.meta.url)),
      JSON.stringify(payload),
    );
  });
});
