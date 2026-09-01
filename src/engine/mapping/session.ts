/**
 * Living Sky — the session plan (design §9).
 *
 * Everything that is decided once, before a single note is emitted: the
 * compression, the key, the session's weather, which star opens the piece, and
 * where the cathartic bloom lands. All of it pure — the same observer and config
 * always produce the same plan.
 *
 * Splitting this out is what keeps `renderWindow` cheap: the plan is computed
 * once and every window reads it.
 */

import type { ObserverInput, Star } from '../model/index.ts';
import { toHorizon } from './astro.ts';
import { starEventTimes, type StarEventTimes } from './skyEvents.ts';
import {
  DEGREES_PER_SKY_SECOND,
  SIDEREAL_DAY_SECONDS,
  lstAt,
  sessionLst0,
  firstTimeAtLst,
} from './skyTime.ts';
import {
  measureWeather,
  meanWeather,
  registerSpanOctaves,
  scaleForWeather,
  silenceBudget,
  notesPerPhrase,
} from './skyWeather.ts';
import { scaleDegrees, type ScaleName } from './scales.ts';
import { deriveAllMotifs, type Motif } from './motif.ts';
import { planMovements, type MovementPlan } from './movement.ts';
import { arrivalIntensity, arrivalPlanFor, type ArrivalPlan } from './arrival.ts';
import type { ArcState, LivingSkyConfig, SkyWeather } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Defaults for a Living Sky session. Every one of these is a tuning dial. */
export const DEFAULT_LIVING_SKY_CONFIG: LivingSkyConfig = {
  // inherited MappingConfig
  scale: 'minor-pentatonic',
  rootMidi: 45, // A2
  maxVoices: 14,
  loopSeconds: 18, // export-only now (design §P8)
  seed: 1,

  mode: 'birth-sky',
  sessionSeconds: 660,
  kappa: 30,
  kappaBand: [40, 90],
  preferredKappa: 60,
  bloomFraction: 0.68,

  chordMagLimit: 2.0,
  leadMagLimit: 2.5,
  bloomMagLimit: 1.5,

  octaveLiftDegrees: 55,
  horizonFadeDegrees: 25,
  envelopeStepSeconds: 5,
  circumpolarSegmentSeconds: 600,

  constellationAltitudeThreshold: 35,
  openingAnchorRule: 'bookends',
  openingStarMinVisibleFraction: 0.35,

  phraseSeconds: 32,
  lookbackPhrases: 3,
  minNoteGapSeconds: 6,
  leadOctaveOffset: 2,

  gestureSeconds: 8,
  gatheringSeconds: 75,
  closingSeconds: 60,

  // THE ARRIVAL (Slice B2). 105 s sits in the middle of the brief's 90–120 s
  // band. The gesture is 18 s because a drone needs about that long to stop
  // being a sound and start being a place; the figuration then takes 12 s to
  // arrive, and the lead waits until 34 s, by which point there is a weave for
  // it to speak over. These four numbers are composed clothing in the same
  // covenant category as tempo and timbre, and the ear gate rules on them.
  arrivalSeconds: 105,
  arrivalGestureSeconds: 18,
  arrivalEntrySeconds: 12,
  arrivalLeadInSeconds: 34,

  figurationSlots: 8,
  figurationSlotSeconds: 0.55,
  figurationMinActive: 1,
  figurationMaxActive: 7,
  figurationGain: 0.42,
  figurationHumanizeSeconds: 0.018,
  figurationNoteSeconds: 1.6,
  figurationRegisterLowOctave: 1.2,
  figurationRegisterHighOctave: 2.1,
  figurationMaxRateStep: 0.3,

  movementMinSeconds: 60,
  movementMaxSeconds: 120,
  movementLeadInSeconds: 8,
  transitionSecondsRange: [12, 16],
  bloomBuildSeconds: 50,
  ostinatoEveryCycles: 4,
  bloomLayerEveryCycles: 2,
  bloomMaxLayers: 3,
  formMaxRateStep: 0.3,

  continuousSegmentSeconds: 30,
  modulatorPeriods: [1123, 1811, 2417, 3299],
};

/** A chord candidate, with everything time-independent precomputed. */
export interface ChordStarPlan {
  star: Star;
  times: StarEventTimes;
  /** Scale-degree index within one octave — the star's harmonic identity. */
  degree: number;
  /** Full-ladder placement, used only to compute the sounding centroid. */
  canonicalMidi: number;
  /** 0 = brightest. Drives the opening bloom and the closing thin-out. */
  brightnessRank: number;
}

export interface SessionPlan {
  observer: ObserverInput;
  config: LivingSkyConfig;
  catalog: Star[];
  lst0: number;
  kappa: number;
  scale: ScaleName;
  rootMidi: number;
  degreesPerOctave: number;
  registerOctaves: number;
  weather: SkyWeather;
  silenceBudget: number;
  notesPerPhrase: number;
  /** Piece time of the cathartic bloom; null in endless mode. */
  bloomSeconds: number | null;
  /** The star whose culmination is the bloom, when there is one. */
  bloomStarId: string | null;
  /** The star that opens and closes the piece. */
  openingStarId: string | null;
  chordStars: ChordStarPlan[];
  leadStars: Star[];
  /** Constellation motifs that can carry a phrase, derived once. */
  motifs: Motif[];
  /** Lookup for the stars named by those motifs. */
  motifStars: Map<string, Star>;
  /**
   * Memo for coarse weather samples. Pure caching — it never changes what is
   * produced, only how often the catalogue has to be walked.
   */
  /** The form: movements, their patterns, and the transitions between them. */
  movementPlan: MovementPlan;
  /**
   * Endless mode's composed opening. `NO_ARRIVAL` in birth-sky, which has its
   * own arc. Precomputed rather than derived per call because `arcAt` runs for
   * every envelope breakpoint of every continuous voice.
   */
  arrival: ArrivalPlan;
  weatherCache: Map<number, SkyWeather>;
  /**
   * Memo for the sounding-chord-tone set, on an absolute grid. Pure caching: the
   * figuration asks tens of thousands of times per render and the set changes on
   * the scale of minutes, so recomputing it per note was the whole cost.
   */
  toneCache: Map<number, unknown>;
}

/** Fill in any missing config fields from the defaults. */
export function resolveConfig(config: Partial<LivingSkyConfig> = {}): LivingSkyConfig {
  return { ...DEFAULT_LIVING_SKY_CONFIG, ...config };
}

/**
 * How comfortable a compression feels, peaking at `preferredKappa`.
 *
 * This is the mitigation for the wart in design §P6: solving κ so the real
 * climax lands at the golden section makes the pace vary between users, so the
 * solver is drawn toward a common pace and only strays for a genuinely better
 * climax.
 */
export function paceComfort(kappa: number, preferred: number): number {
  const spread = 22;
  return Math.exp(-(((kappa - preferred) / spread) ** 2));
}

/** How much of an occasion a culmination is: brightness first, then height. */
function bloomSalience(star: Star, maxAltitude: number): number {
  const brightness = clamp((6.5 - star.mag) / 8, 0, 1);
  const height = clamp(maxAltitude / 90, 0, 1);
  return 0.75 * brightness + 0.25 * height;
}

/**
 * Solve for the compression that puts the night's most dramatic true event at
 * the arc's climax (design §9.3).
 *
 * We do not move the event — we choose how fast the night flows so it arrives
 * where the arc needs it. Time compression is already declared artistic, so this
 * is a legitimate composer's dial, and the event stays entirely real.
 *
 * Verified on Shambu's own birth sky: seven candidates fall in the [40, 90] band,
 * the best being Sirius — the brightest star in the sky, at 60° altitude.
 */
export function solveKappa(
  catalog: Star[],
  observer: ObserverInput,
  config: LivingSkyConfig,
  lst0: number,
): { kappa: number; bloomSeconds: number; bloomStarId: string | null } {
  const target = config.sessionSeconds * config.bloomFraction;
  const [lo, hi] = config.kappaBand;

  let best: { kappa: number; starId: string; score: number } | null = null;

  for (const star of catalog) {
    if (star.mag > config.bloomMagLimit) continue;
    const times = starEventTimes(star, observer.latitude);
    if (times.maxAltitude <= 0) continue;

    // Sky-seconds from the session origin to this star's culmination, and the
    // repeats one sidereal day apart (a slow κ may only reach the second one).
    const base = firstTimeAtLst(lst0, times.culminationLst, 1);
    for (let repeat = 0; repeat < 3; repeat++) {
      const skySeconds = base + repeat * SIDEREAL_DAY_SECONDS;
      if (skySeconds <= 0) continue;
      const kappa = skySeconds / target;
      if (kappa < lo || kappa > hi) continue;

      const score = bloomSalience(star, times.maxAltitude) * paceComfort(kappa, config.preferredKappa);
      if (
        !best ||
        score > best.score + 1e-12 ||
        (Math.abs(score - best.score) <= 1e-12 && star.id < best.starId)
      ) {
        best = { kappa, starId: star.id, score };
      }
    }
  }

  if (best) {
    return { kappa: best.kappa, bloomSeconds: target, bloomStarId: best.starId };
  }

  // No bright culmination reachable in the band. The piece is still valid — it
  // simply blooms less dramatically, which is honest.
  return { kappa: config.preferredKappa, bloomSeconds: target, bloomStarId: null };
}

/**
 * A star's harmonic identity: the scale degree of its MAXIMUM altitude.
 *
 * Design §10.1, approved. Phase 2 mapped *current* altitude to pitch, which
 * cannot survive an advancing sky — every star rises through altitude 0, so
 * every voice would enter on the root and then re-quantize as it climbed. Using
 * the culmination altitude instead gives each star a stable note ("how high this
 * star ever gets from where you are", a real quantity), and the sense of the
 * star climbing comes from octave motion, which preserves pitch class.
 *
 * Measured: for stars brighter than magnitude 2 at Bengaluru this populates 14
 * of the 15 available ladder steps — a well-spread chord, not a cluster.
 */
export function degreeForMaxAltitude(maxAltitude: number, degreesPerOctave: number): number {
  const normalized = clamp(maxAltitude, 0, 90) / 90;
  return Math.round(normalized * (degreesPerOctave - 1));
}

/** Full-ladder placement across the register span — the centroid reference. */
export function canonicalMidiForMaxAltitude(
  maxAltitude: number,
  rootMidi: number,
  scale: string,
  registerOctaves: number,
): number {
  const degrees = scaleDegrees(scale);
  const steps = degrees.length * registerOctaves;
  const step = Math.round((clamp(maxAltitude, 0, 90) / 90) * (steps - 1));
  const octave = Math.floor(step / degrees.length);
  const degree = degrees[step % degrees.length] as number;
  return clamp(Math.round(rootMidi + 12 * octave + degree), 0, 127);
}

/**
 * Build everything a session decides once.
 *
 * Weather is sampled at several points across the session (or across a sidereal
 * day, for endless mode) and averaged, so the key reflects the night rather than
 * one instant of it.
 */
export function prepareSession(
  catalog: Star[],
  observer: ObserverInput,
  partialConfig: Partial<LivingSkyConfig> = {},
): SessionPlan {
  const config = resolveConfig(partialConfig);
  const lst0 = sessionLst0(observer);

  const solved =
    config.mode === 'birth-sky'
      ? solveKappa(catalog, observer, config, lst0)
      : { kappa: config.kappa, bloomSeconds: 0, bloomStarId: null };
  const kappa = solved.kappa;

  // Sample the sky across what the session will actually traverse.
  const span =
    config.mode === 'birth-sky'
      ? config.sessionSeconds
      : SIDEREAL_DAY_SECONDS / kappa;
  const samples: SkyWeather[] = [];
  const SAMPLE_COUNT = 5;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = (span * i) / SAMPLE_COUNT;
    samples.push(measureWeather(catalog, observer.latitude, lstAt(lst0, t, kappa)));
  }
  const weather = meanWeather(samples);

  const scale = scaleForWeather(weather);
  const rootMidi = config.rootMidi;
  const degreesPerOctave = scaleDegrees(scale).length;
  const registerOctaves = registerSpanOctaves(weather);

  // ---- the chord pool
  const chordStars: ChordStarPlan[] = [];
  for (const star of catalog) {
    if (star.mag > config.chordMagLimit) continue;
    const times = starEventTimes(star, observer.latitude);
    if (times.visibility === 'never-rises') continue;
    chordStars.push({
      star,
      times,
      degree: degreeForMaxAltitude(times.maxAltitude, degreesPerOctave),
      canonicalMidi: canonicalMidiForMaxAltitude(times.maxAltitude, rootMidi, scale, registerOctaves),
      brightnessRank: 0,
    });
  }
  chordStars.sort((a, b) => a.star.mag - b.star.mag || compareIds(a.star.id, b.star.id));
  chordStars.forEach((entry, index) => {
    entry.brightnessRank = index;
  });

  // ---- the lead pool
  const leadStars = catalog
    .filter((star) => star.mag <= config.leadMagLimit)
    .filter((star) => starEventTimes(star, observer.latitude).maxAltitude > 0)
    .sort((a, b) => a.mag - b.mag || compareIds(a.id, b.id));

  // ---- the star that opens (and closes) the piece
  //
  // Simply taking the brightest star up at t = 0 produced a thin opening on
  // Shambu's own sky: Arcturus was brightest but SETTING, and at 66x it dropped
  // below the horizon 16 seconds in. The anchor must survive the gathering, so
  // the star that introduces the piece is still there when the sky has answered.
  const upAtStart = chordStars.filter(
    (entry) => toHorizon(entry.star, observer.latitude, lst0).altitude > 0,
  );

  const survivesGathering = (entry: ChordStarPlan): boolean => {
    if (entry.times.visibility === 'circumpolar') return true;
    if (entry.times.setLst === undefined) return false;
    const required =
      (config.mode === 'birth-sky' ? config.sessionSeconds : SIDEREAL_DAY_SECONDS / kappa) *
      config.openingStarMinVisibleFraction;
    return firstTimeAtLst(lst0, entry.times.setLst, kappa) >= required;
  };

  // Within HQ's qualifying set, prefer a star that can also close the piece.
  // The gesture is one → all → one: if the anchor has set by the final bar the
  // mirror cannot complete truthfully, and forcing it to sound would be a lie.
  const stillUpAtClose = (entry: ChordStarPlan): boolean => {
    if (config.mode !== 'birth-sky') return true;
    const lstAtEnd = lstAt(lst0, config.sessionSeconds, kappa);
    return toHorizon(entry.star, observer.latitude, lstAtEnd).altitude > 0;
  };

  const qualifying = upAtStart.filter(survivesGathering);
  const anchor =
    config.openingAnchorRule === 'brightest'
      ? upAtStart[0]
      : config.openingAnchorRule === 'survives-gathering'
        ? (qualifying[0] ?? upAtStart[0])
        : (qualifying.find(stillUpAtClose) ?? qualifying[0] ?? upAtStart[0]);
  const openingStarId = anchor?.star.id ?? null;

  // ---- constellation motifs
  //
  // Derived from RA/Dec alone, so the figure is identical from every place on
  // Earth — that invariance is what the identity claim rests on. Only motifs
  // whose stars can ALL rise here are kept; a constellation that never fully
  // clears this observer's horizon has nothing to say to them.
  const allMotifs = deriveAllMotifs(catalog);
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const motifs = allMotifs.filter((motif) =>
    motif.starIds.every((id) => {
      const star = byId.get(id);
      return star ? starEventTimes(star, observer.latitude).maxAltitude > 0 : false;
    }),
  );
  const motifStars = new Map<string, Star>();
  for (const motif of motifs) {
    for (const id of motif.starIds) {
      const star = byId.get(id);
      if (star) motifStars.set(id, star);
    }
  }

  // ---- the form layer, computed once so `renderWindow` only ever reads it
  const movementPlan = planMovements({
    config,
    motifs,
    motifStars,
    latitude: observer.latitude,
    lst0,
    kappa,
    bloomSeconds: config.mode === 'birth-sky' ? solved.bloomSeconds : null,
    bloomStarId: solved.bloomStarId,
    openingStarId,
  });

  return {
    observer,
    config,
    catalog,
    lst0,
    kappa,
    scale,
    rootMidi,
    degreesPerOctave,
    registerOctaves,
    weather,
    silenceBudget: silenceBudget(weather),
    notesPerPhrase: notesPerPhrase(weather),
    bloomSeconds: config.mode === 'birth-sky' ? solved.bloomSeconds : null,
    bloomStarId: solved.bloomStarId,
    openingStarId,
    chordStars,
    leadStars,
    motifs,
    motifStars,
    movementPlan,
    arrival: arrivalPlanFor(config),
    weatherCache: new Map(),
    toneCache: new Map(),
  };
}

function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Where the piece is in its arc (design §9.1).
 *
 * In endless mode there is no `u`: the arc follows the sky's own richness
 * instead, which is both truthful and non-repeating on the sidereal period
 * without a composer inventing a cycle.
 */
export function arcAt(plan: SessionPlan, pieceSeconds: number): ArcState {
  const { config } = plan;

  if (config.mode === 'endless') {
    // The arc follows how much of the bright sky is up — which is what actually
    // drives the music's fullness, and is 48 horizon reductions rather than the
    // 8,849 a full weather measurement costs. `arcAt` is called for every
    // envelope breakpoint, so the difference is the difference between a stream
    // that can be scheduled in real time and one that cannot.
    const lst = lstAt(plan.lst0, pieceSeconds, plan.kappa);
    let up = 0;
    for (const entry of plan.chordStars) {
      if (toHorizon(entry.star, plan.observer.latitude, lst).altitude > 0) up++;
    }
    const fraction = plan.chordStars.length > 0 ? up / plan.chordStars.length : 0;
    const sky = clamp(0.35 + 0.65 * fraction, 0, 1);
    // SLICE B2 — THE ARRIVAL. For the first ~105 seconds a composed opening
    // envelope is blended into the sky's own, so an endless session has a
    // beginning instead of merely a start. After `arrival.seconds` the blend
    // weight is exactly 1 and this returns `sky` unchanged, which is the whole
    // of the pre-B2 behaviour with no residue. See `arrival.ts` for why.
    return {
      stage: 'endless',
      u: 0,
      intensity: clamp(arrivalIntensity(plan.arrival, pieceSeconds, sky), 0, 1),
    };
  }

  const u = clamp(pieceSeconds / config.sessionSeconds, 0, 1);
  const bloomU = config.bloomFraction;
  const openU = config.gestureSeconds / config.sessionSeconds;
  const gatherU = config.gatheringSeconds / config.sessionSeconds;
  const closeU = 1 - config.closingSeconds / config.sessionSeconds;

  if (u < openU) return { stage: 'opening', u, intensity: 0.12 };
  if (u < gatherU) {
    const p = (u - openU) / Math.max(1e-9, gatherU - openU);
    return { stage: 'gathering', u, intensity: clamp(0.12 + 0.38 * p, 0, 1) };
  }
  if (u < bloomU - 0.06) {
    const p = (u - gatherU) / Math.max(1e-9, bloomU - 0.06 - gatherU);
    return { stage: 'building', u, intensity: clamp(0.5 + 0.4 * p, 0, 1) };
  }
  if (u <= bloomU + 0.06) return { stage: 'bloom', u, intensity: 1 };
  if (u < closeU) {
    const p = (u - (bloomU + 0.06)) / Math.max(1e-9, closeU - (bloomU + 0.06));
    return { stage: 'release', u, intensity: clamp(1 - 0.55 * p, 0, 1) };
  }
  const p = (u - closeU) / Math.max(1e-9, 1 - closeU);
  return { stage: 'closing', u, intensity: clamp(0.45 * (1 - p) + 0.08, 0, 1) };
}

export { DEGREES_PER_SKY_SECOND };
