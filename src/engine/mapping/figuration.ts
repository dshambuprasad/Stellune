/**
 * Living Sky — the FIGURATION layer (Slice A3).
 *
 * The meso timescale. The ear gate failed on exactly this gap: we had a macro
 * arc (eleven minutes of real night) and we will have micro detail (Slice B's
 * instruments), but the 0.5–3 second layer where perception binds notes into
 * melody was empty. One phrase every thirty seconds over sustained voices reads
 * as isolated events over a hum, not as music. Every reference in the Musical
 * Vision — Zimmer's ostinato, the handpan cycles, the Cigarettes After Sex
 * arpeggios, Sigur Rós's bowed motion — has continuous motion here.
 *
 * So: a gentle, continuous weave through the CURRENT TRUE CHORD, at ear speed.
 *
 * ---
 *
 * WHY IT IS CALLED FIGURATION AND NOT PULSE
 *
 * The dormant role was named `pulse`, and the name was part of the problem: a
 * pulse is a beat, and the Cosmic Drift lesson (that percussion flattens the
 * emotion) got over-read into "no meso layer at all". What the handpan reference
 * actually proves is that *figuration* — a soft cyclic weave — hypnotises where
 * a beat demands. The role is renamed to say what it is.
 *
 * ---
 *
 * TRUTH: the figuration invents no pitches. It may only sound a tone that is
 * already in the air, taken from `soundingChordTones`, which is the same
 * computation the CHORD events use. On-scale and true by construction, not by a
 * check. Its *timing* is artistic, and the covenant already declares that.
 *
 * ---
 *
 * THE HARD PART: EVOLUTION THAT IS ALSO A PURE FUNCTION OF TIME
 *
 * The pattern must evolve — at most one slot different from one cycle to the
 * next — and it must still be reconstructible from absolute time alone, or
 * partition invariance dies and the stream can restart audibly.
 *
 * Iterating a mutable pattern forward would need unbounded history. Instead each
 * slot carries its own deterministic **change epoch**:
 *
 *   - the cycle has `slots` positions; a fixed seeded permutation `changeOrder`
 *     says which slot is allowed to change at which cycle-residue;
 *   - at cycle `n`, the slot allowed to change is `changeOrder[n mod slots]` —
 *     so **exactly one slot changes per cycle, by construction**;
 *   - a slot's assignment at cycle `n` is a pure function of the cycle at which
 *     it last changed, `lastChangeCycle(s, n)`, which is arithmetic;
 *   - density steps only at cycles where `n mod slots === 0`, and on those
 *     cycles the tone re-pick is skipped — so the ≤1 rule holds even when the
 *     pattern is thinning or filling.
 *
 * Nothing accumulates. Cycle 900 costs exactly what cycle 3 costs, and asking
 * for it in a different window gives the identical answer.
 */

import { toHorizon } from './astro.ts';
import { magnitudeToAmplitude, azimuthToPan, colourToTimbre } from './sonify.ts';
import { lstAt } from './skyTime.ts';
import { arcAt, type SessionPlan } from './session.ts';
import { soundingChordTonesCached, type SoundingTone } from './chordVoices.ts';
import type { ArcStage } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const unsign = (v: number): number => (Object.is(v, -0) ? 0 : v);
const round = (v: number, p: number): number => {
  const f = 10 ** p;
  return unsign(Math.round(v * f) / f);
};

// ----------------------------------------------------------- seeded noise

/** A deterministic 32-bit hash. No `Math.random` anywhere in this layer. */
function hash32(seed: number, a: number, b: number, c: number): number {
  let h = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  for (const value of [a, b, c]) {
    h = (h ^ Math.imul(Math.trunc(value) + 0x9e3779b9, 0x85ebca6b)) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
  }
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/** The same hash, mapped to 0..1. */
const unit = (seed: number, a: number, b: number, c: number): number =>
  hash32(seed, a, b, c) / 4294967296;

/** A deterministic permutation of 0..n−1, from the seed. */
function permutation(n: number, seed: number, salt: number): number[] {
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(unit(seed, salt, i, 0) * (i + 1));
    const swap = order[i] as number;
    order[i] = order[j] as number;
    order[j] = swap;
  }
  return order;
}

// --------------------------------------------------------------- shapes

/** One position in the repeating cycle. */
export interface FigurationSlot {
  slot: number;
  /** Which star this slot is currently weaving; null when it has none. */
  toneStarId: string | null;
  /** Whether density currently lets this slot sound at all. */
  active: boolean;
}

/** One figuration note, ready to become a `MusicalEvent`. */
export interface FigurationNote {
  starId: string;
  midi: number;
  startSeconds: number;
  durationSeconds: number;
  amplitude: number;
  pan: number;
  twinkle: number;
  slot: number;
  cycleIndex: number;
}

// ------------------------------------------------------------ the cycle

export function cycleSeconds(plan: SessionPlan): number {
  return plan.config.figurationSlots * plan.config.figurationSlotSeconds;
}

export function cycleIndexAt(plan: SessionPlan, atSeconds: number): number {
  return Math.floor(Math.max(0, atSeconds) / cycleSeconds(plan));
}

export function cycleStartSeconds(plan: SessionPlan, cycleIndex: number): number {
  return cycleIndex * cycleSeconds(plan);
}

/** Which slot is permitted to change at each cycle-residue. */
function changeOrder(plan: SessionPlan): number[] {
  return permutation(plan.config.figurationSlots, plan.config.seed ?? 1, 11);
}

/** Priority order in which slots switch on as density rises. */
function activationOrder(plan: SessionPlan): number[] {
  return permutation(plan.config.figurationSlots, plan.config.seed ?? 1, 29);
}

/**
 * How much energy the piece has right now — the single continuous quantity that
 * density, register and velocity all ride.
 */
function energyAt(plan: SessionPlan, atSeconds: number): number {
  const arc = arcAt(plan, atSeconds);
  return clamp(0.65 * arc.intensity + 0.35 * plan.weather.density, 0, 1);
}

/**
 * How many slots the energy currently *wants* sounding.
 *
 * This is a target, not the pattern. A slot only adopts it at its own change
 * cycle (see `patternAt`), so density is absorbed gradually — one slot per cycle
 * — however fast this moves. That is what lets the target ride the arc
 * continuously without the pattern ever lurching.
 */
export function activeCountAt(plan: SessionPlan, cycleIndex: number): number {
  const { figurationSlots: slots, figurationMinActive, figurationMaxActive } = plan.config;
  const energy = energyAt(plan, cycleStartSeconds(plan, Math.max(0, cycleIndex)));
  const target = figurationMinActive + (figurationMaxActive - figurationMinActive) * energy;
  return clamp(Math.round(target), 0, slots);
}

/**
 * The cycle at which slot `s` last changed — the heart of the design.
 *
 * Slot `s` may change only on cycles whose residue equals its position in
 * `changeOrder`. Since that mapping is a bijection, **exactly one slot changes
 * per cycle**, and this returns the most recent such cycle at or before `n`.
 *
 * Everything about a slot — its tone AND whether it sounds at all — is read at
 * this cycle. That is why the ≤1-slot rule holds absolutely: all other slots
 * resolve to the same change cycle they had at `n − 1`, so they cannot differ.
 */
function lastChangeCycle(plan: SessionPlan, slot: number, cycleIndex: number): number {
  const slots = plan.config.figurationSlots;
  const residue = changeOrder(plan).indexOf(slot);
  let candidate = residue + Math.floor((cycleIndex - residue) / slots) * slots;
  if (candidate > cycleIndex) candidate -= slots;
  return candidate;
}

/** The register window the figuration draws from, in MIDI. */
function registerWindow(plan: SessionPlan, atSeconds: number): { low: number; high: number } {
  const energy = energyAt(plan, atSeconds);
  const { figurationRegisterLowOctave: lo, figurationRegisterHighOctave: hi } = plan.config;
  const centre = plan.rootMidi + 12 * (lo + (hi - lo) * energy);
  const span = 12 * (1 + energy);
  return { low: centre - span, high: centre + span };
}

/**
 * The pattern at cycle `n` — every slot's assignment.
 *
 * Pure: no cycle before `n` is consulted except by arithmetic, and the tones a
 * slot could have chosen are read at that slot's own change cycle.
 */
export function patternAt(plan: SessionPlan, cycleIndex: number): FigurationSlot[] {
  const slots = plan.config.figurationSlots;
  const priority = activationOrder(plan);
  const seed = plan.config.seed ?? 1;

  const pattern: FigurationSlot[] = [];
  for (let slot = 0; slot < slots; slot++) {
    const changed = lastChangeCycle(plan, slot, cycleIndex);
    const at = Math.max(0, cycleStartSeconds(plan, changed));

    const register = registerWindow(plan, at);
    const all = soundingChordTonesCached(plan, at);
    const eligible = all.filter((t) => t.midi >= register.low && t.midi <= register.high);
    const pool = eligible.length > 0 ? eligible : all;

    let toneStarId: string | null = null;
    if (pool.length > 0) {
      const pick = Math.floor(unit(seed, slot, changed, 3) * pool.length);
      toneStarId = (pool[Math.min(pick, pool.length - 1)] as SoundingTone).starId;
    }

    pattern.push({
      slot,
      toneStarId,
      // Density is adopted at the slot's own change cycle, not globally, so a
      // moving target is absorbed one slot at a time.
      active: priority.indexOf(slot) < activeCountAt(plan, changed),
    });
  }
  return pattern;
}

/**
 * The notes the figuration plays with onsets in `[from, to)`.
 *
 * A slot sounds only when its assigned star is *still* in the air; when a star
 * sets, its slots fall silent at once — the pitch would no longer be true — and
 * they pick up a new tone at their own next change cycle, which is the gradual
 * migration the craft note asks for.
 */
export function figurationNotesInRange(
  plan: SessionPlan,
  from: number,
  to: number,
): FigurationNote[] {
  if (!(to > from)) return [];
  const {
    figurationSlotSeconds: slotSeconds,
    figurationHumanizeSeconds: humanize,
    figurationNoteSeconds: noteSeconds,
    figurationGain,
    seed = 1,
  } = plan.config;

  const sessionEnd = plan.config.mode === 'birth-sky' ? plan.config.sessionSeconds : Infinity;
  const notes: FigurationNote[] = [];

  // One cycle of slack either side: a humanised onset can drift across a border.
  const firstCycle = Math.max(0, cycleIndexAt(plan, from) - 1);
  const lastCycle = cycleIndexAt(plan, Math.max(from, to - 1e-9)) + 1;

  for (let n = firstCycle; n <= lastCycle; n++) {
    const cycleStart = cycleStartSeconds(plan, n);
    if (cycleStart >= sessionEnd) break;

    const pattern = patternAt(plan, n);

    // A breath before a stage change: velocity dips and the register leans into
    // the next stage a cycle early. One parameter at a time, never a jump.
    const stageNow: ArcStage = arcAt(plan, cycleStart).stage;
    const stageNext: ArcStage = arcAt(plan, cycleStart + cycleSeconds(plan)).stage;
    const anticipating = stageNow !== stageNext;

    for (const entry of pattern) {
      if (!entry.active || entry.toneStarId === null) continue;

      const nominal = cycleStart + entry.slot * slotSeconds;
      const drift = (unit(seed, n, entry.slot, 7) - 0.5) * 2 * humanize;
      const startSeconds = nominal + drift;
      if (startSeconds < from || startSeconds >= to) continue;
      if (startSeconds >= sessionEnd) continue;

      // The tone must still be in the air, or the slot rests.
      const tone = soundingChordTonesCached(plan, startSeconds).find(
        (t) => t.starId === entry.toneStarId,
      );
      if (!tone) continue;

      const energy = energyAt(plan, startSeconds);
      const accent = entry.slot === 0 ? 1.12 : 1;
      const breath = anticipating ? 0.85 : 1;
      const velocity = (0.45 + 0.55 * energy) * accent * breath;

      const here = toHorizon(
        tone.star,
        plan.observer.latitude,
        lstAt(plan.lst0, startSeconds, plan.kappa),
      );

      // Round the onset first, then derive the length from it and round DOWN,
      // so a note can never be rounded past the end of the session.
      const onset = round(startSeconds, 4);
      const room = Number.isFinite(sessionEnd) ? sessionEnd - onset : noteSeconds;
      const duration = Math.floor(Math.min(noteSeconds, room) * 1000) / 1000;
      if (duration <= 0) continue;

      notes.push({
        starId: tone.starId,
        midi: tone.midi,
        startSeconds: onset,
        durationSeconds: duration,
        amplitude: round(clamp(tone.amplitude * velocity * figurationGain, 0, 1), 4),
        pan: round(azimuthToPan(here.azimuth) * 0.6, 4),
        twinkle: 0,
        slot: entry.slot,
        cycleIndex: n,
      });
    }
  }

  notes.sort(
    (a, b) =>
      a.startSeconds - b.startSeconds ||
      a.slot - b.slot ||
      (a.starId < b.starId ? -1 : a.starId > b.starId ? 1 : 0),
  );
  return notes;
}

/** Timbre for a figuration note — reuses the star's own colour. */
export { colourToTimbre, magnitudeToAmplitude };

/**
 * How many notes per second the figuration is actually playing around
 * `atSeconds` — counted from the realised pattern, not from the target.
 */
export function noteRateAt(plan: SessionPlan, atSeconds: number): number {
  const n = cycleIndexAt(plan, atSeconds);
  const sounding = patternAt(plan, n).filter((s) => s.active && s.toneStarId !== null).length;
  return sounding / cycleSeconds(plan);
}
