/**
 * HQ audition-path export (Atlas HQ, A3 review).
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

describe('A3 score export for the HQ audition render', () => {
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

    const payload = {
      exportedFor: 'Atlas HQ audition render (sketch-voice synthesizer)',
      birth: { sessionSeconds: T, window: birth },
      endless: { seconds: 180, window: endless },
    };
    writeFileSync(
      fileURLToPath(new URL('../docs/a3-score.json', import.meta.url)),
      JSON.stringify(payload),
    );
  });
});
