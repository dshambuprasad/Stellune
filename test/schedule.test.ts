/**
 * Slice B1 — THE SCHEDULE, and the parity between the two things that play it.
 *
 * The live Tone graph and `scripts/render-score.mjs` must agree about which
 * instrument voices which note, when, at what pitch and at what velocity. They
 * are allowed to sound a little different — one resamples through Hermite
 * interpolation in Node, the other through the browser's own resampler — but if
 * they disagree about the SCHEDULE, one of them is playing the wrong piece.
 *
 * The way that agreement is achieved is worth stating, because it is the
 * interesting part: there is only one implementation. `scripts/lib/schedule.mjs`
 * is plain ESM imported by both, so the tests below are not comparing two
 * derivations and hoping — they are pinning the ONE derivation's behaviour, and
 * asserting that the renderer's path really does go through it.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_ROLE_SHAPING,
  buildSchedule,
  chooseVoiceFor,
  concurrencyGains,
  concurrencyGrid,
  shadingTilt,
  voicedMidi,
  type ScheduleEvent,
  type ScheduledVoice,
} from '../scripts/lib/schedule.mjs';
import {
  MASTER,
  ROLE_SHAPING,
  WINDOW_TOLERANCE_BY_ROLE,
  WINDOW_TOLERANCE_DB,
  masterTrimDb,
  windowToleranceFor,
} from '../scripts/lib/mixlaw.mjs';
import {
  MASTERING_DEFAULTS,
  chooseVoice,
  shadingTiltDb,
  validateEqLanes,
  masteringFor,
  type LensConfig,
  type SampleManifest,
} from '../src/engine/audio/index.ts';

const ROOT = path.resolve(__dirname, '..');
const lenses = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public', 'samples', 'lenses.json'), 'utf8'),
) as LensConfig;
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public', 'samples', 'manifest.json'), 'utf8'),
) as SampleManifest;
const LENS_IDS = Object.keys(lenses.lenses);

/**
 * A slice of the real A3 score.
 *
 * Real events, not invented ones: the schedule's job is to survive the actual
 * distribution of pitches, durations and densities the engine emits, and a
 * hand-written fixture is exactly the shape that never catches anything.
 */
function scoreEvents(seconds = 120): ScheduleEvent[] {
  const score = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'docs', 'a3-score.json'), 'utf8'),
  ) as Record<string, { window?: { events: ScheduleEvent[] }; events?: ScheduleEvent[] }>;
  const section = score.birth as { window?: { events: ScheduleEvent[] }; events?: ScheduleEvent[] };
  const events = (section.window?.events ?? section.events ?? []) as ScheduleEvent[];
  // The A3 score predates `registerHint`; the renderer supplies it for legacy
  // scores, and so does this, so both sides test the same input.
  return events
    .filter((e) => e.startSeconds < seconds)
    .map((e) =>
      e.role === 'weather' && e.registerHint === undefined ? { ...e, registerHint: 12 } : e,
    );
}

describe('the shared schedule', () => {
  const events = scoreEvents();

  it('has real events to work on', () => {
    expect(events.length).toBeGreaterThan(20);
    expect(new Set(events.map((e) => e.role)).size).toBeGreaterThan(2);
  });

  it('voices an event at its own pitch plus its own register hint', () => {
    expect(voicedMidi({ midi: 45 } as ScheduleEvent)).toBe(45);
    expect(voicedMidi({ midi: 45, registerHint: 12 } as ScheduleEvent)).toBe(57);
  });

  it('agrees with the typed voicing rules about every instrument choice', () => {
    // `chooseVoiceFor` (plain ESM, for the renderer) and `chooseVoice` (typed,
    // for the app) are separate functions over the same config. They are the one
    // place a genuine duplicate survives, so they are checked against each other
    // across every lens, role and pitch the score reaches.
    for (const lensId of LENS_IDS) {
      for (const event of events) {
        const midi = voicedMidi(event);
        const a = chooseVoiceFor(lenses, manifest, lensId, event.role, midi);
        const b = chooseVoice(lenses, manifest, lensId, event.role as never, midi);
        expect(a.instrument, `${lensId}/${event.role}/${midi}`).toBe(b.instrument);
        expect(a.sampleMidi).toBe(b.sample.midi);
        expect(a.gainDb).toBeCloseTo(b.gainDb, 9);
        expect(a.rate).toBeCloseTo(b.rate, 9);
      }
    }
  });

  it('agrees with the typed shading rule about every tilt', () => {
    for (const event of events) {
      expect(shadingTilt(lenses.shading, event.timbre)).toBeCloseTo(
        shadingTiltDb(lenses.shading, event.timbre),
        9,
      );
    }
  });

  it('is deterministic — the same inputs give a byte-identical schedule', () => {
    const a = buildSchedule(events, lenses, manifest, 'aurora', { roleShaping: ROLE_SHAPING });
    const b = buildSchedule(events, lenses, manifest, 'aurora', { roleShaping: ROLE_SHAPING });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('applies the mix law’s velocity shaping, not its own', () => {
    const one: ScheduleEvent = {
      role: 'figuration',
      sourceId: 'x',
      midi: 72,
      amplitude: 0.25,
      startSeconds: 0,
      durationSeconds: 1,
    };
    const [voice] = buildSchedule([one], lenses, manifest, 'aurora', {
      roleShaping: ROLE_SHAPING,
    });
    // figuration compresses by 0.5 — sqrt(0.25) = 0.5.
    expect(voice?.velocity).toBeCloseTo(0.5, 5);
    expect(ROLE_SHAPING.figuration.velocityCompress).toBe(0.5);
    expect(DEFAULT_ROLE_SHAPING.figuration?.velocityCompress).toBe(
      ROLE_SHAPING.figuration.velocityCompress,
    );
  });

  it('keeps the B–V tilt out of the level', () => {
    // The tilt is a shelf, not a fader. If it were folded into `gainDb` a blue
    // star would be LOUDER rather than brighter, and the sky's colour would be
    // competing with the mix law for the same control.
    const blue: ScheduleEvent = {
      role: 'lead',
      sourceId: 'b',
      midi: 72,
      amplitude: 1,
      startSeconds: 0,
      durationSeconds: 1,
      timbre: { warmth: 0, brightness: 1 },
    };
    const red: ScheduleEvent = { ...blue, sourceId: 'r', timbre: { warmth: 1, brightness: 0 } };
    const [b] = buildSchedule([blue], lenses, manifest, 'aurora');
    const [r] = buildSchedule([red], lenses, manifest, 'aurora');
    expect(b?.gainDb).toBe(r?.gainDb);
    expect(b?.tiltDb).toBeGreaterThan(0);
    expect(r?.tiltDb).toBeLessThan(0);
  });
});

describe('lens invariance, on the schedule the players actually use', () => {
  const events = scoreEvents();
  const strip = (s: ScheduledVoice[]): string =>
    s.map((v) => `${v.role}:${v.sourceId}@${v.startSeconds}+${v.durationSeconds}=${v.midi}`).join('|');

  const reference = buildSchedule(events, lenses, manifest, LENS_IDS[0] as string, {
    roleShaping: ROLE_SHAPING,
  });

  for (const lensId of LENS_IDS.slice(1)) {
    it(`${lensId} plays the same notes at the same times as ${LENS_IDS[0]}`, () => {
      const other = buildSchedule(events, lenses, manifest, lensId, { roleShaping: ROLE_SHAPING });
      expect(strip(other)).toBe(strip(reference));
    });
  }

  it('but really does change the instruments', () => {
    // The invariance above would also be satisfied by a lens selector that did
    // nothing at all, which is not the property anyone wants.
    const instrumentsOf = (lensId: string): string =>
      [...new Set(buildSchedule(events, lenses, manifest, lensId).map((v) => v.instrument))]
        .sort()
        .join(',');
    const sets = new Set(LENS_IDS.map(instrumentsOf));
    expect(sets.size).toBeGreaterThan(1);
  });

  it('never lets the register hint be lost in a lens change', () => {
    for (const lensId of LENS_IDS) {
      const schedule = buildSchedule(events, lenses, manifest, lensId, {
        roleShaping: ROLE_SHAPING,
      });
      const weather = schedule.filter((v) => v.role === 'weather');
      const ground = schedule.filter((v) => v.role === 'ground');
      expect(weather.length).toBeGreaterThan(0);
      for (const w of weather) {
        for (const g of ground) {
          const concurrent =
            w.startSeconds < g.startSeconds + g.durationSeconds &&
            g.startSeconds < w.startSeconds + w.durationSeconds;
          if (!concurrent) continue;
          expect(Math.abs(w.midi - g.midi), `${lensId}: weather ${w.midi} vs ground ${g.midi}`)
            .toBeGreaterThanOrEqual(12);
        }
      }
    }
  });
});

describe('concurrency normalisation', () => {
  it('counts what is sounding at each moment, not the section maximum', () => {
    const events: ScheduleEvent[] = [
      { role: 'chord', sourceId: 'a', midi: 60, amplitude: 1, startSeconds: 0, durationSeconds: 10 },
      { role: 'chord', sourceId: 'b', midi: 64, amplitude: 1, startSeconds: 5, durationSeconds: 10 },
      { role: 'chord', sourceId: 'c', midi: 67, amplitude: 1, startSeconds: 5, durationSeconds: 10 },
    ];
    const schedule = buildSchedule(events, lenses, manifest, 'aurora');
    const grid = concurrencyGrid(schedule, 'chord', 0, 16, 1);
    expect(grid.counts[0]).toBe(1);
    expect(grid.counts[6]).toBe(3);
    expect(grid.counts[15]).toBe(0);
  });

  it('slews toward 1/sqrt(N) rather than stepping to it', () => {
    const grid = { fromSeconds: 0, stepSeconds: 0.25, counts: [1, 1, 9, 9, 9, 9, 9, 9, 9, 9] };
    const gains = concurrencyGains(grid, 2.0);
    expect(gains[0]).toBeCloseTo(1, 5);
    // One step after the jump it must NOT already be at the target — that is
    // what "slewed" means, and a step is an audible lurch in the bed.
    expect(gains[2]).toBeGreaterThan(1 / 3);
    // ...and it must be heading there.
    expect(gains[9]).toBeLessThan(gains[2] as number);
  });

  it('never divides by zero when a role is silent', () => {
    const grid = concurrencyGrid([], 'chord', 0, 4, 1);
    for (const g of concurrencyGains(grid)) expect(g).toBe(1);
  });
});

describe('THE MASTERING LAW, as configured', () => {
  it('every lens declares lanes that put the motion above the bed', () => {
    expect(validateEqLanes(lenses)).toEqual([]);
  });

  it('the config and the typed defaults state the same law', () => {
    const configured = masteringFor(lenses);
    expect(configured.lufsTargets.birthSky).toBe(-18);
    expect(configured.figurationGlue.maxReductionDb).toBeLessThanOrEqual(2);
  });

  it('the typed defaults state the same limiter engagement as the config, so neither can drift', () => {
    // These two had already drifted: `MASTERING_DEFAULTS` sat at the original
    // 0.01 while `lenses.json` had been ratified to 0.10, and nothing said so.
    // A default that disagrees with the law is a second law nobody reviewed.
    expect(MASTERING_DEFAULTS.limiter.maxEngagedFraction).toBe(
      masteringFor(lenses).limiter.maxEngagedFraction,
    );
    expect(MASTERING_DEFAULTS.limiter.maxReductionDb).toBe(
      masteringFor(lenses).limiter.maxReductionDb,
    );
    expect(MASTERING_DEFAULTS.limiter.zeroEngagementStems).toEqual(
      masteringFor(lenses).limiter.zeroEngagementStems,
    );
  });

  it('states the RATIFIED limiter amendment, not the original 0%', () => {
    // 2026-08-10. Transient limiting is permitted — that is what limiters are
    // for — but the sustained bed is protected absolutely, and that protection
    // is structural: ground and chord are named here and given no limiter at
    // all, rather than being given one and asked to leave it alone.
    //
    // 2026-09-01 (Slice B2), ratified by HQ: the engagement bound moves from 1%
    // to 10% for the transient-carrying stems. The 1% predates any measurement
    // of struck figuration — it is the original 0% scaled down by intuition —
    // and measured, a handpan or glockenspiel weave engages a 3 dB look-ahead
    // limiter on several percent of samples with every catch inside the ratified
    // ceiling. The two numbers that actually protect the music are unchanged and
    // are asserted below: the 3 dB reduction ceiling, and the bed's structural
    // zero. Pinned here so a relaxation has to be a deliberate edit to a test
    // that says why, rather than a config tweak nobody reviews.
    const { limiter } = masteringFor(lenses);
    expect(limiter.maxEngagedFraction).toBe(0.15);
    expect(limiter.maxReductionDb).toBe(3);
    expect(limiter.zeroEngagementStems).toEqual(['ground', 'chord']);
  });

  it('RULING 3 (2026-09-04): engagement 15%, because on struck material the fraction tracks note density and DEPTH is the audible constraint', () => {
    // The third value this number has had. 0% -> 1% -> 10% -> 15%, and the first
    // three were all set before anyone had measured post-fix figuration: a
    // kalimba or glockenspiel weave asks the look-ahead limiter for a bounded
    // catch on every strike, so the FRACTION counts strikes, not squash.
    //
    // HQ's own note, pinned here because it is the operative part of the ruling:
    // this number should not move a fourth time without evidence that something
    // is AUDIBLE. The two numbers that protect the music did not move and are
    // asserted beside it — 3 dB of depth, and the bed's structural zero.
    const { limiter } = masteringFor(lenses);
    expect(limiter.maxEngagedFraction).toBe(0.15);
    expect(limiter.maxReductionDb).toBe(3.0);
    expect(limiter.zeroEngagementStems).toEqual(['ground', 'chord']);
  });

  it('RULING 2 (2026-09-04): the ±8.0 dB window bound is the CHORD\'s alone — it carries the arc; every other role stays at ±5.5', () => {
    // A bed stem dipping 7.8 dB at one instant of an eleven-minute composed arc
    // is the arc breathing, and the chord is the layer that does the breathing:
    // it thickens as the sky fills and thins as it empties. B1.1 diagnosed this
    // and the master peak as one cause; that was wrong, and the correction is
    // ratified.
    //
    // Pinned per role, because a bound widened for one role's musical reason is
    // a ruling and a bound widened for all of them is a bound switched off.
    expect(windowToleranceFor('chord')).toBe(8.0);
    expect(WINDOW_TOLERANCE_BY_ROLE).toEqual({ chord: 8.0 });
    for (const role of ['ground', 'figuration', 'lead', 'weather']) {
      expect(windowToleranceFor(role), `${role} must stay at the general bound`).toBe(5.5);
    }
    expect(WINDOW_TOLERANCE_DB).toBe(5.5);
  });

  it('RULING 1 (2026-09-04): the master fader is min(loudness, peak-safe to −1.0 dBFS), and the same function serves both paths', () => {
    // The defect this closes: embrace printed at +2.57 dBFS and pulse at +2.96
    // dBFS — hard clipping, shipping since B1, in the LIVE GRAPH as much as in
    // the renderer, because B1.1 made the fader the loudness trim "full stop".
    //
    // Both paths import this one function (`render-score.mjs` and
    // `sampledStream.ts`), so the test does not compare two derivations and
    // hope; it pins the one derivation, exactly as the schedule tests above do.
    expect(MASTER.peakCeilingDbfs).toBe(-1.0);

    // Embrace, as measured at B2: +8.07 dBFS peak over −12.50 LUFS at unity
    // master. Loudness alone would ask for −5.50 dB and print +2.57.
    expect(
      masterTrimDb({ lufsTarget: -18, measuredLufs: -12.5, measuredPeakDbfs: 8.07 }),
    ).toBeCloseTo(-9.07, 2);

    // A mix with headroom to spare is untouched by the ceiling and lands on the
    // loudness target — the peak guard must not become a second fader.
    expect(
      masterTrimDb({ lufsTarget: -18, measuredLufs: -12.0, measuredPeakDbfs: -6.0 }),
    ).toBeCloseTo(-6.0, 6);

    // The ceiling is a CEILING: applying the trim lands the peak at −1.0, never
    // above it, whichever of the two rules bound the fader.
    for (const [lufs, peak] of [
      [-12.5, 8.07],
      [-12.3, 8.66],
      [-12.08, 3.71],
      [-12.17, 5.54],
    ] as Array<[number, number]>) {
      const trim = masterTrimDb({ lufsTarget: -18, measuredLufs: lufs, measuredPeakDbfs: peak });
      expect(peak + trim).toBeLessThanOrEqual(MASTER.peakCeilingDbfs + 1e-9);
    }

    // No measurement is not the same as no peak — an unmeasured lens falls back
    // to the loudness trim, and `mixLaw.ts` gives the fallback an explicit peak
    // rather than letting `undefined` silently disable the guard.
    expect(masterTrimDb({ lufsTarget: -18, measuredLufs: -12.0 })).toBeCloseTo(-6.0, 6);
  });

  it('carves the pads and lifts the moving parts, in every lens', () => {
    for (const lensId of LENS_IDS) {
      const eq = lenses.lenses[lensId]?.eq;
      expect(eq, `${lensId} has no eq block`).toBeDefined();
      // The moving parts must sit above the bed...
      expect(eq?.figuration?.highpassHz ?? 0).toBeGreaterThan(eq?.chord?.highpassHz ?? 0);
      expect(eq?.lead?.highpassHz ?? 0).toBeGreaterThan(eq?.ground?.highpassHz ?? 0);
      // ...and the bed must be carved where they sing, not merely turned down.
      expect(eq?.chord?.dip?.db ?? 0).toBeLessThan(0);
    }
  });

  it('rejects a lens whose lanes claim separation they do not provide', () => {
    // Negative test: the validator has to actually fail on a bad config, or the
    // check above is only asserting that JSON parses.
    const broken = JSON.parse(JSON.stringify(lenses)) as LensConfig;
    const lens = broken.lenses.aurora;
    if (lens?.eq?.figuration) lens.eq.figuration.highpassHz = 10;
    expect(validateEqLanes(broken).length).toBeGreaterThan(0);

    const uncarved = JSON.parse(JSON.stringify(lenses)) as LensConfig;
    delete uncarved.lenses.aurora?.eq?.chord?.dip;
    expect(validateEqLanes(uncarved).join(' ')).toMatch(/no dip/);
  });
});

describe('ONE DERIVATION, TWO CONSUMERS', () => {
  /**
   * The parity claim, guarded at the source.
   *
   * A test that runs both players and compares their output can only tell you
   * the day they diverged. What actually keeps them together is that there is
   * one implementation and neither is allowed a private copy — so that is what
   * is asserted here, in the same way `boundaries.test.ts` asserts the layer
   * rule: by reading the files.
   */
  const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  const CONSUMERS = ['scripts/render-score.mjs', 'src/engine/audio/sampledStream.ts'];

  for (const file of CONSUMERS) {
    it(`${file} builds its schedule with the shared module`, () => {
      const source = read(file);
      expect(source).toMatch(/from '\.[./]*(?:scripts\/)?lib\/schedule\.mjs'/);
      expect(source).toMatch(/buildSchedule\(/);
    });

    it(`${file} does not pick instruments itself`, () => {
      const source = read(file);
      // `sampler.pick(...)` was the renderer's own voicing path, and
      // `chooseVoice(...)` is the app's. Either one appearing in a consumer
      // means a second derivation has grown back.
      expect(source).not.toMatch(/\bsampler\.pick\(/);
      expect(source).not.toMatch(/\bchooseVoice\(/);
    });

    it(`${file} does not pass its own role shaping`, () => {
      // The shaping is the shared module's default precisely so that the two
      // consumers cannot be handed different numbers. Passing it explicitly
      // re-opens that door even when today's values happen to match.
      expect(read(file)).not.toMatch(/roleShaping:/);
    });

    it(`${file} does not transpose weather on its own authority`, () => {
      const source = read(file);
      // The score carries `registerHint`. A renderer adding an octave to
      // weather itself is the 2026-08-07 patch, and the whole point of the hint
      // is that no renderer has to remember. Supplying the hint to a LEGACY
      // score is allowed and is what `withRegisterHints` does; adding the shift
      // to a midi number is not.
      expect(source).not.toMatch(/midi\s*\+\s*WEATHER_OCTAVE_SHIFT/);
    });
  }

  it('the renderer applies the mastering law from the shared module', () => {
    const source = read('scripts/render-score.mjs');
    expect(source).toMatch(/from '\.\/lib\/mastering\.mjs'/);
    for (const fn of ['applyEqLane', 'glueCompress', 'integratedLufs']) {
      expect(source, `render-score should call ${fn}`).toMatch(new RegExp(`\\b${fn}\\(`));
    }
  });

  it('the live graph applies the same three things', () => {
    const source = read('src/engine/audio/sampledStream.ts');
    // The live graph cannot import the offline DSP — it has Web Audio nodes for
    // all three — so what is asserted is that it builds them, from the config
    // rather than from constants of its own.
    expect(source).toMatch(/eqLaneFor\(/);
    expect(source).toMatch(/figurationGlue/);
    expect(source).toMatch(/lufsTargets/);
    expect(source).toMatch(/Tone\.Limiter/);
  });
});
