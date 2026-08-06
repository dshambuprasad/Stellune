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
import { formAt, patternByName, type FormPosition, type Movement } from './movement.ts';
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
  /** Set when this note is part of the movement's ostinato statement. */
  motifId?: string;
  /** Which Zimmer layer produced it: 0 = the weave itself. */
  layer: number;
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
function registerWindow(
  plan: SessionPlan,
  atSeconds: number,
  registerOffset = 0,
): { low: number; high: number } {
  const energy = energyAt(plan, atSeconds);
  const { figurationRegisterLowOctave: lo, figurationRegisterHighOctave: hi } = plan.config;
  // The movement's own register is what makes two sections sound like different
  // places rather than the same place with different notes.
  const centre = plan.rootMidi + 12 * (lo + (hi - lo) * energy + registerOffset);
  const span = 12 * (1 + energy);
  return { low: centre - span, high: centre + span };
}

/**
 * The pattern at cycle `n` — every slot's assignment.
 *
 * Pure: no cycle before `n` is consulted except by arithmetic, and the tones a
 * slot could have chosen are read at that slot's own change cycle.
 */
/**
 * Which slots sound in a cycle — the movement's groove, or a crossfade.
 *
 * Inside a movement body the mask is simply the movement's pattern, unchanged
 * cycle after cycle. That repetition is the whole point of Slice A4: a rhythm
 * has to recur before the ear can learn it. A3's per-cycle activation drift is
 * deliberately gone — what still breathes within a movement is the *tone*
 * assignment (≤1 slot per cycle) and the velocity, not the rhythm.
 *
 * In a transition zone the mask crossfades. The active count is interpolated
 * directly, so the note rate ramps monotonically from the outgoing pattern's
 * density to the incoming one's; the incoming pattern's own slots are taken
 * first, so the new groove is what emerges rather than a blur.
 */
function maskFor(plan: SessionPlan, form: FormPosition, cycleIndex: number): boolean[] {
  const slots = plan.config.figurationSlots;
  const readMask = (movement: Movement): boolean[] => {
    const template = patternByName(movement.pattern).slots;
    return Array.from({ length: slots }, (_, i) => template[i % template.length] === true);
  };

  const outgoing = readMask(form.movement);
  if (form.transitionProgress === null || !form.next) return outgoing;

  const incoming = readMask(form.next);
  const outCount = outgoing.filter(Boolean).length;
  const inCount = incoming.filter(Boolean).length;

  const p = form.transitionProgress;
  const total = Math.round(outCount + (inCount - outCount) * p);
  const fromIncoming = Math.min(total, Math.round(inCount * p));

  const mask = new Array<boolean>(slots).fill(false);
  let placed = 0;

  // The arriving groove asserts itself first…
  for (let i = 0; i < slots && placed < fromIncoming; i++) {
    if (incoming[i]) {
      mask[i] = true;
      placed++;
    }
  }
  // …and the departing one holds the rest until it is gone.
  for (let i = 0; i < slots && placed < total; i++) {
    if (outgoing[i] && !mask[i]) {
      mask[i] = true;
      placed++;
    }
  }
  // The two patterns often share slots (every pattern here sounds slot 0), so
  // the two passes above can fall short of `total` — which made the ramp stall
  // and then jump two slots at once. Top up from whatever is left, incoming
  // first, so the count is exactly the interpolated one and the ramp is smooth.
  for (let i = 0; i < slots && placed < total; i++) {
    if (!mask[i] && incoming[i]) {
      mask[i] = true;
      placed++;
    }
  }
  for (let i = 0; i < slots && placed < total; i++) {
    if (!mask[i]) {
      mask[i] = true;
      placed++;
    }
  }

  void cycleIndex;
  return mask;
}

export function patternAt(plan: SessionPlan, cycleIndex: number): FigurationSlot[] {
  const slots = plan.config.figurationSlots;
  const seed = plan.config.seed ?? 1;
  const at = cycleStartSeconds(plan, cycleIndex);
  const form = formAt(plan.movementPlan, at);

  const mask = form
    ? maskFor(plan, form, cycleIndex)
    : Array.from({ length: slots }, (_, i) => activationOrder(plan).indexOf(i) < activeCountAt(plan, cycleIndex));
  const registerOffset = form ? form.movement.registerOffset : 0;

  const pattern: FigurationSlot[] = [];
  for (let slot = 0; slot < slots; slot++) {
    const changed = lastChangeCycle(plan, slot, cycleIndex);
    const changedAt = Math.max(0, cycleStartSeconds(plan, changed));

    const register = registerWindow(plan, changedAt, registerOffset);
    const all = soundingChordTonesCached(plan, changedAt);
    const eligible = all.filter((t) => t.midi >= register.low && t.midi <= register.high);
    const pool = eligible.length > 0 ? eligible : all;

    let toneStarId: string | null = null;
    if (pool.length > 0) {
      const pick = Math.floor(unit(seed, slot, changed, 3) * pool.length);
      toneStarId = (pool[Math.min(pick, pool.length - 1)] as SoundingTone).starId;
    }

    pattern.push({ slot, toneStarId, active: mask[slot] === true });
  }
  return pattern;
}

/**
 * How many Zimmer layers the bloom movement has stacked by this cycle.
 *
 * One layer is added every `bloomLayerEveryCycles` on the way up and removed in
 * reverse on the way down, so the build is audibly additive and the release
 * audibly strips. Deterministic: a function of the cycle's distance from the
 * climax, nothing accumulated.
 */
export function bloomLayersAt(plan: SessionPlan, cycleIndex: number): number {
  const form = formAt(plan.movementPlan, cycleStartSeconds(plan, cycleIndex));
  if (!form || form.movement.anchor.kind !== 'bloom') return 0;

  const { bloomLayerEveryCycles: every, bloomMaxLayers: maxLayers } = plan.config;
  const startCycle = Math.ceil(form.movement.fromSeconds / cycleSeconds(plan));
  const climaxCycle = Math.round(form.movement.anchor.atSeconds / cycleSeconds(plan));

  if (cycleIndex <= climaxCycle) {
    return clamp(Math.floor((cycleIndex - startCycle) / every), 0, maxLayers);
  }
  const peak = clamp(Math.floor((climaxCycle - startCycle) / every), 0, maxLayers);
  return clamp(peak - Math.floor((cycleIndex - climaxCycle) / every), 0, maxLayers);
}

/**
 * True on the cycles where the movement restates its constellation figure.
 *
 * The motif is the section's groove, not a one-shot chime: during a
 * constellation's movement it comes back every `ostinatoEveryCycles`, so the ear
 * learns it as the identity of that stretch of night.
 */
function ostinatoCycle(plan: SessionPlan, form: FormPosition, cycleIndex: number): boolean {
  if (!form.movement.motif) return false;
  if (form.transitionProgress !== null) return false;
  const startCycle = Math.ceil(form.movement.fromSeconds / cycleSeconds(plan));
  const since = cycleIndex - startCycle;
  return since >= 0 && since % Math.max(1, plan.config.ostinatoEveryCycles) === 0;
}

/**
 * Map a motif's contour degree onto the nearest chord tone actually sounding.
 *
 * This is how the ostinato keeps BOTH its identity and its truth: the shape is
 * the constellation's real geometry, and every pitch it lands on is a tone that
 * is genuinely in the air. The contour is preserved in direction and rough size;
 * it is not transposed onto pitches the sky is not playing.
 */
function nearestTone(tones: SoundingTone[], targetMidi: number): SoundingTone | null {
  let best: SoundingTone | null = null;
  let bestDistance = Infinity;
  for (const tone of tones) {
    const distance = Math.abs(tone.midi - targetMidi);
    if (distance < bestDistance - 1e-9) {
      bestDistance = distance;
      best = tone;
    }
  }
  return best;
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
    const form = formAt(plan.movementPlan, cycleStart);
    const movementVelocity = form ? patternByName(form.movement.pattern).velocityScale : 1;
    const layers = bloomLayersAt(plan, n);
    const isOstinato = form ? ostinatoCycle(plan, form, n) : false;

    // A breath before a stage change: velocity dips and the register leans into
    // the next stage a cycle early. One parameter at a time, never a jump.
    const stageNow: ArcStage = arcAt(plan, cycleStart).stage;
    const stageNext: ArcStage = arcAt(plan, cycleStart + cycleSeconds(plan)).stage;
    const anticipating = stageNow !== stageNext;

    // A transition seam gets a breath swell, so the join is felt as a gesture
    // rather than heard as a splice.
    const seamSwell =
      form && form.transitionProgress !== null
        ? 1 + 0.18 * Math.sin(Math.PI * form.transitionProgress)
        : 1;

    const motif = isOstinato ? form?.movement.motif ?? null : null;

    for (const entry of pattern) {
      if (!entry.active || entry.toneStarId === null) continue;

      const nominal = cycleStart + entry.slot * slotSeconds;
      const drift = (unit(seed, n, entry.slot, 7) - 0.5) * 2 * humanize;
      const startSeconds = nominal + drift;
      if (startSeconds >= sessionEnd) continue;

      const sounding = soundingChordTonesCached(plan, startSeconds);

      // On an ostinato cycle the movement restates its constellation's figure:
      // the contour is the real geometry, and each degree lands on the nearest
      // tone genuinely in the air, so identity and truth hold together.
      let tone: SoundingTone | undefined;
      let motifId: string | undefined;
      if (motif && motif.degrees.length > 0) {
        const step = motif.degrees[entry.slot % motif.degrees.length] as number;
        const anchorTone = sounding.find((t) => t.starId === entry.toneStarId) ?? sounding[0];
        if (anchorTone) {
          tone = nearestTone(sounding, anchorTone.midi + step * 2) ?? anchorTone;
          motifId = motif.constellation;
        }
      } else {
        tone = sounding.find((t) => t.starId === entry.toneStarId);
      }
      if (!tone) continue;

      const energy = energyAt(plan, startSeconds);
      const accent = entry.slot === 0 ? 1.12 : 1;
      const breath = anticipating ? 0.85 : 1;
      const velocity =
        (0.45 + 0.55 * energy) * accent * breath * movementVelocity * seamSwell;

      const here = toHorizon(
        tone.star,
        plan.observer.latitude,
        lstAt(plan.lst0, startSeconds, plan.kappa),
      );

      const onset = round(startSeconds, 4);
      const room = Number.isFinite(sessionEnd) ? sessionEnd - onset : noteSeconds;
      const duration = Math.floor(Math.min(noteSeconds, room) * 1000) / 1000;
      if (duration <= 0) continue;

      const base = {
        starId: tone.starId,
        pan: round(azimuthToPan(here.azimuth) * 0.6, 4),
        twinkle: 0,
        slot: entry.slot,
        cycleIndex: n,
        ...(motifId ? { motifId } : {}),
      };
      const gain = clamp(tone.amplitude * velocity * figurationGain, 0, 1);

      // Each layer is filtered by its OWN onset, never by the base note's. The
      // off-beat echo sits half a slot later and can fall the far side of a
      // window edge; gating it on the base note lost it from both windows —
      // exactly the partition-invariance bug the phrase grammar hit in A1b.
      const emit = (note: FigurationNote): void => {
        if (note.startSeconds < from || note.startSeconds >= to) return;
        notes.push(note);
      };

      emit({
        ...base,
        midi: tone.midi,
        startSeconds: onset,
        durationSeconds: duration,
        amplitude: round(gain, 4),
        layer: 0,
      });

      // ---- the Zimmer additive stack, only inside the bloom movement
      // Octave doubling, then an off-beat echo, then a high sparkle: one more
      // every couple of cycles into the climax, and the same three removed in
      // reverse on the way out.
      if (layers >= 1) {
        emit({
          ...base,
          midi: clamp(tone.midi + 12, 0, 127),
          startSeconds: onset,
          durationSeconds: duration,
          amplitude: round(gain * 0.5, 4),
          layer: 1,
        });
      }
      if (layers >= 2) {
        const echoAt = round(startSeconds + slotSeconds * 0.5, 4);
        const echoRoom = Number.isFinite(sessionEnd) ? sessionEnd - echoAt : noteSeconds;
        const echoDuration = Math.floor(Math.min(noteSeconds * 0.6, echoRoom) * 1000) / 1000;
        if (echoDuration > 0) {
          emit({
            ...base,
            midi: tone.midi,
            startSeconds: echoAt,
            durationSeconds: echoDuration,
            amplitude: round(gain * 0.34, 4),
            layer: 2,
          });
        }
      }
      if (layers >= 3 && entry.slot === 0) {
        emit({
          ...base,
          midi: clamp(tone.midi + 24, 0, 127),
          startSeconds: onset,
          durationSeconds: duration,
          amplitude: round(gain * 0.22, 4),
          layer: 3,
        });
      }
    }
  }

  notes.sort(
    (a, b) =>
      a.startSeconds - b.startSeconds ||
      a.slot - b.slot ||
      a.layer - b.layer ||
      a.midi - b.midi ||
      (a.starId < b.starId ? -1 : a.starId > b.starId ? 1 : 0),
  );
  return notes;
}

/** Timbre for a figuration note — reuses the star's own colour. */
export { colourToTimbre, magnitudeToAmplitude };

/**
 * The FORM's note rate at a moment — active slots per second.
 *
 * Counts active slots rather than notes actually emitted. A slot momentarily
 * without a tone (its star has set, and it is waiting for its own change cycle
 * to take a new one) is a fact about the sky, not a step in the form, and
 * folding it in here would make the transition ramp look jagged when the ramp
 * itself is smooth.
 */
export function noteRateAt(plan: SessionPlan, atSeconds: number): number {
  const n = cycleIndexAt(plan, atSeconds);
  return patternAt(plan, n).filter((slot) => slot.active).length / cycleSeconds(plan);
}
