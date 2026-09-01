/**
 * Living Sky — THE ARRIVAL (Slice B2, "First Impressions").
 *
 * Endless mode had no beginning. It had a *start* — the moment you pressed
 * Play — but the music at t = 0 was already the music at t = 40 minutes:
 * `arcAt`'s endless branch reads the fraction of the bright sky above the
 * horizon, and that fraction moves on the sidereal period, which is to say
 * imperceptibly across a first listen. Measured on Shambu's own sky the
 * intensity went 0.540 at t = 0 to 0.526 at t = 150 s. Fourteen thousandths.
 *
 * That is the mechanical fact behind the HQ review gate's verdict of
 * 2026-09-01 — "monotonous with that one note running throughout… it doesn't
 * feel like a journey". Tonight × Ground was the app's default face, and
 * Tonight is the mode with no composed arc at all. The figuration was already
 * weaving at 2.2 s and the lead already speaking at 11.6 s, at full steady-state
 * density, over a drone that had not had a chance to be a drone yet.
 *
 * ---
 *
 * WHAT THIS MODULE IS, AND WHAT IT IS CAREFUL NOT TO BE
 *
 * It is a **composed opening envelope** for the first ~105 seconds of an endless
 * session, blended into the sky-richness envelope so that by the end of it the
 * behaviour is *exactly* what it was before — same function, same numbers, no
 * residue. Three phases:
 *
 *   1. THE GESTURE      `[0, gestureSeconds)` — ground and chord alone. The
 *                       figuration and the lead are held out. The drone gets to
 *                       be a drone, and the chord gathers under it.
 *   2. THE ENTRY        `[gestureSeconds, figurationInSeconds)` — the first
 *                       movement's figuration arrives over a lead-in rather than
 *                       switching on. The lead follows once the weave is
 *                       established.
 *   3. THE HANDOVER     `[figurationInSeconds, seconds)` — the composed envelope
 *                       crossfades into the sky's own richness. At `seconds` the
 *                       weight is exactly 1 and the arrival is over.
 *
 * IT CHANGES **WHEN** LAYERS ENTER, NEVER **WHAT** THEY PLAY. Every pitch is
 * still chosen by the sky: the chord is the real stars above the horizon, the
 * figuration still doubles a tone genuinely in the air, the lead still speaks
 * the real rise/culmination/set. What the arrival moves is the moment a layer is
 * allowed to be heard, and how loud it is on the way in. The sky still conducts.
 *
 * PURITY, AND WHY PARTITION INVARIANCE SURVIVES. Every function here is a pure
 * function of ABSOLUTE piece time. Nothing accumulates, nothing is keyed to a
 * window boundary, and the gate a note is filtered by is computed from that
 * note's own onset. So the arrival is invisible to how the stream is sliced —
 * which is what `test/livingSky.test.ts`'s new gate asserts across the arrival
 * boundary specifically, not merely somewhere in the neighbourhood of it.
 *
 * BIRTH-SKY IS UNTOUCHED. `arrivalPlanFor` returns the null arrival for any mode
 * but `endless`, and every consumer short-circuits on `seconds === 0`. Birth Sky
 * already has a composed arc — the opening gesture, the gathering, the bloom —
 * and Slice A4 spent itself shaping it.
 */

import type { LivingSkyConfig } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Hermite ease on [0,1] — zero slope at both ends, so no joint is audible. */
function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * The composed opening, as a value.
 *
 * All times are PIECE seconds from the moment the session begins — the seconds
 * the listener actually experiences, not sky seconds. `kappa` does not enter:
 * an arrival is a thing that happens to a person in a room.
 */
export interface ArrivalPlan {
  /** Total length of the arrival. 0 means there is none (birth-sky, or off). */
  seconds: number;
  /** Ground and chord alone before this. */
  gestureSeconds: number;
  /** The figuration is at full weight from here. */
  figurationInSeconds: number;
  /** The lead may not speak before this. */
  leadInSeconds: number;
  /** Composed intensity at t = 0, and at the end of the gesture. */
  fromIntensity: number;
  gestureIntensity: number;
  /** Composed intensity once the weave is established — where the blend starts. */
  entryIntensity: number;
}

/** The null arrival: every consumer treats this as "behave exactly as before". */
export const NO_ARRIVAL: ArrivalPlan = {
  seconds: 0,
  gestureSeconds: 0,
  figurationInSeconds: 0,
  leadInSeconds: 0,
  fromIntensity: 0,
  gestureIntensity: 0,
  entryIntensity: 0,
};

/**
 * Read the arrival out of a config.
 *
 * Clamped into a consistent order rather than trusted: a config with the lead
 * entering before the figuration would still be a valid *config*, and would
 * still have to produce a sane arrival, because the alternative is a crash in
 * front of someone listening to a sky.
 */
export function arrivalPlanFor(config: LivingSkyConfig): ArrivalPlan {
  if (config.mode !== 'endless') return NO_ARRIVAL;
  const seconds = Math.max(0, config.arrivalSeconds);
  if (seconds === 0) return NO_ARRIVAL;

  const gesture = clamp(config.arrivalGestureSeconds, 0, seconds);
  const figurationIn = clamp(gesture + Math.max(0, config.arrivalEntrySeconds), gesture, seconds);
  const leadIn = clamp(config.arrivalLeadInSeconds, gesture, seconds);

  return {
    seconds,
    gestureSeconds: gesture,
    figurationInSeconds: figurationIn,
    leadInSeconds: leadIn,
    fromIntensity: 0.08,
    gestureIntensity: 0.22,
    entryIntensity: 0.46,
  };
}

/**
 * The composed envelope, blended into the sky's own.
 *
 * `skyIntensity` is what `arcAt` would have returned on its own — the fraction
 * of the bright sky that is up, which is the truthful quantity and remains the
 * only quantity once the arrival is over.
 *
 * The three segments join with matching values, and the blend weight is a
 * smoothstep that is exactly 0 where it starts and exactly 1 where it ends, so
 * the arrival's last moment and the first moment after it are the same number.
 * That continuity is the whole reason this is a blend and not a switch: a step
 * in intensity is a step in the ground's amplitude envelope, and a step in a
 * drone is a click.
 */
export function arrivalIntensity(
  arrival: ArrivalPlan,
  pieceSeconds: number,
  skyIntensity: number,
): number {
  const t = pieceSeconds;
  if (arrival.seconds === 0 || t >= arrival.seconds || t < 0) return skyIntensity;

  const { gestureSeconds: gesture, figurationInSeconds: figIn } = arrival;

  // Phase 1 — the gesture. Ground and chord alone, swelling.
  if (t < gesture) {
    const p = smoothstep(gesture > 0 ? t / gesture : 1);
    return arrival.fromIntensity + (arrival.gestureIntensity - arrival.fromIntensity) * p;
  }

  // Phase 2 — the entry. The composed envelope opens up as the weave arrives.
  if (t < figIn) {
    const p = smoothstep(figIn > gesture ? (t - gesture) / (figIn - gesture) : 1);
    return arrival.gestureIntensity + (arrival.entryIntensity - arrival.gestureIntensity) * p;
  }

  // Phase 3 — the handover. The sky takes the envelope back.
  const span = arrival.seconds - figIn;
  const w = smoothstep(span > 0 ? (t - figIn) / span : 1);
  return arrival.entryIntensity * (1 - w) + skyIntensity * w;
}

/**
 * How much of the figuration is allowed to be heard at `pieceSeconds`.
 *
 * 0 through the opening gesture, a smoothstep across the lead-in, 1 after. A
 * note whose gate is 0 is not emitted at all — silence, not a note at zero
 * amplitude, because a scheduled voice with a zero envelope still costs a
 * polyphony slot and still shows up in a stem measurement.
 */
export function figurationGateAt(arrival: ArrivalPlan, pieceSeconds: number): number {
  if (arrival.seconds === 0) return 1;
  const t = pieceSeconds;
  if (t >= arrival.figurationInSeconds) return 1;
  if (t < arrival.gestureSeconds) return 0;
  const span = arrival.figurationInSeconds - arrival.gestureSeconds;
  return smoothstep(span > 0 ? (t - arrival.gestureSeconds) / span : 1);
}

/**
 * Whether the LEAD may speak at `pieceSeconds`.
 *
 * The lead is the sky's voice and it enters last, once there is something for
 * it to speak over. Measured on the pre-B2 endless session its first phrase
 * landed at 11.6 s — inside any honest reading of "ground and chord alone".
 *
 * A hard gate rather than a fade, because a lead note is a gesture with an
 * attack: half a chime is a mistake, not an entrance.
 */
export function leadMaySpeakAt(arrival: ArrivalPlan, pieceSeconds: number): boolean {
  return arrival.seconds === 0 || pieceSeconds >= arrival.leadInSeconds;
}
