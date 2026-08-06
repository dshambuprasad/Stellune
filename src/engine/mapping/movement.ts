/**
 * Living Sky — the MOVEMENT PLANNER (Slice A4, the Form Layer).
 *
 * Musical Vision §6b, after the v2 listen: *evolution is not form*. A3 gave
 * continuous drift; music needs articulated sections, smoothly joined. The
 * doctrine that A3 got backwards, and that this slice corrects:
 *
 *   **repetition belongs at the MESO scale** — a pattern must repeat long enough
 *   to be *learned*, or it never becomes a groove;
 *   **non-repetition belongs at the MACRO scale** — the piece never returns to
 *   the same state.
 *
 * So the session partitions into MOVEMENTS of roughly a minute or two, each
 * anchored to a real salient structure the engine already detects, each with its
 * own figuration pattern, register and density. Contrast *between* movements,
 * repetition *within* them, and TRANSITIONS as first-class objects between —
 * the DJ-mix model, not a hard cut and not an imperceptible drift.
 *
 * ---
 *
 * THE TRUTH BOUNDARY (Vision §6b, restated because it is easy to blur)
 *
 * The sky decides **which** patterns play, **when** they change, **how dense**
 * they are, **in what harmony**, and **toward what climax** — all of that comes
 * from real prominences, real event density, and the real culmination that
 * anchors the bloom. The pattern *vocabulary itself* is composed clothing, the
 * same covenant category as timbre and tempo, and is labelled as such. Star
 * positions are not asked to invent rhythm; they conduct it.
 *
 * ---
 *
 * PURITY: the whole plan is computed ONCE, inside `prepareSession`, and is then
 * a value like any other. `renderWindow` only ever reads it, so partition
 * invariance holds by construction rather than by care.
 */

import { toHorizon } from './astro.ts';
import { lstAt, siderealPeriodInPiece } from './skyTime.ts';
import type { Motif } from './motif.ts';
import type { LivingSkyConfig } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The composed pattern vocabulary — clothing, not truth. */
export type PatternName =
  | 'sparse-low'
  | 'half-time-still'
  | 'mid-weave'
  | 'dense-build'
  | 'thinning-return';

/**
 * One pattern from the vocabulary.
 *
 * `slots` is a mask over the figuration cycle: which positions sound. This is
 * what makes a movement's groove *learnable* — inside a movement the mask does
 * not change, so the ear gets the same rhythm often enough to recognise it.
 */
export interface FigurationPattern {
  name: PatternName;
  slots: boolean[];
  /** Octaves relative to the figuration's base register. */
  registerOffset: number;
  velocityScale: number;
}

/**
 * The five patterns of HQ's v3 sketch, which passed the ear gate.
 *
 * Masks are written for an 8-slot cycle. A shorter or longer cycle reads them
 * cyclically, so the vocabulary survives a change to `figurationSlots`.
 */
export const PATTERN_VOCABULARY: readonly FigurationPattern[] = [
  {
    name: 'sparse-low',
    slots: [true, false, false, false, true, false, false, false],
    registerOffset: -1,
    velocityScale: 0.8,
  },
  {
    name: 'half-time-still',
    slots: [true, false, false, false, false, false, false, false],
    registerOffset: -1,
    velocityScale: 0.7,
  },
  {
    name: 'mid-weave',
    slots: [true, false, true, false, true, false, true, false],
    registerOffset: 0,
    velocityScale: 0.9,
  },
  {
    name: 'dense-build',
    slots: [true, true, true, false, true, true, true, false],
    registerOffset: 1,
    velocityScale: 1,
  },
  {
    name: 'thinning-return',
    slots: [true, false, false, true, false, false, true, false],
    registerOffset: 0,
    velocityScale: 0.75,
  },
];

export function patternByName(name: PatternName): FigurationPattern {
  const found = PATTERN_VOCABULARY.find((p) => p.name === name);
  if (!found) throw new Error(`Cosmophony: unknown figuration pattern "${name}".`);
  return found;
}

/** What real thing a movement is built around. */
export interface MovementAnchor {
  kind: 'opening' | 'constellation' | 'still' | 'bloom' | 'return';
  atSeconds: number;
  constellation?: string;
  starId?: string;
}

export interface Movement {
  index: number;
  /** Body of the movement. */
  fromSeconds: number;
  toSeconds: number;
  /** Transition zone that follows, `[toSeconds, toSeconds + transitionSeconds)`. */
  transitionSeconds: number;
  pattern: PatternName;
  anchor: MovementAnchor;
  /** Contrast between movements: octaves relative to the figuration base. */
  registerOffset: number;
  /** The constellation figure that becomes this section's ostinato, if any. */
  motif: Motif | null;
}

export interface MovementPlan {
  movements: Movement[];
  /** Where the setlist wraps in endless mode; Infinity for a composed session. */
  horizonSeconds: number;
}

/** A candidate structure the sky offers as a place to start a movement. */
interface Candidate {
  atSeconds: number;
  kind: MovementAnchor['kind'];
  constellation?: string;
  motif?: Motif;
  /** Higher wins when two structures compete for the same boundary. */
  weight: number;
}

/**
 * Everything the planner needs, gathered so the planner itself stays readable.
 * Passed in rather than reaching for `SessionPlan`, which does not exist yet at
 * the moment the plan is built.
 */
export interface PlannerInputs {
  config: LivingSkyConfig;
  motifs: Motif[];
  motifStars: Map<string, { ra: number; dec: number; id: string; mag: number }>;
  latitude: number;
  lst0: number;
  kappa: number;
  /** Piece time of the cathartic bloom, when there is one. */
  bloomSeconds: number | null;
  bloomStarId: string | null;
  openingStarId: string | null;
}

/**
 * When each constellation is prominent, over `[0, horizon)`.
 *
 * Mirrors `motifEventsInRange`'s definition — every motif star above the horizon
 * and the group's mean altitude past the threshold — but is written here so the
 * planner does not depend on a `SessionPlan` that is still being constructed.
 */
function prominences(inputs: PlannerInputs, horizon: number): Candidate[] {
  const { config, motifs, motifStars, latitude, lst0, kappa } = inputs;
  const period = siderealPeriodInPiece(kappa);
  const found: Candidate[] = [];

  for (const motif of motifs) {
    // The group culminates when its mean right ascension crosses the meridian.
    const degreesToGo = ((motif.meanRa - lst0) % 360 + 360) % 360;
    const first = (degreesToGo / 360) * period;

    for (let t = first; t < horizon; t += period) {
      const lst = lstAt(lst0, t, kappa);
      let total = 0;
      let allUp = true;
      for (const id of motif.starIds) {
        const star = motifStars.get(id);
        if (!star) {
          allUp = false;
          break;
        }
        const { altitude } = toHorizon(star as never, latitude, lst);
        if (altitude <= 0) {
          allUp = false;
          break;
        }
        total += altitude;
      }
      if (!allUp) continue;
      const meanAltitude = total / motif.starIds.length;
      if (meanAltitude < config.constellationAltitudeThreshold) continue;

      found.push({
        atSeconds: t,
        kind: 'constellation',
        constellation: motif.constellation,
        motif,
        // A brighter, higher constellation is a stronger place to turn a corner.
        weight: motif.totalFlux * (0.5 + meanAltitude / 180),
      });
    }
  }

  found.sort((a, b) => a.atSeconds - b.atSeconds || a.constellation!.localeCompare(b.constellation!));
  return found;
}

/** Transition length for a boundary — deterministic, inside the configured band. */
function transitionLength(config: LivingSkyConfig, index: number): number {
  const [lo, hi] = config.transitionSecondsRange;
  // A fixed rotation through the band, so consecutive seams are not identical
  // but the whole thing stays reproducible.
  const steps = 3;
  return lo + ((index * 2) % steps) * ((hi - lo) / (steps - 1));
}

/**
 * Choose which pattern a movement wears.
 *
 * Position in the arc decides, because that is what the ear follows: the opening
 * is sparse, a movement with nothing much happening goes still, the bloom builds,
 * the last movement thins back toward the one star it started with. This
 * reproduces the order of HQ's approved v3 sketch.
 */
function choosePattern(
  index: number,
  count: number,
  anchor: MovementAnchor,
  isQuiet: boolean,
  previous: PatternName | null,
): PatternName {
  if (anchor.kind === 'bloom') return 'dense-build';
  if (index === 0) return 'sparse-low';
  if (index === count - 1) return 'thinning-return';

  const wanted: PatternName = isQuiet || anchor.kind === 'still' ? 'half-time-still' : 'mid-weave';
  // Contrast between movements is the point; two adjacent sections wearing the
  // same clothes would read as one long section with a bump in the middle.
  if (wanted !== previous) return wanted;
  return wanted === 'half-time-still' ? 'mid-weave' : 'half-time-still';
}

/**
 * Partition a span into movements anchored to real structures.
 *
 * Greedy and deterministic: walk the candidates in time order and take one as a
 * boundary whenever the movement in progress has run at least
 * `movementMinSeconds`. A movement that would overrun `movementMaxSeconds`
 * without a candidate gets a boundary anyway, so no section outstays its welcome.
 */
function partition(
  inputs: PlannerInputs,
  candidates: Candidate[],
  spanSeconds: number,
): Movement[] {
  const { config } = inputs;
  const { movementMinSeconds: minLen, movementMaxSeconds: maxLen } = config;

  // Boundaries sit a little BEFORE the structure, so the movement arrives at its
  // anchor rather than opening on it.
  const leadIn = config.movementLeadInSeconds;

  const starts: Array<{ at: number; anchor: MovementAnchor; motif: Motif | null }> = [
    {
      at: 0,
      anchor: {
        kind: 'opening',
        atSeconds: 0,
        ...(inputs.openingStarId ? { starId: inputs.openingStarId } : {}),
      },
      motif: null,
    },
  ];

  // The bloom is MANDATORY and is placed first.
  //
  // Taking candidates purely in time order let a constellation claim the
  // boundary just before the climax, and the bloom then failed the minimum-length
  // test and never got a movement of its own — so the additive build had nowhere
  // to happen. The night's climax outranks every other structure, so it reserves
  // its section before anything else is allowed to.
  const bloom = inputs.bloomSeconds;
  if (bloom !== null && bloom < spanSeconds) {
    const boundary = bloom - config.bloomBuildSeconds;
    if (boundary > minLen * 0.5 && spanSeconds - boundary > minLen * 0.5) {
      starts.push({
        at: boundary,
        anchor: {
          kind: 'bloom',
          atSeconds: bloom,
          ...(inputs.bloomStarId ? { starId: inputs.bloomStarId } : {}),
        },
        motif: null,
      });
    }
  }

  for (const candidate of candidates) {
    const boundary = candidate.atSeconds - leadIn;
    if (boundary <= 0 || boundary >= spanSeconds) continue;
    if (spanSeconds - boundary < minLen * 0.6) continue;
    // Must clear every boundary already taken, in both directions — the bloom's
    // among them.
    if (starts.some((s) => Math.abs(s.at - boundary) < minLen)) continue;

    starts.push({
      at: boundary,
      anchor: {
        kind: candidate.kind,
        atSeconds: candidate.atSeconds,
        ...(candidate.constellation ? { constellation: candidate.constellation } : {}),
      },
      motif: candidate.motif ?? null,
    });
  }
  starts.sort((a, b) => a.at - b.at);

  // Split anything that has outstayed `movementMaxSeconds`. The sky offered no
  // structure there, which is itself a fact about the night — those become the
  // still movements.
  const expanded: typeof starts = [];
  for (let i = 0; i < starts.length; i++) {
    const current = starts[i] as (typeof starts)[number];
    const next = starts[i + 1]?.at ?? spanSeconds;
    expanded.push(current);
    let cursor = current.at;
    while (next - cursor > maxLen) {
      cursor += maxLen;
      if (next - cursor < minLen) break;
      expanded.push({
        at: cursor,
        anchor: { kind: 'still', atSeconds: cursor },
        motif: null,
      });
    }
  }

  // Turn starts into movements with their transition zones.
  const movements: Movement[] = [];
  for (let i = 0; i < expanded.length; i++) {
    const start = expanded[i] as (typeof expanded)[number];
    const nextStart = expanded[i + 1]?.at ?? spanSeconds;
    const isLast = i === expanded.length - 1;
    const transition = isLast ? 0 : transitionLength(config, i);
    const body = Math.max(start.at + 1, nextStart - transition);

    const anchor: MovementAnchor =
      isLast && start.anchor.kind !== 'bloom'
        ? { kind: 'return', atSeconds: start.at, ...(inputs.openingStarId ? { starId: inputs.openingStarId } : {}) }
        : start.anchor;

    movements.push({
      index: i,
      fromSeconds: start.at,
      toSeconds: body,
      transitionSeconds: transition,
      pattern: 'mid-weave', // replaced below, once the count is known
      anchor,
      registerOffset: 0,
      motif: start.motif,
    });
  }

  // Patterns and registers, now that the shape of the whole is known.
  const lengths = movements.map((m) => m.toSeconds - m.fromSeconds);
  const medianLength = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)] ?? 0;

  let previousPattern: PatternName | null = null;
  const dressed = movements.map((movement, i) => {
    const isQuiet = movement.motif === null && movement.toSeconds - movement.fromSeconds > medianLength;
    const pattern = choosePattern(i, movements.length, movement.anchor, isQuiet, previousPattern);
    previousPattern = pattern;
    return {
      ...movement,
      pattern,
      registerOffset: patternByName(pattern).registerOffset,
    };
  });

  // A seam must be long enough to RAMP within the note-rate bound.
  //
  // The configured 12-16 s band is right for an ordinary change, but the widest
  // pair in the vocabulary (half-time-still's one slot against dense-build's
  // six) cannot cross it that fast: five slots over three cycles is 0.38 notes
  // per second per cycle, past the 0.3 bound, and the test caught it. A bigger
  // change earns a longer mix — which is what a DJ would do anyway.
  const cycle = config.figurationSlots * config.figurationSlotSeconds;
  const density = (m: Movement): number =>
    patternByName(m.pattern).slots.filter(Boolean).length;

  return dressed.map((movement, i) => {
    const next = dressed[i + 1];
    if (!next || movement.transitionSeconds === 0) return movement;

    const gap = Math.abs(density(next) - density(movement));
    // Two constraints, and the seam must satisfy both:
    //   1. the note rate may not move faster than `formMaxRateStep`;
    //   2. the mask is integer-valued, so it cannot move more than ONE slot per
    //      cycle without a visible step — five slots simply cannot be crossed in
    //      four cycles, whatever the average rate says.
    // The second is usually the binding one, and missing it is what left a
    // two-slot jump at the seam into the bloom.
    const neededCycles = Math.max(
      Math.ceil(gap / Math.max(1e-9, config.formMaxRateStep * cycle)),
      gap,
    );
    const needed = neededCycles * cycle;
    const transition = Math.max(movement.transitionSeconds, needed);

    // The seam grows into the body, never past the movement's own start.
    const body = Math.max(movement.fromSeconds + cycle, next.fromSeconds - transition);
    return { ...movement, transitionSeconds: next.fromSeconds - body, toSeconds: body };
  });
}

/**
 * Build the movement plan for a session.
 *
 * Birth-sky partitions the composed span. Endless partitions a long horizon of
 * structure crossings and wraps — a continuous setlist, keyed to the sky turning.
 */
export function planMovements(inputs: PlannerInputs): MovementPlan {
  const { config } = inputs;

  if (config.mode === 'birth-sky') {
    const span = config.sessionSeconds;
    return {
      movements: partition(inputs, prominences(inputs, span), span),
      horizonSeconds: Number.POSITIVE_INFINITY,
    };
  }

  // Endless: a setlist across the sky's own period, then it comes round again —
  // which is honest, because the sky does too.
  const horizon = siderealPeriodInPiece(inputs.kappa);
  return {
    movements: partition(inputs, prominences(inputs, horizon), horizon),
    horizonSeconds: horizon,
  };
}

/** Where a moment sits in the form. */
export interface FormPosition {
  movement: Movement;
  /** The movement being crossed into, during a transition. */
  next: Movement | null;
  /** 0..1 through the transition zone; null when inside a movement body. */
  transitionProgress: number | null;
  /** 0..1 through the movement body. */
  bodyProgress: number;
  /** Piece time mapped into the plan's horizon (identity unless endless wraps). */
  localSeconds: number;
}

/** Which movement owns a moment, and whether it is mid-transition. */
export function formAt(plan: MovementPlan, atSeconds: number): FormPosition | null {
  const { movements, horizonSeconds } = plan;
  if (movements.length === 0) return null;

  const local = Number.isFinite(horizonSeconds)
    ? ((atSeconds % horizonSeconds) + horizonSeconds) % horizonSeconds
    : Math.max(0, atSeconds);

  let index = 0;
  for (let i = 0; i < movements.length; i++) {
    if ((movements[i] as Movement).fromSeconds <= local) index = i;
    else break;
  }

  const movement = movements[index] as Movement;
  const next = (movements[index + 1] as Movement | undefined) ?? null;

  if (movement.transitionSeconds > 0 && local >= movement.toSeconds && next) {
    const progress = clamp((local - movement.toSeconds) / movement.transitionSeconds, 0, 1);
    return {
      movement,
      next,
      transitionProgress: progress,
      bodyProgress: 1,
      localSeconds: local,
    };
  }

  const bodyLength = Math.max(1e-9, movement.toSeconds - movement.fromSeconds);
  return {
    movement,
    next,
    transitionProgress: null,
    bodyProgress: clamp((local - movement.fromSeconds) / bodyLength, 0, 1),
    localSeconds: local,
  };
}
