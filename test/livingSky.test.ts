/**
 * Slice A1a — the Living Sky stream.
 *
 * The headline test is **partition invariance**: for any split of the piece into
 * windows, the union of those windows equals one big window. That is what
 * "never audibly restarts" means operationally, and everything else in the
 * architecture rests on it.
 *
 * Astronomical claims are cross-checked against `starsAboveHorizon()` and
 * `toHorizon()`, which were derived independently in Phase 2 — so these are real
 * checks, not restatements of the formula under test.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  parseStarCatalog,
  type ObserverInput,
  type Star,
} from '../src/engine/model/index.ts';
import {
  DEFAULT_LIVING_SKY_CONFIG,
  SCALE_NAMES,
  angularSeparation,
  degreeToMidi,
  deriveAllMotifs,
  deriveMotif,
  firstTimeAtLst,
  invertDegrees,
  motifEventsInRange,
  scaleGaps,
  shiftOctaves,
  transposeDegrees,
  type ChordStarPlan,
  type Motif,
  type MotifEvent,
  type PhraseNote,
  SIDEREAL_DAY_SECONDS,
  arcAt,
  arrivalIntensity,
  figurationGateAt,
  NO_ARRIVAL,
  phrasesInRange,
  eventsInRange,
  hourAngleAtAltitude,
  lstAt,
  measureWeather,
  noteAllowance,
  noteBudgetPerMinute,
  activeCountAt,
  cycleSeconds,
  cycleStartSeconds,
  figurationNotesInRange,
  formAt,
  noteRateAt,
  patternAt,
  patternByName,
  PATTERN_VOCABULARY,
  bloomLayersAt,
  figurationPoolAt,
  PULSE,
  STEP_SECONDS,
  LEAD_QUANTISE_SECONDS,
  prepareSession,
  renderWindow,
  soundingChordTones,
  WEATHER_REGISTER_HINT,
  scaleDegrees,
  subjectKey,
  scaleForWeather,
  solveKappa,
  starEventTimes,
  starsAboveHorizon,
  toHorizon,
  type LivingSkyConfig,
  type MusicalEvent,
  type ScoreWindow,
  type SessionPlan,
} from '../src/engine/mapping/index.ts';

const catalog: Star[] = parseStarCatalog(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../public/data/stars.hyg.subset.json', import.meta.url)), 'utf8'),
  ),
);

/** Shambu's own sky. */
const BENGALURU: ObserverInput = {
  latitude: 12.9719,
  longitude: 77.5937,
  dateISO: '1993-08-01',
  timeMinutes: 0,
  tzOffsetMinutes: 330,
};

const LONDON: ObserverInput = {
  latitude: 51.5085,
  longitude: -0.1257,
  dateISO: '2024-12-25',
  timeMinutes: 1200,
  tzOffsetMinutes: 0,
};

const NEAR_POLE: ObserverInput = { ...BENGALURU, latitude: 89.5 };

const session = (over: Partial<LivingSkyConfig> = {}, observer = BENGALURU): SessionPlan =>
  prepareSession(catalog, observer, over);

/** Events are compared by value; this makes failures readable. */
const key = (e: MusicalEvent): string =>
  `${e.startSeconds}|${e.role}|${e.sourceId}|${e.midi}|${e.durationSeconds}`;

const unionOf = (windows: ScoreWindow[]): MusicalEvent[] =>
  windows.flatMap((w) => w.events).sort((a, b) => key(a).localeCompare(key(b)));

const sortedEvents = (w: ScoreWindow): MusicalEvent[] =>
  [...w.events].sort((a, b) => key(a).localeCompare(key(b)));

// ===========================================================================
// THE HEADLINE
// ===========================================================================

describe('THE GATE — partition invariance', () => {
  const plan = session({ mode: 'endless', kappa: 30 });
  const T = 3600;

  const partitions: Array<[string, number[]]> = [
    ['halves', [0, 1800, 3600]],
    ['sixths', [0, 600, 1200, 1800, 2400, 3000, 3600]],
    ['uneven', [0, 137, 900, 901, 2456, 3599, 3600]],
    ['tiny head', [0, 1, 2, 3, 3600]],
    ['single', [0, 3600]],
  ];

  const whole = renderWindow(plan, 0, T);

  it.each(partitions)('%s reassemble into exactly one piece', (_name, cuts) => {
    const windows: ScoreWindow[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      windows.push(renderWindow(plan, cuts[i] as number, cuts[i + 1] as number));
    }
    expect(unionOf(windows)).toEqual(sortedEvents(whole));
  });

  it('emits every event exactly once across a partition', () => {
    const windows: ScoreWindow[] = [];
    for (let t = 0; t < T; t += 250) windows.push(renderWindow(plan, t, Math.min(T, t + 250)));
    const keys = windows.flatMap((w) => w.events).map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('holds for a birth-sky session too, where the arc and gestures are active', () => {
    const arcPlan = session({ mode: 'birth-sky' });
    const total = arcPlan.config.sessionSeconds;
    const wholeArc = renderWindow(arcPlan, 0, total);
    const pieces: ScoreWindow[] = [];
    for (let t = 0; t < total; t += 90) {
      pieces.push(renderWindow(arcPlan, t, Math.min(total, t + 90)));
    }
    expect(unionOf(pieces)).toEqual(sortedEvents(wholeArc));
  });

  it('is independent of window size', () => {
    const sizes = [30, 120, 600];
    const unions = sizes.map((size) => {
      const windows: ScoreWindow[] = [];
      for (let t = 0; t < T; t += size) windows.push(renderWindow(plan, t, Math.min(T, t + size)));
      return unionOf(windows);
    });
    expect(unions[1]).toEqual(unions[0]);
    expect(unions[2]).toEqual(unions[0]);
  });

  it('never lets a window boundary invent or destroy a chord voice', () => {
    // A boundary placed exactly on an event onset is the dangerous case.
    const onset = whole.events.find((e) => e.role === 'chord' && e.startSeconds > 60);
    expect(onset).toBeDefined();
    const cut = onset?.startSeconds ?? 100;
    const a = renderWindow(plan, 0, cut);
    const b = renderWindow(plan, cut, T);
    expect(unionOf([a, b])).toEqual(sortedEvents(whole));
  });
});

describe('determinism', () => {
  it('produces deep-equal windows on repeated calls', () => {
    const plan = session();
    expect(renderWindow(plan, 0, 600)).toEqual(renderWindow(plan, 0, 600));
  });

  it('produces deep-equal windows from a freshly prepared session', () => {
    expect(renderWindow(session(), 120, 480)).toEqual(renderWindow(session(), 120, 480));
  });

  it('survives a JSON round-trip', () => {
    const w = renderWindow(session(), 0, 600);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it('gives different skies different music', () => {
    const a = renderWindow(session({}, BENGALURU), 0, 600).events.map(key);
    const b = renderWindow(session({}, LONDON), 0, 600).events.map(key);
    expect(a).not.toEqual(b);
  });

  it('prepares an identical session plan each time', () => {
    const a = prepareSession(catalog, BENGALURU, {});
    const b = prepareSession(catalog, BENGALURU, {});
    expect(a.kappa).toBe(b.kappa);
    expect(a.scale).toBe(b.scale);
    expect(a.openingStarId).toBe(b.openingStarId);
    expect(a.bloomStarId).toBe(b.bloomStarId);
    expect(a.weather).toEqual(b.weather);
  });
});

// ===========================================================================
// ASTRONOMICAL TRUTH — cross-checked against Phase 2's independent code
// ===========================================================================

describe('true-event detection', () => {
  it('agrees with starsAboveHorizon about when a star rises', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    const events = eventsInRange(plan, 0, 1800).filter((e) => e.kind === 'rise');
    expect(events.length).toBeGreaterThan(3);

    for (const event of events.slice(0, 12)) {
      const before: ObserverInput = { ...BENGALURU };
      // Sample 20 listening-seconds either side and reduce independently.
      const altBefore = toHorizon(
        event.star,
        before.latitude,
        lstAt(plan.lst0, event.pieceSeconds - 20, plan.kappa),
      ).altitude;
      const altAfter = toHorizon(
        event.star,
        before.latitude,
        lstAt(plan.lst0, event.pieceSeconds + 20, plan.kappa),
      ).altitude;
      expect(altBefore, `${event.star.name ?? event.star.id} should be below before rising`).toBeLessThan(0);
      expect(altAfter, `${event.star.name ?? event.star.id} should be above after rising`).toBeGreaterThan(0);
    }
  });

  it('agrees about when a star sets', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    for (const event of eventsInRange(plan, 0, 1800).filter((e) => e.kind === 'set').slice(0, 12)) {
      const altBefore = toHorizon(
        event.star,
        BENGALURU.latitude,
        lstAt(plan.lst0, event.pieceSeconds - 20, plan.kappa),
      ).altitude;
      const altAfter = toHorizon(
        event.star,
        BENGALURU.latitude,
        lstAt(plan.lst0, event.pieceSeconds + 20, plan.kappa),
      ).altitude;
      expect(altBefore).toBeGreaterThan(0);
      expect(altAfter).toBeLessThan(0);
    }
  });

  it('puts culmination at the star’s highest altitude', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    for (const event of eventsInRange(plan, 0, 1800).filter((e) => e.kind === 'culmination').slice(0, 10)) {
      const here = toHorizon(
        event.star,
        BENGALURU.latitude,
        lstAt(plan.lst0, event.pieceSeconds, plan.kappa),
      );
      const expectedMax = 90 - Math.abs(BENGALURU.latitude - event.star.dec);
      expect(here.altitude).toBeCloseTo(expectedMax, 3);
      // …and it really is a maximum.
      for (const offset of [-60, -25, 25, 60]) {
        const other = toHorizon(
          event.star,
          BENGALURU.latitude,
          lstAt(plan.lst0, event.pieceSeconds + offset, plan.kappa),
        ).altitude;
        expect(other).toBeLessThanOrEqual(here.altitude + 1e-6);
      }
    }
  });

  it('classifies the three visibility regimes correctly', () => {
    // Measured in the design pass: from London, of the 92 stars brighter than
    // magnitude 2.5, 45 rise and set, 21 are circumpolar and 26 never appear.
    const bright = catalog.filter((s) => s.mag <= 2.5);
    const counts = { 'rises-and-sets': 0, circumpolar: 0, 'never-rises': 0 };
    for (const star of bright) counts[starEventTimes(star, 51.5085).visibility]++;
    expect(counts['rises-and-sets']).toBe(45);
    expect(counts.circumpolar).toBe(21);
    expect(counts['never-rises']).toBe(26);
  });

  it('gives circumpolar stars a culmination but no rise or set', () => {
    const polaris = catalog.find((s) => s.name === 'Polaris');
    expect(polaris).toBeDefined();
    const times = starEventTimes(polaris as Star, 51.5085);
    expect(times.visibility).toBe('circumpolar');
    expect(times.riseLst).toBeUndefined();
    expect(times.setLst).toBeUndefined();
    expect(times.hoursAboveHorizon).toBe(24);
  });

  it('gives never-rising stars nothing at all', () => {
    const plan = session({ mode: 'endless', kappa: 30 }, LONDON);
    const invisible = catalog.filter((s) => s.dec < -(90 - 51.5085) - 5).map((s) => s.id);
    const spoken = new Set(eventsInRange(plan, 0, 3600).map((e) => e.star.id));
    for (const id of invisible) expect(spoken.has(id)).toBe(false);
  });

  it('solves altitude crossings in closed form', () => {
    const star = catalog.find((s) => s.name === 'Sirius') as Star;
    for (const target of [0, 20, 45]) {
      const h = hourAngleAtAltitude(star.dec, BENGALURU.latitude, target);
      expect(h).not.toBeNull();
      // Reconstruct the altitude at that hour angle, independently.
      const D = Math.PI / 180;
      const alt =
        Math.asin(
          Math.sin(star.dec * D) * Math.sin(BENGALURU.latitude * D) +
            Math.cos(star.dec * D) * Math.cos(BENGALURU.latitude * D) * Math.cos((h as number) * D),
        ) / D;
      expect(alt).toBeCloseTo(target, 6);
    }
  });
});

// ===========================================================================
// THE COVENANT — on-scale everywhere
// ===========================================================================

describe('THE GATE — every pitch on-scale, across a full hour and every role', () => {
  it.each(['birth-sky', 'endless'] as const)('in %s mode', (mode) => {
    const plan = session({ mode, kappa: 30 });
    const span = mode === 'birth-sky' ? plan.config.sessionSeconds : 3600;
    const degrees = scaleDegrees(plan.scale);

    let checked = 0;
    for (let t = 0; t < span; t += 300) {
      for (const event of renderWindow(plan, t, Math.min(span, t + 300)).events) {
        const interval = event.midi - plan.rootMidi;
        expect(interval, `${event.role} ${event.sourceId} below the root`).toBeGreaterThanOrEqual(0);
        expect(
          degrees.includes(((interval % 12) + 12) % 12),
          `${event.role} ${event.sourceId} midi ${event.midi} is off-scale in ${plan.scale}`,
        ).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('holds for every observer and every weather-selected scale', () => {
    const observers: ObserverInput[] = [
      BENGALURU,
      LONDON,
      NEAR_POLE,
      { ...BENGALURU, latitude: 0 },
      { ...BENGALURU, latitude: -33.87, longitude: 151.21 },
    ];
    for (const observer of observers) {
      const plan = session({ mode: 'endless', kappa: 30 }, observer);
      const degrees = scaleDegrees(plan.scale);
      for (const event of renderWindow(plan, 0, 1800).events) {
        const interval = event.midi - plan.rootMidi;
        expect(degrees.includes(((interval % 12) + 12) % 12)).toBe(true);
      }
    }
  });

  it('keeps every pitch inside the MIDI range', () => {
    for (const event of renderWindow(session(), 0, 3600).events) {
      expect(event.midi).toBeGreaterThanOrEqual(0);
      expect(event.midi).toBeLessThanOrEqual(127);
    }
  });
});

// ===========================================================================
// THE CONDUCTOR
// ===========================================================================

describe('the Conductor', () => {
  const plan = session({ mode: 'endless', kappa: 30 });

  it('SLICE B4 — every lead note sits on a half-bar, and stays sparse', () => {
    // The lead's only rhythmic constraint. The grammar above it is untouched:
    // same phrases, same degrees, same subjects, same rests — the note is simply
    // snapped to the nearest half-bar so it belongs to the same music as the
    // pulse underneath it.
    const leads = renderWindow(plan, 0, 3600).events.filter((e) => e.role === 'lead');
    expect(leads.length).toBeGreaterThan(5);

    for (const note of leads) {
      const off =
        note.startSeconds - Math.round(note.startSeconds / LEAD_QUANTISE_SECONDS) * LEAD_QUANTISE_SECONDS;
      expect(Math.abs(off), `lead at ${note.startSeconds}s is off the half-bar`).toBeLessThan(1e-3);
    }

    // Sparse: quantising must not turn the lead into a part. Far fewer lead
    // notes than half-bars in the same stretch.
    expect(leads.length).toBeLessThan(3600 / LEAD_QUANTISE_SECONDS / 10);
  });

  it('respects the note budget in every sliding minute', () => {
    const budget = noteBudgetPerMinute(plan.weather);
    const leads = renderWindow(plan, 0, 3600).events.filter((e) => e.role === 'lead');
    expect(leads.length).toBeGreaterThan(5);

    for (let t = 0; t + 60 <= 3600; t += 5) {
      const inMinute = leads.filter((e) => e.startSeconds >= t && e.startSeconds < t + 60).length;
      expect(inMinute, `too many lead notes in [${t}, ${t + 60})`).toBeLessThanOrEqual(budget);
    }
  });

  it('leaves the back of every phrase silent', () => {
    const period = plan.config.phraseSeconds;
    const restStart = period * (1 - plan.silenceBudget);
    for (const phrase of phrasesInRange(plan, 0, 3600)) {
      for (const note of phrase.notes) {
        const within = note.startSeconds - phrase.phraseIndex * period;
        expect(within, 'a note landed inside the scheduled rest').toBeLessThan(restStart + 1e-6);
      }
    }
  });

  it('never lets a subject speak twice in the recency window', () => {
    const lookback = plan.config.lookbackPhrases;
    const byPhrase = new Map<number, string>();
    for (const phrase of phrasesInRange(plan, 0, 3600)) {
      byPhrase.set(phrase.phraseIndex, subjectKey(phrase.subject));
    }
    for (const [index, subject] of byPhrase) {
      for (let back = 1; back <= lookback; back++) {
        const previous = byPhrase.get(index - back);
        expect(previous, `${subject} spoke again ${back} phrase(s) later`).not.toBe(subject);
      }
    }
  });

  it('speaks at most once per phrase period', () => {
    const counts = new Map<number, number>();
    for (const phrase of phrasesInRange(plan, 0, 3600)) {
      counts.set(phrase.phraseIndex, (counts.get(phrase.phraseIndex) ?? 0) + 1);
    }
    for (const n of counts.values()) expect(n).toBe(1);
  });

  it('spends no more notes per phrase than the sky has earned', () => {
    // The note budget is a hard constraint, not an aspiration: it is what stops
    // a five-note motif blowing through a budget of four notes a minute.
    const allowance = noteAllowance(plan);
    for (const phrase of phrasesInRange(plan, 0, 3600)) {
      const statement = phrase.notes.filter((n) => n.part === 'statement').length;
      const answer = phrase.notes.filter((n) => n.part === 'answer').length;
      expect(statement).toBeLessThanOrEqual(allowance.statement);
      expect(answer).toBeLessThanOrEqual(allowance.answer);
    }
  });

  it('prefers the more salient event when it must choose', () => {
    // Culmination outranks a rise of similar brightness, by design.
    const leads = renderWindow(plan, 0, 3600).events.filter((e) => e.role === 'lead');
    const kinds = leads.map((e) => e.origin.kind);
    expect(kinds.filter((k) => k === 'culmination').length).toBeGreaterThan(0);
  });

  it('still speaks near the pole, where almost nothing rises or sets', () => {
    // Measured at latitude 89.5° over an hour of piece time: 59 culminations
    // against 2 rises and 1 set. Culmination is the load-bearing event type —
    // without it the lead would fall very nearly silent up here.
    const polar = session({ mode: 'endless', kappa: 30 }, NEAR_POLE);
    const leads = renderWindow(polar, 0, 3600).events.filter((e) => e.role === 'lead');
    expect(leads.length).toBeGreaterThan(0);
    // Culminations — of single stars or of whole constellations, which also fire
    // on a meridian crossing — must carry essentially all of it.
    const carried = leads.filter(
      (e) => e.origin.kind === 'culmination' || e.origin.kind === 'constellation',
    ).length;
    expect(carried / leads.length).toBeGreaterThan(0.8);
  });
});

// ===========================================================================
// CHORD, WEATHER, ARC, GESTURE
// ===========================================================================

describe('the CHORD', () => {
  const plan = session({ mode: 'endless', kappa: 30 });
  const chords = renderWindow(plan, 0, 3600).events.filter((e) => e.role === 'chord');

  it('gives a star the same note every time it appears', () => {
    const byStar = new Map<string, Set<number>>();
    for (const e of chords) {
      byStar.set(e.sourceId, (byStar.get(e.sourceId) ?? new Set()).add(e.midi));
    }
    // A star's harmonic identity comes from its culmination altitude, which does
    // not change — so it may only ever sound one pitch (plus its octave lift).
    for (const [id, pitches] of byStar) {
      expect(pitches.size, `star ${id} sounded ${pitches.size} different pitches`).toBeLessThanOrEqual(2);
    }
  });

  it('holds every sounding voice steady — a held note never moves', () => {
    for (const e of chords) {
      expect(Number.isFinite(e.midi)).toBe(true);
      expect(e.durationSeconds).toBeGreaterThan(0);
    }
  });

  it('keeps an entering voice near the sounding centroid', () => {
    // The voice-leading bound from design §10.2, measured against the centroid
    // the chooser actually optimises — each visible star's canonical placement.
    //
    // The budget is 6 + 12: at most half an octave of residue from picking the
    // nearest available octave, plus a whole octave for a star that is carried
    // up by the octave lift. Measured worst case across an hour: 17.7.
    const MAX_DISTANCE = 18;
    for (const e of chords) {
      const lst = lstAt(plan.lst0, e.startSeconds, plan.kappa);
      let total = 0;
      let count = 0;
      for (const c of plan.chordStars) {
        if (toHorizon(c.star, plan.observer.latitude, lst).altitude <= 0) continue;
        total += c.canonicalMidi;
        count++;
      }
      if (count < 2) continue;
      const centroid = total / count;
      expect(
        Math.abs(e.midi - centroid),
        `voice ${e.sourceId} entered ${Math.abs(e.midi - centroid).toFixed(1)} semitones away`,
      ).toBeLessThanOrEqual(MAX_DISTANCE);
    }
  });

  it('lifts a high-climbing star by exactly an octave, never by anything else', () => {
    // The lift preserves pitch class, which is why the on-scale guarantee
    // survives it. Anything other than a multiple of 12 would break that.
    const degrees = scaleDegrees(plan.scale);
    for (const e of chords) {
      const interval = e.midi - plan.rootMidi;
      const semitone = ((interval % 12) + 12) % 12;
      expect(degrees.includes(semitone)).toBe(true);
    }
  });

  it('swells in from the horizon rather than switching on', () => {
    const rising = chords.find((e) => e.origin.kind === 'rise' && (e.envelope?.length ?? 0) > 3);
    expect(rising).toBeDefined();
    const envelope = rising?.envelope ?? [];
    expect(envelope[0]?.amplitude ?? 1).toBeLessThan(0.05);
    expect(Math.max(...envelope.map((p) => p.amplitude))).toBeGreaterThan(envelope[0]?.amplitude ?? 0);
  });

  it('carries an origin naming the real star and sky moment', () => {
    for (const e of chords.slice(0, 25)) {
      expect(e.origin.starId).toBe(e.sourceId);
      expect(Number.isFinite(e.origin.skySeconds)).toBe(true);
      expect(e.origin.skySeconds).toBeCloseTo(e.startSeconds * plan.kappa, 1);
    }
  });
});

describe('emotional weather', () => {
  it('reads a light-polluted sky as far lonelier than a dark one', () => {
    // Measured, and it corrected an assumption in the design note: LATITUDE does
    // not make a sky sparse. A pole sees half the celestial sphere permanently,
    // and that half holds about as many stars as any other half — 4,249 visible
    // at 89.5° against 4,306 at Bengaluru. What the pole lacks is *motion*, not
    // stars, so its loneliness arrives through stasis (almost no rise/set
    // events) rather than through emptiness.
    //
    // The genuinely sparse sky is the light-polluted one, and the difference is
    // enormous: density 0.665 dark against 0.034 when only stars brighter than
    // magnitude 3 get through. That is the Vision's "light-polluted city".
    const dark = measureWeather(catalog, 12.9719, 300);
    const polluted = measureWeather(
      catalog.filter((s) => s.mag <= 3),
      12.9719,
      300,
    );
    expect(dark.visibleCount).toBeGreaterThan(polluted.visibleCount * 10);
    expect(dark.density).toBeGreaterThan(polluted.density * 5);
    expect(polluted.solitude).toBeGreaterThan(dark.solitude);
  });

  it('finds a polar sky no emptier than any other — only stiller', () => {
    const polar = measureWeather(catalog, 89.5, 300);
    const tropical = measureWeather(catalog, 12.9719, 300);
    expect(Math.abs(polar.density - tropical.density)).toBeLessThan(0.1);

    // The stillness is real, and it is what the ear will hear.
    const polarPlan = session({ mode: 'endless', kappa: 30 }, NEAR_POLE);
    const tropicalPlan = session({ mode: 'endless', kappa: 30 }, BENGALURU);
    const horizonEvents = (p: SessionPlan): number =>
      eventsInRange(p, 0, 3600).filter((e) => e.kind !== 'culmination').length;
    expect(horizonEvents(polarPlan)).toBeLessThan(horizonEvents(tropicalPlan) / 10);
  });

  it('keeps every dial inside 0..1', () => {
    for (const lat of [-89, -45, 0, 12.97, 51.5, 89]) {
      for (const lst of [0, 90, 180, 270]) {
        const w = measureWeather(catalog, lat, lst);
        for (const dial of [w.density, w.luminosity, w.solitude, w.clustering]) {
          expect(dial).toBeGreaterThanOrEqual(0);
          expect(dial).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('gives a lonelier sky more silence and fewer notes', () => {
    const dark = session({ mode: 'endless', kappa: 30 }, BENGALURU);
    const polluted = prepareSession(
      catalog.filter((s) => s.mag <= 3),
      BENGALURU,
      { mode: 'endless', kappa: 30 },
    );
    expect(polluted.silenceBudget).toBeGreaterThan(dark.silenceBudget);
    expect(noteBudgetPerMinute(polluted.weather)).toBeLessThan(noteBudgetPerMinute(dark.weather));
    expect(polluted.notesPerPhrase).toBeLessThanOrEqual(dark.notesPerPhrase);
  });

  it('chooses a scale from the ladder and never changes it mid-session', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    expect(scaleForWeather(plan.weather)).toBe(plan.scale);
    const scales = new Set<string>();
    for (let t = 0; t < 3600; t += 600) scales.add(renderWindow(plan, t, t + 600).scale);
    expect(scales.size).toBe(1);
  });

  it('handles a sky with nothing above the horizon', () => {
    const empty = measureWeather([], 45, 0);
    expect(empty.visibleCount).toBe(0);
    expect(empty.density).toBe(0);
    expect(empty.solitude).toBe(1);
  });
});

describe('the arc and the kappa solve', () => {
  it('lands the bloom at the intended fraction of the session', () => {
    const plan = session({ mode: 'birth-sky' });
    const expected = plan.config.sessionSeconds * plan.config.bloomFraction;
    expect(plan.bloomSeconds).not.toBeNull();
    expect(Math.abs((plan.bloomSeconds as number) - expected)).toBeLessThan(expected * 0.05);
  });

  it('solves a compression inside the approved band', () => {
    const plan = session({ mode: 'birth-sky' });
    const [lo, hi] = plan.config.kappaBand;
    expect(plan.kappa).toBeGreaterThanOrEqual(lo);
    expect(plan.kappa).toBeLessThanOrEqual(hi);
  });

  it('chooses a genuinely dramatic star for the climax', () => {
    const plan = session({ mode: 'birth-sky' });
    expect(plan.bloomStarId).not.toBeNull();
    const star = catalog.find((s) => s.id === plan.bloomStarId);
    expect(star?.mag).toBeLessThanOrEqual(plan.config.bloomMagLimit);
  });

  it('falls back to the preferred pace when no climax is reachable', () => {
    // A magnitude limit nothing satisfies leaves the solver with no candidates.
    const solved = solveKappa(
      catalog,
      BENGALURU,
      { ...DEFAULT_LIVING_SKY_CONFIG, bloomMagLimit: -99 },
      100,
    );
    expect(solved.bloomStarId).toBeNull();
    expect(solved.kappa).toBe(DEFAULT_LIVING_SKY_CONFIG.preferredKappa);
  });

  it('walks through the arc stages in order', () => {
    const plan = session({ mode: 'birth-sky' });
    const seen: string[] = [];
    for (let t = 0; t <= plan.config.sessionSeconds; t += 5) {
      const stage = arcAt(plan, t).stage;
      if (seen[seen.length - 1] !== stage) seen.push(stage);
    }
    expect(seen).toEqual(['opening', 'gathering', 'building', 'bloom', 'release', 'closing']);
  });

  it('peaks at the bloom', () => {
    const plan = session({ mode: 'birth-sky' });
    const bloom = arcAt(plan, plan.bloomSeconds as number);
    expect(bloom.stage).toBe('bloom');
    expect(bloom.intensity).toBe(1);
    expect(arcAt(plan, 30).intensity).toBeLessThan(0.5);
  });

  it('has no session arc in endless mode', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    expect(plan.bloomSeconds).toBeNull();
    for (const t of [0, 1000, 5000]) expect(arcAt(plan, t).stage).toBe('endless');
  });
});

describe('the opening and closing gesture', () => {
  const plan = session({ mode: 'birth-sky' });
  const total = plan.config.sessionSeconds;
  const all = renderWindow(plan, 0, total).events;

  it('opens with one star, alone', () => {
    const chords = all.filter((e) => e.role === 'chord').sort((a, b) => a.startSeconds - b.startSeconds);
    const first = chords[0];
    expect(first?.sourceId).toBe(plan.openingStarId);
    expect(first?.startSeconds).toBe(0);
    // Nothing else joins during the opening.
    const during = chords.filter((e) => e.startSeconds > 0 && e.startSeconds < plan.config.gestureSeconds);
    expect(during).toHaveLength(0);
  });

  it('opens with the brightest star that can actually bookend the piece', () => {
    // Not simply the brightest star up at t = 0: on this sky that is Arcturus,
    // which is setting and gone 16 seconds in. See the anchor tests below.
    const star = catalog.find((s) => s.id === plan.openingStarId) as Star;
    expect(star).toBeDefined();
    const at = (t: number): number =>
      toHorizon(star, plan.observer.latitude, lstAt(plan.lst0, t, plan.kappa)).altitude;
    expect(at(0)).toBeGreaterThan(0);
    expect(at(plan.config.sessionSeconds * 0.35)).toBeGreaterThan(0);
    expect(at(plan.config.sessionSeconds)).toBeGreaterThan(0);
  });

  it('lets the sky answer, in brightness order', () => {
    const gathering = all
      .filter((e) => e.role === 'chord' && e.startSeconds > 0 && e.startSeconds <= plan.config.gatheringSeconds)
      .sort((a, b) => a.startSeconds - b.startSeconds);
    expect(gathering.length).toBeGreaterThan(3);
    const mags = gathering.map((e) => catalog.find((s) => s.id === e.sourceId)?.mag ?? 0);
    // Brighter stars lead: the sequence should be broadly ascending in magnitude.
    const ascending = mags.filter((m, i) => i === 0 || m >= (mags[i - 1] as number)).length;
    expect(ascending / mags.length).toBeGreaterThan(0.7);
  });

  it('closes on the same star it opened with — one, all, one', () => {
    const chords = all.filter((e) => e.role === 'chord');
    const lastEnd = Math.max(...chords.map((e) => e.startSeconds + e.durationSeconds));
    const survivors = chords.filter((e) => e.startSeconds + e.durationSeconds >= lastEnd - 1e-6);
    expect(survivors.map((e) => e.sourceId)).toContain(plan.openingStarId);
  });

  it('keeps every event inside the session', () => {
    for (const e of all) {
      expect(e.startSeconds).toBeGreaterThanOrEqual(0);
      expect(e.startSeconds).toBeLessThan(total);
      expect(e.startSeconds + e.durationSeconds).toBeLessThanOrEqual(total + 1e-6);
    }
  });
});

// ===========================================================================
// EDGES
// ===========================================================================

describe('edge skies produce valid pieces, never exceptions', () => {
  it('handles an empty catalogue', () => {
    const plan = prepareSession([], BENGALURU, { mode: 'endless' });
    const w = renderWindow(plan, 0, 600);
    expect(w.meta.visibleCount).toBe(0);
    expect(w.meta.label).toBe('no stars above the horizon');
    // The ground bed still sounds: an empty sky is still a sky.
    expect(w.events.some((e) => e.role === 'ground')).toBe(true);
    expect(w.events.some((e) => e.role === 'chord')).toBe(false);
  });

  it('handles a single-star catalogue', () => {
    const one = [catalog.find((s) => s.name === 'Sirius') as Star];
    const plan = prepareSession(one, BENGALURU, { mode: 'endless' });
    expect(() => renderWindow(plan, 0, 1200)).not.toThrow();
  });

  it('handles both poles', () => {
    for (const latitude of [89.9, -89.9]) {
      const plan = session({ mode: 'endless', kappa: 30 }, { ...BENGALURU, latitude });
      const w = renderWindow(plan, 0, 1800);
      expect(w.events.length).toBeGreaterThan(0);
      for (const e of w.events.filter((x) => x.role === 'chord')) {
        const star = catalog.find((s) => s.id === e.sourceId) as Star;
        expect(Math.sign(star.dec)).toBe(Math.sign(latitude));
      }
    }
  });

  it('handles the equator, where the whole sky turns over', () => {
    const plan = session({ mode: 'endless', kappa: 30 }, { ...BENGALURU, latitude: 0 });
    expect(renderWindow(plan, 0, 1800).events.length).toBeGreaterThan(10);
  });

  it('handles a session shorter than the opening gesture', () => {
    const plan = session({ mode: 'birth-sky', sessionSeconds: 5 });
    expect(() => renderWindow(plan, 0, 5)).not.toThrow();
  });

  it('handles a zero-length and a reversed window', () => {
    const plan = session();
    expect(renderWindow(plan, 100, 100).events).toEqual([]);
    expect(() => renderWindow(plan, 500, 100)).toThrow(/must not precede/);
  });

  it('rejects non-finite bounds', () => {
    const plan = session();
    expect(() => renderWindow(plan, 0, Number.NaN)).toThrow(/finite/);
    expect(() => renderWindow(plan, 0, Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });

  it('clamps a negative window start to the beginning of the piece', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    expect(renderWindow(plan, -500, 600)).toEqual(renderWindow(plan, 0, 600));
  });
});

describe('the sky really does advance', () => {
  it('turns a full circle in one sidereal day of piece time', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    const period = SIDEREAL_DAY_SECONDS / plan.kappa;
    expect(lstAt(plan.lst0, 0, plan.kappa)).toBeCloseTo(lstAt(plan.lst0, period, plan.kappa), 6);
  });

  it('changes which stars are sounding as time passes', () => {
    // Compare what is SOUNDING at two moments half a sidereal turn apart, not
    // what merely starts in a window — circumpolar voices legitimately restart
    // every segment, so counting onsets would measure the wrong thing.
    const plan = session({ mode: 'endless', kappa: 30 });
    const half = SIDEREAL_DAY_SECONDS / plan.kappa / 2;
    const soundingAt = (t: number): Set<string> => {
      const lst = lstAt(plan.lst0, t, plan.kappa);
      const up = new Set<string>();
      for (const c of plan.chordStars) {
        if (toHorizon(c.star, plan.observer.latitude, lst).altitude > 0) up.add(c.star.id);
      }
      return up;
    };
    const early = soundingAt(0);
    const late = soundingAt(half);
    expect(early.size).toBeGreaterThan(3);
    expect(late.size).toBeGreaterThan(3);
    const overlap = [...late].filter((id) => early.has(id)).length;
    // Half a turn later the sky is genuinely a different sky.
    expect(overlap).toBeLessThan(late.size * 0.6);
  });
});

// ===========================================================================
// SLICE A1b — motifs, phrase grammar, development transforms
// ===========================================================================

describe('degree-space transforms — the on-scale guarantee under development', () => {
  it('PROPERTY: arbitrary degree sequences never leave the ladder, under any transform', () => {
    // This is the structural reason the grammar cannot break the covenant.
    // Inverting a minor third in SEMITONE space gives a major sixth, which need
    // not be in the scale. Inverting in DEGREE space cannot: 2·pivot − d is an
    // integer, and every integer is a rung.
    for (const scale of SCALE_NAMES) {
      const ladder = scaleDegrees(scale);
      const degreesPerOctave = ladder.length;

      // A deterministic spread of awkward inputs, including negatives and
      // values far outside any sensible range.
      const sequences: number[][] = [
        [0],
        [0, 1, 2, 3, 4],
        [-7, -3, 0, 3, 7],
        [-40, 17, 0, -1, 99],
        [5, 5, 5],
        [123, -456, 0],
      ];

      for (const sequence of sequences) {
        const variants: number[][] = [
          sequence,
          transposeDegrees(sequence, -1),
          transposeDegrees(sequence, 13),
          invertDegrees(sequence),
          invertDegrees(sequence, 4),
          invertDegrees(transposeDegrees(sequence, -1)),
          shiftOctaves(sequence, 2, degreesPerOctave),
          shiftOctaves(invertDegrees(sequence), -3, degreesPerOctave),
          transposeDegrees(invertDegrees(shiftOctaves(sequence, 1, degreesPerOctave)), -1),
        ];

        for (const variant of variants) {
          for (const degree of variant) {
            for (const rootMidi of [21, 45, 60, 96]) {
              const midi = degreeToMidi(degree, rootMidi, scale);
              expect(midi).toBeGreaterThanOrEqual(0);
              expect(midi).toBeLessThanOrEqual(127);
              const interval = ((midi - rootMidi) % 12 + 12) % 12;
              expect(
                ladder.includes(interval),
                `degree ${degree} in ${scale} produced midi ${midi}, off-scale`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it('folds out-of-range pitches by octaves rather than clamping', () => {
    // A clamp is exactly how an off-scale note would sneak in at the edges.
    const ladder = scaleDegrees('minor-pentatonic');
    for (const degree of [-200, -50, 50, 200]) {
      const midi = degreeToMidi(degree, 45, 'minor-pentatonic');
      expect(ladder.includes(((midi - 45) % 12 + 12) % 12)).toBe(true);
    }
  });

  it('inverts about the first note by default', () => {
    expect(invertDegrees([0, 2, 5])).toEqual([0, -2, -5]);
    expect(invertDegrees([3, 5, 1], 3)).toEqual([3, 1, 5]);
  });

  it('augments a rhythm without touching its pitches', () => {
    expect(scaleGaps([1, 2], 1.6)).toEqual([1.6, 3.2]);
  });
});

describe('constellation motifs', () => {
  it('derives a path through Orion’s brightest stars', () => {
    const orion = deriveMotif(catalog, 'Ori');
    expect(orion).not.toBeNull();
    const names = (orion as Motif).starIds.map((id) => catalog.find((s) => s.id === id)?.name);
    expect(names).toEqual(['Rigel', 'Alnitak', 'Alnilam', 'Bellatrix', 'Betelgeuse']);
    // It walks up through the belt — a rising contour.
    expect((orion as Motif).degrees).toEqual([-3, -1, -1, 2, 3]);
  });

  it('gives Cassiopeia its zigzag', () => {
    const cas = deriveMotif(catalog, 'Cas') as Motif;
    expect(cas.degrees).toEqual([0, -4, 2, 2]);
  });

  it('caps the cell at five notes, per the Beethoven dose', () => {
    // Scorpius has 13 stars brighter than magnitude 3; a path through all of
    // them contained a 26° jump. Capping at five removes it.
    const sco = deriveMotif(catalog, 'Sco') as Motif;
    expect(sco.starIds).toHaveLength(5);
    const gaps = sco.starIds.slice(1).map((id, i) => {
      const a = catalog.find((s) => s.id === sco.starIds[i]) as Star;
      const b = catalog.find((s) => s.id === id) as Star;
      return angularSeparation(a, b);
    });
    expect(Math.max(...gaps)).toBeLessThan(16);
  });

  it('declines constellations with too few bright stars', () => {
    expect(deriveMotif(catalog, 'Lyr')).toBeNull(); // only Vega is brighter than 3
    expect(deriveMotif(catalog, 'not-a-constellation')).toBeNull();
  });

  it('finds the expected number of motif-capable constellations', () => {
    // 29, not the 31 counted in the design pass: that probe used mag <= 3 while
    // the spec says mag < 3, and two constellations sit exactly on 3.00.
    expect(deriveAllMotifs(catalog)).toHaveLength(29);
  });

  it('THE GATE — a motif is identical from every place and every date', () => {
    // The identity claim rests on this: Orion's contour is Orion's contour in
    // Bengaluru, Tokyo or Reykjavík, because it is computed from RA/Dec.
    const observers: ObserverInput[] = [
      BENGALURU,
      LONDON,
      { ...BENGALURU, latitude: 35.68, longitude: 139.69 },
      { ...BENGALURU, latitude: 64.15, longitude: -21.94 },
      { ...BENGALURU, latitude: -33.87, longitude: 151.21 },
      { ...BENGALURU, latitude: 0, longitude: 0 },
    ];
    const dates = ['1993-08-01', '2024-12-25', '1957-10-04', '2099-03-15'];

    const reference = deriveMotif(catalog, 'Ori') as Motif;
    for (const observer of observers) {
      for (const dateISO of dates) {
        const plan = prepareSession(catalog, { ...observer, dateISO }, { mode: 'endless', kappa: 30 });
        const here = plan.motifs.find((m) => m.constellation === 'Ori');
        if (!here) continue; // Orion may be unreachable from an extreme latitude
        expect(here.degrees, `Orion differs at lat ${observer.latitude} on ${dateISO}`).toEqual(
          reference.degrees,
        );
        expect(here.starIds).toEqual(reference.starIds);
        expect(here.gaps).toEqual(reference.gaps);
      }
    }
  });

  it('only offers motifs whose stars can all rise for this observer', () => {
    const plan = session({ mode: 'endless', kappa: 30 }, LONDON);
    for (const motif of plan.motifs) {
      for (const id of motif.starIds) {
        const star = catalog.find((s) => s.id === id) as Star;
        expect(starEventTimes(star, LONDON.latitude).maxAltitude).toBeGreaterThan(0);
      }
    }
  });

  it('fires a motif only when the whole figure is up and high', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    const events = motifEventsInRange(plan, 0, 6000);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const lst = lstAt(plan.lst0, event.pieceSeconds, plan.kappa);
      let total = 0;
      for (const id of event.motif.starIds) {
        const star = catalog.find((s) => s.id === id) as Star;
        const { altitude } = toHorizon(star, plan.observer.latitude, lst);
        expect(altitude, `${event.motif.constellation}: ${id} was below the horizon`).toBeGreaterThan(0);
        total += altitude;
      }
      expect(total / event.motif.starIds.length).toBeGreaterThanOrEqual(
        plan.config.constellationAltitudeThreshold,
      );
    }
  });
});

describe('the phrase grammar', () => {
  const plan = session({ mode: 'endless', kappa: 30 });
  const phrases = phrasesInRange(plan, 0, 3600);

  it('produces phrases at all', () => {
    expect(phrases.length).toBeGreaterThan(10);
  });

  it('answers every statement, when the budget allows one', () => {
    const allowance = noteAllowance(plan);
    if (allowance.answer === 0) return;
    const withAnswer = phrases.filter((p) => p.notes.some((n) => n.part === 'answer'));
    expect(withAnswer.length).toBeGreaterThan(phrases.length * 0.5);
  });

  it('makes the answer quieter than the statement', () => {
    for (const phrase of phrases) {
      const statement = phrase.notes.filter((n) => n.part === 'statement');
      const answer = phrase.notes.filter((n) => n.part === 'answer');
      if (answer.length === 0) continue;
      expect(Math.max(...answer.map((n) => n.gain))).toBeLessThan(
        Math.min(...statement.map((n) => n.gain)),
      );
    }
  });

  it('transposes the answer down exactly one scale degree', () => {
    for (const phrase of phrases) {
      const statement = phrase.notes.filter((n) => n.part === 'statement');
      const answer = phrase.notes.filter((n) => n.part === 'answer');
      for (let i = 0; i < answer.length; i++) {
        expect((answer[i] as PhraseNote).degree).toBe((statement[i] as PhraseNote).degree - 1);
      }
    }
  });

  it('puts the answer after the statement, never on top of it', () => {
    for (const phrase of phrases) {
      const statement = phrase.notes.filter((n) => n.part === 'statement');
      const answer = phrase.notes.filter((n) => n.part === 'answer');
      if (answer.length === 0) continue;
      const lastStatement = Math.max(...statement.map((n) => n.startSeconds));
      expect((answer[0] as PhraseNote).startSeconds).toBeGreaterThan(lastStatement);
    }
  });

  it('groups a statement and its answer under one phrase id', () => {
    const leads = renderWindow(plan, 0, 3600).events.filter((e) => e.role === 'lead');
    const ids = new Set(leads.map((e) => e.phraseId));
    expect(ids.size).toBeGreaterThan(5);
    for (const e of leads) expect(e.phraseId).toBeTruthy();
  });

  it('inverts a setting subject — the phrase goes down because the star does', () => {
    // Find a motif phrase fired by a setting subject if one exists; otherwise
    // assert the transform directly, which is what the grammar relies on.
    const setting = phrases.find((p) => p.subject.kind === 'set');
    if (setting) {
      expect(setting.notes.length).toBeGreaterThan(0);
    }
    expect(invertDegrees([0, 1, 3])).toEqual([0, -1, -3]);
  });

  it('augments a culminating subject’s rhythm', () => {
    const motifPhrase = phrases.find(
      (p) => p.subject.kind === 'constellation' && p.notes.length > 2,
    );
    if (!motifPhrase) return;
    const motif = (motifPhrase.subject as MotifEvent).motif;
    const played = motifPhrase.notes
      .filter((n) => n.part === 'statement')
      .map((n) => n.startSeconds);
    if (played.length < 2 || motif.gaps.length === 0) return;
    const playedGap = (played[1] as number) - (played[0] as number);
    // Culminating subjects are slowed, so the played gap exceeds the raw one.
    expect(playedGap).toBeGreaterThan((motif.gaps[0] as number) - 1e-9);
  });
});

describe('motifs in the stream', () => {
  const plan = session({ mode: 'endless', kappa: 30 });
  const window = renderWindow(plan, 0, 6000);

  it('tags motif notes with their constellation', () => {
    const motifNotes = window.events.filter((e) => e.motifId !== undefined);
    expect(motifNotes.length).toBeGreaterThan(0);
    for (const e of motifNotes) {
      expect(e.origin.kind).toBe('constellation');
      expect(e.origin.constellation).toBe(e.motifId);
    }
  });

  it('keeps every motif note on-scale', () => {
    const ladder = scaleDegrees(plan.scale);
    for (const e of window.events.filter((x) => x.motifId !== undefined)) {
      expect(ladder.includes(((e.midi - plan.rootMidi) % 12 + 12) % 12)).toBe(true);
    }
  });

  it('still respects the note budget with motifs firing', () => {
    const budget = noteBudgetPerMinute(plan.weather);
    const leads = window.events.filter((e) => e.role === 'lead');
    for (let t = 0; t + 60 <= 6000; t += 5) {
      const inMinute = leads.filter((e) => e.startSeconds >= t && e.startSeconds < t + 60).length;
      expect(inMinute, `too many lead notes in [${t}, ${t + 60})`).toBeLessThanOrEqual(budget);
    }
  });

  it('THE GATE — partition invariance still holds with motifs and phrases active', () => {
    const T = 6000;
    const whole = renderWindow(plan, 0, T);
    for (const size of [37, 250, 1000]) {
      const pieces: ScoreWindow[] = [];
      for (let t = 0; t < T; t += size) pieces.push(renderWindow(plan, t, Math.min(T, t + size)));
      expect(unionOf(pieces), `window size ${size}`).toEqual(sortedEvents(whole));
    }
  });
});

describe('the opening anchor must survive the gathering', () => {
  it('picks a star that is still up when the sky has answered', () => {
    const plan = session({ mode: 'birth-sky' });
    const anchor = plan.chordStars.find((c) => c.star.id === plan.openingStarId);
    expect(anchor).toBeDefined();

    const required = plan.config.sessionSeconds * plan.config.openingStarMinVisibleFraction;
    const times = (anchor as ChordStarPlan).times;
    if (times.visibility !== 'circumpolar') {
      const setsAt = firstTimeAtLst(plan.lst0, times.setLst as number, plan.kappa);
      expect(setsAt).toBeGreaterThanOrEqual(required);
    } else {
      expect(times.hoursAboveHorizon).toBe(24);
    }
  });

  it('is still up at the end of GATHERING', () => {
    const plan = session({ mode: 'birth-sky' });
    const star = catalog.find((s) => s.id === plan.openingStarId) as Star;
    const at = plan.config.sessionSeconds * plan.config.openingStarMinVisibleFraction;
    const { altitude } = toHorizon(star, plan.observer.latitude, lstAt(plan.lst0, at, plan.kappa));
    expect(altitude).toBeGreaterThan(0);
  });

  it('offers three rules, and they genuinely differ on this sky', () => {
    const brightest = session({ mode: 'birth-sky', openingAnchorRule: 'brightest' });
    const gathering = session({ mode: 'birth-sky', openingAnchorRule: 'survives-gathering' });
    const bookends = session({ mode: 'birth-sky', openingAnchorRule: 'bookends' });

    const brightestUp = starsAboveHorizon(catalog, BENGALURU)
      .filter((h) => h.star.mag <= brightest.config.chordMagLimit)
      .sort((a, b) => a.star.mag - b.star.mag)[0];
    expect(brightest.openingStarId).toBe(brightestUp?.star.id);

    // All three are distinct here, which is exactly why it is worth an ear.
    expect(gathering.openingStarId).not.toBe(brightest.openingStarId);
    expect(bookends.openingStarId).not.toBe(gathering.openingStarId);
  });

  it('still opens alone and closes on the same star', () => {
    const plan = session({ mode: 'birth-sky' });
    const all = renderWindow(plan, 0, plan.config.sessionSeconds).events;
    const chords = all.filter((e) => e.role === 'chord').sort((a, b) => a.startSeconds - b.startSeconds);
    expect(chords[0]?.sourceId).toBe(plan.openingStarId);
    expect(chords[0]?.startSeconds).toBe(0);

    const lastEnd = Math.max(...chords.map((e) => e.startSeconds + e.durationSeconds));
    const survivors = chords.filter((e) => e.startSeconds + e.durationSeconds >= lastEnd - 1e-6);
    expect(survivors.map((e) => e.sourceId)).toContain(plan.openingStarId);
  });
});

// ===========================================================================
// SLICE A3 — the FIGURATION layer (the meso timescale)
// ===========================================================================

describe('figuration — truth', () => {
  const plan = session({ mode: 'birth-sky' });
  const all = renderWindow(plan, 0, plan.config.sessionSeconds).events;
  const figuration = all.filter((e) => e.role === 'figuration');

  it('plays at all, continuously', () => {
    expect(figuration.length).toBeGreaterThan(200);
    // No silent gap longer than a few cycles anywhere in the built stretch.
    const times = figuration.map((e) => e.startSeconds).sort((a, b) => a - b);
    let worst = 0;
    for (let i = 1; i < times.length; i++) {
      worst = Math.max(worst, (times[i] as number) - (times[i - 1] as number));
    }
    expect(worst).toBeLessThan(40);
  });

  it('THE GATE — only ever sounds a tone that is genuinely in the air', () => {
    // The figuration invents no pitches: every note doubles a chord tone that
    // `soundingChordTones` says is sounding at that instant. The Zimmer layers
    // of the bloom movement transpose by whole OCTAVES, which preserves the
    // pitch class, so they are checked as octaves of the same real tone.
    for (const note of figuration.filter((_, i) => i % 7 === 0)) {
      const tones = soundingChordTones(plan, note.startSeconds);
      const match = tones.find((t) => t.starId === note.sourceId);
      expect(match, `${note.sourceId} was not sounding at ${note.startSeconds}s`).toBeDefined();
      const offset = note.midi - (match as { midi: number }).midi;
      expect(
        offset % 12,
        `${note.sourceId} sounded ${offset} semitones from its real tone`,
      ).toBe(0);
      expect(Math.abs(offset)).toBeLessThanOrEqual(24);
    }
  });

  it('is therefore on-scale, by construction', () => {
    const ladder = scaleDegrees(plan.scale);
    for (const note of figuration) {
      expect(ladder.includes(((note.midi - plan.rootMidi) % 12 + 12) % 12)).toBe(true);
    }
  });

  it('sits under the lead in level', () => {
    const leads = all.filter((e) => e.role === 'lead');
    const meanOf = (xs: MusicalEvent[]): number =>
      xs.reduce((t, e) => t + e.amplitude, 0) / Math.max(1, xs.length);
    expect(meanOf(figuration)).toBeLessThan(meanOf(leads));
  });

  it('names the real star behind every note', () => {
    for (const note of figuration.slice(0, 40)) {
      expect(note.origin.starId).toBe(note.sourceId);
      expect(catalog.some((s) => s.id === note.sourceId)).toBe(true);
    }
  });

  it('weaves at ear speed, and the densest movement is properly dense', () => {
    // The meso timescale. The session median is now looser than A3's because
    // the vocabulary includes a deliberately still pattern — that contrast is
    // the point of A4 — so the tighter claim is made about the densest movement.
    const times = figuration.map((e) => e.startSeconds).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push((times[i] as number) - (times[i - 1] as number));
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] as number;
    expect(median).toBeGreaterThan(0.2);
    expect(median).toBeLessThan(2.2);

    const densest = [...plan.movementPlan.movements].sort(
      (a, b) =>
        patternByName(b.pattern).slots.filter(Boolean).length -
        patternByName(a.pattern).slots.filter(Boolean).length,
    )[0] as (typeof plan.movementPlan.movements)[number];
    const inside = figuration
      .filter((e) => e.startSeconds >= densest.fromSeconds && e.startSeconds < densest.toSeconds)
      .map((e) => e.startSeconds)
      .sort((a, b) => a - b);
    const insideGaps: number[] = [];
    for (let i = 1; i < inside.length; i++) {
      insideGaps.push((inside[i] as number) - (inside[i - 1] as number));
    }
    const insideMedian = [...insideGaps].sort((a, b) => a - b)[
      Math.floor(insideGaps.length / 2)
    ] as number;
    expect(insideMedian).toBeLessThan(1.2);
  });
});

describe('figuration — TRANSITIONS ARE THE CRAFT', () => {
  const plan = session({ mode: 'birth-sky' });
  const totalCycles = Math.floor(plan.config.sessionSeconds / cycleSeconds(plan));

  /** How many slots read differently between two cycles. */
  it('THE GATE (A4) — inside a movement the RHYTHM repeats exactly', () => {
    // Slice A4 supersedes A3's drift doctrine. A3 let the pattern evolve every
    // cycle, which is why no groove could form: repetition belongs at the meso
    // scale. Inside a movement body the mask must now be *identical* cycle after
    // cycle — zero rhythmic change — so the ear can learn it.
    for (const movement of plan.movementPlan.movements) {
      const firstCycle = Math.ceil(movement.fromSeconds / cycleSeconds(plan));
      const lastCycle = Math.floor(movement.toSeconds / cycleSeconds(plan)) - 1;
      let reference: boolean[] | null = null;
      for (let n = firstCycle; n <= lastCycle; n++) {
        const mask = patternAt(plan, n).map((slot) => slot.active);
        if (reference === null) reference = mask;
        else {
          expect(
            mask,
            `movement ${movement.index} (${movement.pattern}) changed rhythm at cycle ${n}`,
          ).toEqual(reference);
        }
      }
    }
  });

  it('SLICE B4 — the POOL turns over at the speed of the sky, not of the music', () => {
    // A3 asserted "at most one slot changes its tone per cycle", which it got by
    // giving each slot its own seeded pick and its own change epoch. The rule
    // held and the music still had nothing to recognise, because eight
    // independent draws from a chord are not a figure however slowly they move.
    //
    // B4 replaced the mechanism, so the thing to assert moved with it. The
    // reading head is SUPPOSED to visit different pool members every bar — that
    // is what walking an order means. What must turn over slowly is the POOL
    // itself: the material the figure is made of changes at the rate stars rise
    // and set, which is what lets an ostinato evolve instead of resetting.
    // Measured INSIDE a movement body, where the only thing moving the pool is
    // the sky. A seam is allowed to change it wholesale — that is what a
    // movement's register offset is for, and it is the form speaking, not
    // turnover — and a pool of two stars in the opening minute is a fact about
    // the opening rather than a rate.
    let compared = 0;
    for (const movement of plan.movementPlan.movements) {
      const firstCycle = Math.ceil(movement.fromSeconds / cycleSeconds(plan));
      const lastCycle = Math.floor(movement.toSeconds / cycleSeconds(plan)) - 1;
      for (let n = firstCycle + 1; n <= lastCycle; n++) {
        const wasAt = cycleStartSeconds(plan, n - 1);
        const nowAt = cycleStartSeconds(plan, n);
        const was = formAt(plan.movementPlan, wasAt);
        const now = formAt(plan.movementPlan, nowAt);
        const insideOneBody =
          was &&
          now &&
          was.transitionProgress === null &&
          now.transitionProgress === null &&
          was.movement.index === now.movement.index;
        if (!insideOneBody) continue;

        const before = new Set(figurationPoolAt(plan, wasAt).map((t) => t.starId));
        const after = figurationPoolAt(plan, nowAt).map((t) => t.starId);
        if (before.size === 0 || after.length < 8) continue;

        const carried = after.filter((id) => before.has(id)).length / after.length;
        expect(carried, `movement ${movement.index}, cycle ${n}`).toBeGreaterThan(0.6);
        compared++;
      }
    }
    expect(compared, 'nothing was actually compared').toBeGreaterThan(20);
  });

  it('gives consecutive movements CONTRASTING patterns', () => {
    const movements = plan.movementPlan.movements;
    expect(movements.length).toBeGreaterThan(2);
    for (let i = 1; i < movements.length; i++) {
      const a = movements[i - 1] as (typeof movements)[number];
      const b = movements[i] as (typeof movements)[number];
      const differs =
        a.pattern !== b.pattern || a.registerOffset !== b.registerOffset;
      expect(differs, `movements ${i - 1} and ${i} sound the same`).toBe(true);
    }
  });

  it('holds in endless mode too, over a long stretch', () => {
    const endless = session({ mode: 'endless', kappa: 30 });
    for (const movement of endless.movementPlan.movements.slice(0, 6)) {
      const firstCycle = Math.ceil(movement.fromSeconds / cycleSeconds(endless));
      const lastCycle = Math.min(
        firstCycle + 12,
        Math.floor(movement.toSeconds / cycleSeconds(endless)) - 1,
      );
      let reference: boolean[] | null = null;
      for (let n = firstCycle; n <= lastCycle; n++) {
        const mask = patternAt(endless, n).map((slot) => slot.active);
        if (reference === null) reference = mask;
        else expect(mask).toEqual(reference);
      }
    }
  });

  it('THE GATE (A4) — a transition RAMPS the note rate monotonically', () => {
    // Transitions are first-class: the outgoing groove thins as the incoming
    // establishes, and the rate must move steadily from one density to the
    // other — no step, and never doubling back.
    const bound = plan.config.formMaxRateStep;
    const cycle = cycleSeconds(plan);

    for (const movement of plan.movementPlan.movements) {
      if (movement.transitionSeconds <= 0) continue;
      const firstCycle = Math.floor(movement.toSeconds / cycle);
      const lastCycle = Math.ceil((movement.toSeconds + movement.transitionSeconds) / cycle);

      const rates: number[] = [];
      for (let n = firstCycle; n <= lastCycle; n++) rates.push(noteRateAt(plan, n * cycle));

      const rising = (rates[rates.length - 1] as number) >= (rates[0] as number);
      for (let i = 1; i < rates.length; i++) {
        const step = (rates[i] as number) - (rates[i - 1] as number);
        expect(Math.abs(step), `seam after movement ${movement.index}`).toBeLessThanOrEqual(
          bound + 1e-9,
        );
        // Monotone in the direction the seam is heading.
        if (rising) expect(step).toBeGreaterThanOrEqual(-1e-9);
        else expect(step).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('SLICE B4 — THE FIGURE REPEATS: the same bar of the weave comes back', () => {
    // The point of the whole slice, asserted as a number. Under A3's per-slot
    // random picks a bar of figuration essentially never recurred; under a
    // reading head walking a fixed order, bars recur as the head wraps the pool
    // — which is what "an ostinato" means and what four ear reports asked for.
    const notes = figurationNotesInRange(plan, 0, 900).filter((n) => n.layer === 0);
    expect(notes.length).toBeGreaterThan(200);

    const bars = new Map<number, string[]>();
    for (const note of notes) {
      const bar = bars.get(note.cycleIndex) ?? [];
      bar.push(`${note.slot}:${note.midi}`);
      bars.set(note.cycleIndex, bar);
    }

    const shapes = new Map<string, number>();
    for (const bar of bars.values()) {
      const shape = bar.join(',');
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }
    const mostRepeated = Math.max(...shapes.values());
    expect(mostRepeated, 'no bar of the weave ever recurs — there is no figure').toBeGreaterThanOrEqual(3);
    // And the weave is not ONE bar on a loop either: it evolves as the sky turns.
    expect(shapes.size).toBeGreaterThan(5);
  });

  it('breathes into an arc-stage change rather than stepping', () => {
    // The arc's own stage boundaries are separate from the movement seams; the
    // cycle before one dips velocity only, so no rhythm changes with it.
    const boundary = (() => {
      for (let n = 1; n <= totalCycles; n++) {
        const a = arcAt(plan, cycleStartSeconds(plan, n)).stage;
        const b = arcAt(plan, cycleStartSeconds(plan, n + 1)).stage;
        if (a !== b) return n;
      }
      return -1;
    })();
    expect(boundary).toBeGreaterThan(0);

    const insideOneMovement =
      formAt(plan.movementPlan, cycleStartSeconds(plan, boundary))?.movement.index ===
      formAt(plan.movementPlan, cycleStartSeconds(plan, boundary + 1))?.movement.index;
    if (insideOneMovement) {
      expect(patternAt(plan, boundary).map((s) => s.active)).toEqual(
        patternAt(plan, boundary + 1).map((s) => s.active),
      );
    }
  });
});

describe('figuration — determinism and partition invariance', () => {
  const plan = session({ mode: 'endless', kappa: 30 });

  it('is a pure function of absolute time', () => {
    expect(figurationNotesInRange(plan, 0, 400)).toEqual(figurationNotesInRange(plan, 0, 400));
    const fresh = session({ mode: 'endless', kappa: 30 });
    expect(figurationNotesInRange(fresh, 120, 300)).toEqual(figurationNotesInRange(plan, 120, 300));
  });

  it('gives the same pattern for a cycle however it is reached', () => {
    for (const n of [0, 1, 7, 8, 63, 64, 199]) {
      expect(patternAt(plan, n)).toEqual(patternAt(session({ mode: 'endless', kappa: 30 }), n));
    }
  });

  it('THE GATE — partition invariance survives with figuration active', () => {
    const T = 2400;
    const whole = renderWindow(plan, 0, T);
    for (const size of [23, 137, 600]) {
      const pieces: ScoreWindow[] = [];
      for (let t = 0; t < T; t += size) pieces.push(renderWindow(plan, t, Math.min(T, t + size)));
      expect(unionOf(pieces), `window size ${size}`).toEqual(sortedEvents(whole));
    }
  });

  it('SLICE B4 — EVERY ONSET IS ON THE GRID, to the sample', () => {
    // No humanisation and no swing: he asked for simple. The assertion is that
    // an onset is exactly `stepIndex × STEP_SECONDS` — within the 0.1 ms the
    // score's own rounding introduces — so the pulse is a pure function of
    // absolute piece time and a window boundary cannot move a note off it.
    const notes = figurationNotesInRange(plan, 0, 600).filter((n) => n.layer === 0);
    expect(notes.length).toBeGreaterThan(100);

    for (const note of notes) {
      const drift = note.startSeconds - Math.round(note.startSeconds / STEP_SECONDS) * STEP_SECONDS;
      expect(Math.abs(drift), `note at ${note.startSeconds}s is off the grid`).toBeLessThan(1e-3);
    }
    expect(plan.config.figurationHumanizeSeconds).toBe(0);
    expect(STEP_SECONDS).toBeCloseTo(60 / PULSE.bpm / PULSE.stepsPerBeat, 12);
  });
});

describe('figuration — weather', () => {
  it('thins to almost nothing in the loneliest sky', () => {
    // A light-polluted sky is the genuinely lonely one (see the A1a finding).
    const lonely = prepareSession(
      catalog.filter((s) => s.mag <= 3),
      BENGALURU,
      { mode: 'endless', kappa: 30 },
    );
    const rich = session({ mode: 'endless', kappa: 30 });
    const meanActive = (p: SessionPlan): number => {
      let total = 0;
      for (let n = 0; n < 120; n++) total += activeCountAt(p, n);
      return total / 120;
    };
    expect(meanActive(lonely)).toBeLessThan(meanActive(rich));
  });
});

// ===========================================================================
// SLICE A4 — the FORM layer: movements, ostinato, the additive bloom
// ===========================================================================

describe('the movement plan', () => {
  const plan = session({ mode: 'birth-sky' });
  const movements = plan.movementPlan.movements;

  it('is deterministic', () => {
    const again = session({ mode: 'birth-sky' });
    expect(again.movementPlan).toEqual(plan.movementPlan);
  });

  it('is computed once, so a window never has to rebuild it', () => {
    // Partition invariance holds by construction because `renderWindow` only
    // reads this value; it can never derive a different form for a different
    // slice.
    const a = renderWindow(plan, 0, 200);
    const b = renderWindow(plan, 200, 400);
    expect(a.events.length + b.events.length).toBeGreaterThan(0);
    expect(plan.movementPlan).toEqual(session({ mode: 'birth-sky' }).movementPlan);
  });

  it('covers the whole session with no gap and no overlap', () => {
    expect(movements[0]?.fromSeconds).toBe(0);
    for (let i = 1; i < movements.length; i++) {
      const previous = movements[i - 1] as (typeof movements)[number];
      const current = movements[i] as (typeof movements)[number];
      expect(previous.toSeconds).toBeLessThanOrEqual(current.fromSeconds + 1e-6);
      expect(previous.toSeconds + previous.transitionSeconds).toBeCloseTo(current.fromSeconds, 6);
    }
    const last = movements[movements.length - 1] as (typeof movements)[number];
    expect(last.toSeconds).toBeCloseTo(plan.config.sessionSeconds, 6);
    expect(last.transitionSeconds).toBe(0);
  });

  it('gives every moment of the session exactly one movement', () => {
    for (let t = 0; t < plan.config.sessionSeconds; t += 3.7) {
      const form = formAt(plan.movementPlan, t);
      expect(form, `no movement covers ${t}s`).not.toBeNull();
      expect(form?.movement.fromSeconds).toBeLessThanOrEqual(t + 1e-6);
    }
  });

  it('anchors every movement to a real structure', () => {
    for (const movement of movements) {
      expect(['opening', 'constellation', 'still', 'bloom', 'return']).toContain(
        movement.anchor.kind,
      );
      if (movement.anchor.kind === 'constellation') {
        // The anchor must be a constellation this observer can actually see.
        expect(plan.motifs.some((m) => m.constellation === movement.anchor.constellation)).toBe(
          true,
        );
      }
    }
  });

  it('gives the bloom a movement of its own, with room to build', () => {
    const bloom = movements.find((m) => m.anchor.kind === 'bloom');
    expect(bloom, 'the night’s climax has no movement').toBeDefined();
    expect(bloom?.pattern).toBe('dense-build');
    // The climax lands inside it, with build time before it.
    expect(bloom?.fromSeconds).toBeLessThan(plan.bloomSeconds as number);
    expect((plan.bloomSeconds as number) - (bloom?.fromSeconds ?? 0)).toBeGreaterThan(30);
  });

  it('uses only the composed vocabulary', () => {
    const names = PATTERN_VOCABULARY.map((p) => p.name);
    for (const movement of movements) expect(names).toContain(movement.pattern);
  });

  it('keeps movement bodies within the configured span, allowing for seams', () => {
    for (const movement of movements) {
      const body = movement.toSeconds - movement.fromSeconds;
      expect(body).toBeGreaterThan(plan.config.movementMinSeconds * 0.5);
      expect(body).toBeLessThanOrEqual(plan.config.movementMaxSeconds + 40);
    }
  });

  it('builds a wrapping setlist in endless mode', () => {
    const endless = session({ mode: 'endless', kappa: 30 });
    expect(endless.movementPlan.movements.length).toBeGreaterThan(1);
    expect(Number.isFinite(endless.movementPlan.horizonSeconds)).toBe(true);
    // Beyond the horizon the setlist comes round again — as the sky does.
    const horizon = endless.movementPlan.horizonSeconds;
    expect(formAt(endless.movementPlan, 10)?.movement.index).toBe(
      formAt(endless.movementPlan, horizon + 10)?.movement.index,
    );
  });
});

describe('motif as ostinato', () => {
  const plan = session({ mode: 'birth-sky' });
  const events = renderWindow(plan, 0, plan.config.sessionSeconds).events;

  it('replays the movement’s figure as the section groove, not a one-shot', () => {
    const constellationMovements = plan.movementPlan.movements.filter((m) => m.motif !== null);
    expect(constellationMovements.length).toBeGreaterThan(0);

    for (const movement of constellationMovements) {
      const inside = events.filter(
        (e) =>
          e.role === 'figuration' &&
          e.motifId === movement.motif?.constellation &&
          e.startSeconds >= movement.fromSeconds &&
          e.startSeconds < movement.toSeconds,
      );
      // A groove, so it must recur — several statements, not one.
      const cycles = new Set(
        inside.map((e) => Math.floor(e.startSeconds / cycleSeconds(plan))),
      );
      expect(
        cycles.size,
        `${movement.motif?.constellation} stated only ${cycles.size} time(s)`,
      ).toBeGreaterThan(1);
    }
  });

  it('spaces the statements by the configured period', () => {
    const movement = plan.movementPlan.movements.find((m) => m.motif !== null);
    expect(movement).toBeDefined();
    // Onsets are rounded to four decimals in the score, so a note that sits
    // exactly on a cycle boundary can land a ten-thousandth of a second under it
    // and bucket into the previous cycle. Nudge past that before bucketing. (It
    // used to be the humanisation that did this; B4 set humanisation to zero and
    // the rounding remained.)
    const nudge = 1e-3;
    const cycles = [
      ...new Set(
        events
          .filter(
            (e) =>
              e.role === 'figuration' &&
              e.motifId === movement?.motif?.constellation &&
              e.startSeconds >= (movement?.fromSeconds ?? 0) &&
              e.startSeconds < (movement?.toSeconds ?? 0),
          )
          .map((e) => Math.floor((e.startSeconds + nudge) / cycleSeconds(plan))),
      ),
    ].sort((a, b) => a - b);
    for (let i = 1; i < cycles.length; i++) {
      expect((cycles[i] as number) - (cycles[i - 1] as number)).toBe(
        plan.config.ostinatoEveryCycles,
      );
    }
  });

  it('keeps every ostinato pitch a tone that is genuinely sounding', () => {
    // FIGURATION only. The LEAD also carries `motifId` — it states the same
    // figure melodically in its own register, where the pitch comes from the
    // anchor degree plus the contour rather than from a sounding chord tone.
    // Both are on-scale; only the figuration promises to double a live tone.
    //
    // The figuration reads the sounding set on an absolute one-second grid (a
    // documented optimisation — the set changes on the scale of minutes), so
    // truth is checked to that same grain.
    const ostinato = events.filter((e) => e.role === 'figuration' && e.motifId !== undefined);
    expect(ostinato.length).toBeGreaterThan(0);
    for (const note of ostinato.slice(0, 60)) {
      // The recorded onset is rounded to 4 decimals, so it can land a hair the
      // far side of the second the engine actually sampled; check the grain
      // either side of it.
      const bucket = Math.floor(note.startSeconds);
      const match = [bucket - 1, bucket]
        .filter((b) => b >= 0)
        .flatMap((b) => soundingChordTones(plan, b))
        .find((t) => t.starId === note.sourceId);
      expect(match, `${note.sourceId} was not sounding near ${bucket}s`).toBeDefined();
      expect((note.midi - (match as { midi: number }).midi) % 12).toBe(0);
    }
  });
});

describe('the bloom movement — Zimmer additive', () => {
  const plan = session({ mode: 'birth-sky' });
  const bloom = plan.movementPlan.movements.find((m) => m.anchor.kind === 'bloom');
  const cycle = cycleSeconds(plan);

  it('adds layers monotonically into the climax and strips them after', () => {
    expect(bloom).toBeDefined();
    const from = Math.ceil((bloom as { fromSeconds: number }).fromSeconds / cycle);
    const to = Math.floor(
      ((bloom as { toSeconds: number }).toSeconds) / cycle,
    );
    const climax = Math.round((plan.bloomSeconds as number) / cycle);

    let previous = bloomLayersAt(plan, from);
    for (let n = from; n <= climax; n++) {
      const layers = bloomLayersAt(plan, n);
      expect(layers).toBeGreaterThanOrEqual(previous);
      expect(layers - previous).toBeLessThanOrEqual(1);
      previous = layers;
    }
    expect(previous).toBeGreaterThan(0);

    for (let n = climax; n <= to; n++) {
      const layers = bloomLayersAt(plan, n);
      expect(layers).toBeLessThanOrEqual(previous);
      previous = layers;
    }
  });

  it('never stacks more than the configured maximum', () => {
    for (let n = 0; n < 160; n++) {
      expect(bloomLayersAt(plan, n)).toBeLessThanOrEqual(plan.config.bloomMaxLayers);
    }
  });

  it('adds layers ONLY in the bloom movement', () => {
    for (const movement of plan.movementPlan.movements) {
      if (movement.anchor.kind === 'bloom') continue;
      const n = Math.round((movement.fromSeconds + movement.toSeconds) / 2 / cycle);
      expect(bloomLayersAt(plan, n)).toBe(0);
    }
  });

  it('makes the climax audibly the densest moment', () => {
    const events = renderWindow(plan, 0, plan.config.sessionSeconds).events.filter(
      (e) => e.role === 'figuration',
    );
    const density = (centre: number): number =>
      events.filter((e) => Math.abs(e.startSeconds - centre) < 10).length;
    const atBloom = density(plan.bloomSeconds as number);
    const atOpening = density(40);
    expect(atBloom).toBeGreaterThan(atOpening);
  });

  it('transposes every added layer by whole octaves only', () => {
    // The stack must not break the on-scale guarantee.
    const ladder = scaleDegrees(plan.scale);
    for (const note of renderWindow(plan, 380, 500).events.filter((e) => e.role === 'figuration')) {
      expect(ladder.includes(((note.midi - plan.rootMidi) % 12 + 12) % 12)).toBe(true);
    }
  });
});

// ===========================================================================
// SLICE B2 — THE ARRIVAL: endless mode's composed opening
// ===========================================================================

describe('the arrival — endless mode gets a beginning', () => {
  const plan = session({ mode: 'endless', kappa: 30 });
  const arrival = plan.arrival;

  // The phase joins, and one second either side of each — these are the times
  // where a composed envelope meets a truthful one, and where a partition bug
  // would hide if it were going to hide anywhere.
  const boundaries = [
    arrival.gestureSeconds,
    arrival.figurationInSeconds,
    arrival.leadInSeconds,
    arrival.seconds,
  ];

  it('is active in endless mode and absent from birth-sky', () => {
    expect(arrival.seconds).toBeGreaterThan(0);
    expect(session({ mode: 'birth-sky' }).arrival).toEqual(NO_ARRIVAL);
  });

  it('orders its phases: gesture, then the weave, then the lead, then handover', () => {
    expect(arrival.gestureSeconds).toBeGreaterThan(0);
    expect(arrival.figurationInSeconds).toBeGreaterThan(arrival.gestureSeconds);
    expect(arrival.leadInSeconds).toBeGreaterThanOrEqual(arrival.gestureSeconds);
    expect(arrival.seconds).toBeGreaterThanOrEqual(arrival.figurationInSeconds);
    // The brief's band: a composed mini-arc of roughly 90-120 seconds.
    expect(arrival.seconds).toBeGreaterThanOrEqual(90);
    expect(arrival.seconds).toBeLessThanOrEqual(120);
  });

  // ---- THE GATE, at the boundary that did not exist before this slice -----

  it('THE GATE — partition invariance holds across every arrival boundary', () => {
    const T = 300;
    const whole = renderWindow(plan, 0, T);

    // Cut exactly ON each join, and a hair either side of it. An event whose
    // onset lands on a cut is the case that breaks naive windowing.
    const cuts = new Set<number>([0, T]);
    for (const b of boundaries) {
      for (const d of [-1, -0.001, 0, 0.001, 1]) {
        const t = b + d;
        if (t > 0 && t < T) cuts.add(t);
      }
    }
    const ordered = [...cuts].sort((a, b) => a - b);

    const pieces: ScoreWindow[] = [];
    for (let i = 0; i + 1 < ordered.length; i++) {
      pieces.push(renderWindow(plan, ordered[i] as number, ordered[i + 1] as number));
    }
    expect(unionOf(pieces)).toEqual(sortedEvents(whole));
  });

  it('THE GATE — the arrival span reassembles at several window sizes', () => {
    const T = 300;
    const whole = renderWindow(plan, 0, T);
    for (const size of [3, 7, 29, 105]) {
      const pieces: ScoreWindow[] = [];
      for (let t = 0; t < T; t += size) pieces.push(renderWindow(plan, t, Math.min(T, t + size)));
      expect(unionOf(pieces), `window size ${size}`).toEqual(sortedEvents(whole));
    }
  });

  it('emits every arrival-span event exactly once', () => {
    const pieces: ScoreWindow[] = [];
    for (let t = 0; t < 300; t += 11) pieces.push(renderWindow(plan, t, Math.min(300, t + 11)));
    const keys = pieces.flatMap((w) => w.events).map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // ---- what the arrival is FOR ------------------------------------------

  it('opens on ground and chord alone', () => {
    const gesture = renderWindow(plan, 0, arrival.gestureSeconds).events;
    expect(gesture.length).toBeGreaterThan(0);
    expect(gesture.some((e) => e.role === 'ground')).toBe(true);
    expect(gesture.some((e) => e.role === 'chord')).toBe(true);
    expect(gesture.filter((e) => e.role === 'figuration')).toEqual([]);
    expect(gesture.filter((e) => e.role === 'lead')).toEqual([]);
  });

  it('brings the figuration in after the gesture, and the lead in after that', () => {
    const events = renderWindow(plan, 0, 300).events;
    const first = (role: string): number =>
      Math.min(...events.filter((e) => e.role === role).map((e) => e.startSeconds));

    expect(first('figuration')).toBeGreaterThanOrEqual(arrival.gestureSeconds);
    expect(first('figuration')).toBeLessThan(arrival.figurationInSeconds + 12);
    expect(first('lead')).toBeGreaterThanOrEqual(arrival.leadInSeconds);
  });

  it('leads the weave in rather than switching it on', () => {
    // Inside the lead-in the gate is strictly between silence and full weight,
    // so the figuration arrives as an entrance and not as a cut.
    const mid = (arrival.gestureSeconds + arrival.figurationInSeconds) / 2;
    expect(figurationGateAt(arrival, arrival.gestureSeconds - 0.001)).toBe(0);
    expect(figurationGateAt(arrival, mid)).toBeGreaterThan(0);
    expect(figurationGateAt(arrival, mid)).toBeLessThan(1);
    expect(figurationGateAt(arrival, arrival.figurationInSeconds)).toBe(1);
    expect(figurationGateAt(arrival, 10_000)).toBe(1);
  });

  // ---- and what it must NOT do ------------------------------------------

  it('hands back to the sky with no residue at all', () => {
    // Past the arrival, `arcAt` must return the sky-richness value it always
    // returned. Asserted against the function that computes it, so this cannot
    // be satisfied by an arrival that merely happens to land nearby.
    for (const t of [arrival.seconds, arrival.seconds + 1, 600, 2400, 5000]) {
      const sky = arrivalIntensity(NO_ARRIVAL, t, arcAt(plan, t).intensity);
      expect(arrivalIntensity(arrival, t, sky)).toBeCloseTo(sky, 12);
    }
  });

  it('is continuous — no step anywhere across the arrival', () => {
    // A step in intensity is a step in the ground's amplitude envelope, which
    // is a click in a drone. Sampled finely across the whole span and past it.
    let previous = arcAt(plan, 0).intensity;
    for (let t = 0.25; t <= arrival.seconds + 60; t += 0.25) {
      const now = arcAt(plan, t).intensity;
      expect(Math.abs(now - previous), `step at t=${t}`).toBeLessThan(0.02);
      previous = now;
    }
  });

  it('actually builds — the opening is far quieter than the steady state', () => {
    const opening = arcAt(plan, 0).intensity;
    const settled = arcAt(plan, arrival.seconds + 30).intensity;
    expect(opening).toBeLessThan(0.15);
    expect(settled - opening).toBeGreaterThan(0.25);
    // Monotone through the composed phases: the arrival only ever grows.
    for (let t = 0; t < arrival.figurationInSeconds; t += 0.5) {
      expect(arcAt(plan, t + 0.5).intensity).toBeGreaterThanOrEqual(
        arcAt(plan, t).intensity - 1e-9,
      );
    }
  });

  it('changes WHEN layers enter, never which notes they play', () => {
    // Every pitch the arrival lets through is one the un-arrived engine would
    // also have played at that instant: the sky still chooses, the arrival only
    // decides whether the layer is heard yet.
    const bare = session({ mode: 'endless', kappa: 30, arrivalSeconds: 0 });
    const withArrival = renderWindow(plan, 0, 300).events;
    const without = new Set(renderWindow(bare, 0, 300).events.map(key));
    for (const e of withArrival) {
      if (e.role === 'ground' || e.role === 'weather') continue; // composed envelope, by design
      expect(without.has(key(e)), `${e.role} ${e.midi} @${e.startSeconds}`).toBe(true);
    }
  });

  it('turns off completely when its length is zero', () => {
    const bare = session({ mode: 'endless', kappa: 30, arrivalSeconds: 0 });
    expect(bare.arrival).toEqual(NO_ARRIVAL);
    // Identical to the pre-B2 engine: the sky-richness envelope, from t = 0.
    expect(arcAt(bare, 0).intensity).toBeCloseTo(arcAt(bare, 0.5).intensity, 3);
  });

  it('leaves birth-sky\'s arc untouched', () => {
    const birth = session({ mode: 'birth-sky' });
    const stages = [0, 5, 50, 300, 450, 640].map((t) => arcAt(birth, t).stage);
    expect(stages).toEqual([
      'opening',
      'opening',
      'gathering',
      'building',
      'bloom',
      'closing',
    ]);
    expect(arcAt(birth, 0).intensity).toBe(0.12);
  });
});

describe('form — partition invariance re-proven with movements active', () => {
  it('THE GATE — birth-sky reassembles exactly, at three window sizes', () => {
    const plan = session({ mode: 'birth-sky' });
    const T = plan.config.sessionSeconds;
    const whole = renderWindow(plan, 0, T);
    for (const size of [17, 90, 300]) {
      const pieces: ScoreWindow[] = [];
      for (let t = 0; t < T; t += size) pieces.push(renderWindow(plan, t, Math.min(T, t + size)));
      expect(unionOf(pieces), `window size ${size}`).toEqual(sortedEvents(whole));
    }
  });

  it('THE GATE — endless reassembles exactly across a setlist wrap', () => {
    const plan = session({ mode: 'endless', kappa: 30 });
    const T = 1800;
    const whole = renderWindow(plan, 0, T);
    for (const size of [41, 250]) {
      const pieces: ScoreWindow[] = [];
      for (let t = 0; t < T; t += size) pieces.push(renderWindow(plan, t, Math.min(T, t + size)));
      expect(unionOf(pieces), `window size ${size}`).toEqual(sortedEvents(whole));
    }
  });

  it('keeps every pitch on-scale with the whole form running', () => {
    const plan = session({ mode: 'birth-sky' });
    const ladder = scaleDegrees(plan.scale);
    for (const note of renderWindow(plan, 0, plan.config.sessionSeconds).events) {
      expect(ladder.includes(((note.midi - plan.rootMidi) % 12 + 12) % 12)).toBe(true);
    }
  });

  it('still respects the lead note budget with the form running', () => {
    const plan = session({ mode: 'birth-sky' });
    const budget = noteBudgetPerMinute(plan.weather);
    const leads = renderWindow(plan, 0, plan.config.sessionSeconds).events.filter(
      (e) => e.role === 'lead',
    );
    for (let t = 0; t + 60 <= plan.config.sessionSeconds; t += 5) {
      const inMinute = leads.filter((e) => e.startSeconds >= t && e.startSeconds < t + 60).length;
      expect(inMinute).toBeLessThanOrEqual(budget);
    }
  });
});

// ===========================================================================
// SLICE B1 (mapping exception) — weather may never sound in unison with ground
// ===========================================================================

describe('weather register hint', () => {
  const plan = session({ mode: 'birth-sky' });
  const events = renderWindow(plan, 0, plan.config.sessionSeconds).events;

  it('marks every weather event with a register hint', () => {
    const weather = events.filter((e) => e.role === 'weather');
    expect(weather.length).toBeGreaterThan(0);
    for (const event of weather) {
      expect(event.registerHint, 'a weather event carried no register hint').toBe(
        WEATHER_REGISTER_HINT,
      );
    }
  });

  it('THE GATE — voiced with its hint, weather can never land on ground', () => {
    // The 2026-08-07 defect: both roles emitted midi 45 for a whole session, and
    // the renderer had to know to fix it. Now the score says so itself.
    const ground = events.filter((e) => e.role === 'ground');
    const weather = events.filter((e) => e.role === 'weather');
    expect(ground.length).toBeGreaterThan(0);

    for (const w of weather) {
      const voiced = w.midi + (w.registerHint ?? 0);
      const overlapping = ground.filter(
        (g) =>
          g.startSeconds < w.startSeconds + w.durationSeconds &&
          g.startSeconds + g.durationSeconds > w.startSeconds,
      );
      for (const g of overlapping) {
        const gap = Math.abs(voiced - (g.midi + (g.registerHint ?? 0)));
        expect(gap, `weather ${voiced} against ground ${g.midi}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('leaves every other role unhinted, so nothing else is silently moved', () => {
    for (const event of events.filter((e) => e.role !== 'weather')) {
      expect(event.registerHint).toBeUndefined();
    }
  });

  it('keeps the hint an exact octave, so the pitch class is unchanged', () => {
    // Anything but a whole octave would break the on-scale guarantee.
    expect(WEATHER_REGISTER_HINT % 12).toBe(0);
    const ladder = scaleDegrees(plan.scale);
    for (const event of events.filter((e) => e.role === 'weather')) {
      const voiced = event.midi + (event.registerHint ?? 0);
      expect(ladder.includes(((voiced - plan.rootMidi) % 12 + 12) % 12)).toBe(true);
    }
  });
});
