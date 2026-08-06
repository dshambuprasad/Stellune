/**
 * Living Sky — the Conductor (design §5–6).
 *
 * The Conductor's job is to say **almost nothing**, and to choose well.
 *
 * The sky offers a true event every ten seconds or so; the Conductor uses one
 * phrase per phrase period and lets the rest go by. Restraint is the feature.
 *
 * A phrase is **statement → answer → rest**:
 *   STATEMENT  the subject's figure — a single chime, or a constellation's motif
 *   ANSWER     the same material transposed down ONE SCALE DEGREE, truncated,
 *              and quieter: a reply, not a repeat
 *   REST       silence to the end of the period, honouring the silence budget
 *
 * Purity note — this is the one part of the design that wants history, and the
 * way it gets it without breaking partition invariance is a **bounded lookback
 * anchored to an absolute phrase index**: to decide phrase p we replay phrases
 * from `max(0, p − lookback)` forward, always from the same anchor, so the answer
 * depends only on p and never on which window asked.
 */

import type { Star } from '../model/index.ts';
import { toHorizon } from './astro.ts';
import { starEventTimes } from './skyEvents.ts';
import type { SkyEvent } from './skyEvents.ts';
import { lstAt, occurrencesInRange } from './skyTime.ts';
import { noteBudgetPerMinute } from './skyWeather.ts';
import type { Motif } from './motif.ts';
import { invertDegrees, scaleGaps, transposeDegrees } from './motif.ts';
import type { SessionPlan } from './session.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Relative weights for the salience score. Tuning dials. */
const W_BRIGHTNESS = 0.5;
const W_ALTITUDE = 0.2;
const W_KIND = 0.3;

/** Culmination is the fullest statement; a rise announces; a set says goodbye. */
const KIND_WEIGHT: Record<SkyEvent['kind'], number> = {
  culmination: 1,
  rise: 0.6,
  set: 0.45,
};

/** A whole constellation being up and high is an occasion in its own right. */
const CONSTELLATION_WEIGHT = 1.15;

/** Augmentation factor at culmination — the star's still moment at the top. */
const AUGMENTATION = 1.6;

/** How much quieter the answer is than the statement. */
const ANSWER_GAIN = 0.55;
/** Gap between statement and answer, seconds. */
const ANSWER_DELAY = 1.4;

/** Fewer notes than this and a constellation's figure is unrecognisable. */
const MOTIF_MIN_AUDIBLE_NOTES = 3;

// --------------------------------------------------------------- subjects

/** A constellation crossing the meridian, high enough to be worth saying. */
export interface MotifEvent {
  kind: 'constellation';
  motif: Motif;
  pieceSeconds: number;
  skySeconds: number;
  /** Mean altitude of the motif's stars at that moment. */
  meanAltitude: number;
}

export type PhraseSubject = SkyEvent | MotifEvent;

const subjectKey = (s: PhraseSubject): string =>
  s.kind === 'constellation' ? `con:${s.motif.constellation}` : `star:${s.star.id}`;

/**
 * Every true event in `[from, to)`, from the lead pool.
 *
 * Closed-form throughout: each star's three event sidereal times are computed
 * once, then their occurrences inside the range are enumerated directly.
 */
export function eventsInRange(plan: SessionPlan, from: number, to: number): SkyEvent[] {
  const { observer, lst0, kappa } = plan;
  const events: SkyEvent[] = [];

  for (const star of plan.leadStars) {
    const times = starEventTimes(star, observer.latitude);
    if (times.maxAltitude <= 0) continue;

    const add = (kind: SkyEvent['kind'], targetLst: number, altitude: number): void => {
      for (const pieceSeconds of occurrencesInRange(lst0, targetLst, kappa, from, to)) {
        events.push({ kind, star, pieceSeconds, skySeconds: pieceSeconds * kappa, altitude });
      }
    };

    add('culmination', times.culminationLst, times.maxAltitude);
    if (times.visibility === 'rises-and-sets') {
      if (times.riseLst !== undefined) add('rise', times.riseLst, 0);
      if (times.setLst !== undefined) add('set', times.setLst, 0);
    }
  }

  events.sort(
    (a, b) =>
      a.pieceSeconds - b.pieceSeconds ||
      compareIds(a.star.id, b.star.id) ||
      a.kind.localeCompare(b.kind),
  );
  return events;
}

/**
 * Constellations crossing the meridian in `[from, to)` while genuinely prominent.
 *
 * A group's moment is when its mean right ascension culminates — that is the
 * constellation crossing the meridian, which is the ordinary sense of "it is at
 * its highest". It only counts as prominent when **every** motif star is above
 * the horizon and the group's mean altitude clears the threshold, so a
 * constellation half-risen or scraping the horizon stays quiet.
 */
export function motifEventsInRange(plan: SessionPlan, from: number, to: number): MotifEvent[] {
  const events: MotifEvent[] = [];
  const threshold = plan.config.constellationAltitudeThreshold;

  for (const motif of plan.motifs) {
    for (const pieceSeconds of occurrencesInRange(plan.lst0, motif.meanRa, plan.kappa, from, to)) {
      const lst = lstAt(plan.lst0, pieceSeconds, plan.kappa);

      let total = 0;
      let allUp = true;
      for (const id of motif.starIds) {
        const star = plan.motifStars.get(id);
        if (!star) {
          allUp = false;
          break;
        }
        const { altitude } = toHorizon(star, plan.observer.latitude, lst);
        if (altitude <= 0) {
          allUp = false;
          break;
        }
        total += altitude;
      }
      if (!allUp) continue;

      const meanAltitude = total / motif.starIds.length;
      if (meanAltitude < threshold) continue;

      events.push({
        kind: 'constellation',
        motif,
        pieceSeconds,
        skySeconds: pieceSeconds * plan.kappa,
        meanAltitude,
      });
    }
  }

  events.sort(
    (a, b) =>
      a.pieceSeconds - b.pieceSeconds ||
      a.motif.constellation.localeCompare(b.motif.constellation),
  );
  return events;
}

/** How much of an occasion this is. Deterministic; no randomness. */
export function salience(subject: PhraseSubject): number {
  if (subject.kind === 'constellation') {
    // A constellation's brightness is the sum of its members, so it is compared
    // on the same footing as a single star by taking an effective magnitude.
    const effectiveMag = -2.5 * Math.log10(Math.max(1e-9, subject.motif.totalFlux));
    const brightness = clamp((6.5 - effectiveMag) / 8, 0, 1);
    const altitude = clamp(subject.meanAltitude / 90, 0, 1);
    return W_BRIGHTNESS * brightness + W_ALTITUDE * altitude + W_KIND * CONSTELLATION_WEIGHT;
  }
  const brightness = clamp((6.5 - subject.star.mag) / 8, 0, 1);
  const altitude = clamp(subject.altitude / 90, 0, 1);
  return W_BRIGHTNESS * brightness + W_ALTITUDE * altitude + W_KIND * KIND_WEIGHT[subject.kind];
}

// ---------------------------------------------------------------- phrases

/** One note of a phrase, still in scale-degree space. */
export interface PhraseNote {
  /** Scale-degree index on the ladder; becomes a pitch via `degreeToMidi`. */
  degree: number;
  /** Absolute piece time. */
  startSeconds: number;
  durationSeconds: number;
  /** 0..1 relative to the subject's own loudness. */
  gain: number;
  part: 'statement' | 'answer';
}

export interface Phrase {
  phraseIndex: number;
  subject: PhraseSubject;
  notes: PhraseNote[];
  /** When the scheduled rest begins. */
  restFromSeconds: number;
  /** Stable id linking a statement to its answer. */
  phraseId: string;
}

/** The phrase period boundaries — a fixed grid, so windows cannot disturb it. */
export function phraseBounds(plan: SessionPlan, phraseIndex: number): { from: number; to: number } {
  const p = plan.config.phraseSeconds;
  return { from: phraseIndex * p, to: (phraseIndex + 1) * p };
}

/**
 * How many notes this phrase may spend.
 *
 * The note budget is a hard constraint, not an aspiration: a denser sky earns
 * more notes and a lonely one is held to a whisper. This is what keeps a
 * five-note motif from blowing through a budget of four notes a minute.
 */
export function noteAllowance(plan: SessionPlan): { statement: number; answer: number } {
  const perMinute = noteBudgetPerMinute(plan.weather);

  // The budget is asserted over a SLIDING minute, and a sliding minute can
  // straddle more than one phrase period — so dividing the per-minute figure by
  // the phrase rate would overshoot. Dividing by the number of periods a minute
  // can touch is what makes the bound actually hold.
  const periodsPerMinute = Math.floor(60 / plan.config.phraseSeconds) + 1;
  const total = Math.max(1, Math.floor(perMinute / periodsPerMinute));

  const answer = total >= 3 ? Math.min(3, Math.floor(total / 3)) : total >= 2 ? 1 : 0;
  return { statement: Math.max(1, total - answer), answer };
}

/**
 * Build the phrase for a chosen subject.
 *
 * Development is applied here, and every transform is in **scale-degree space**
 * so the result cannot leave the ladder:
 *   - a **setting** subject is INVERTED — the phrase descends because the thing
 *     it describes is going down;
 *   - a **culminating** subject is AUGMENTED — slowed, for the still moment at
 *     the top of the arc;
 *   - the **answer** is the statement transposed down one degree and truncated.
 */
function buildPhrase(
  plan: SessionPlan,
  phraseIndex: number,
  subject: PhraseSubject,
  activeEnd: number,
): Phrase {
  const allowance = noteAllowance(plan);
  const start = subject.pieceSeconds;

  let degrees: number[];
  let gaps: number[];

  if (subject.kind === 'constellation') {
    degrees = subject.motif.degrees;
    gaps = subject.motif.gaps;
  } else {
    // A single star speaks one note: its own, from its culmination altitude.
    degrees = [0];
    gaps = [];
  }

  const isSetting = subject.kind === 'set';
  const isCulmination = subject.kind === 'culmination' || subject.kind === 'constellation';

  if (isSetting) degrees = invertDegrees(degrees);
  if (isCulmination) gaps = scaleGaps(gaps, AUGMENTATION);

  const statementDegrees = degrees.slice(0, allowance.statement);
  const statementGaps = gaps.slice(0, Math.max(0, statementDegrees.length - 1));

  const noteLength = isCulmination ? 9 : isSetting ? 6.5 : 5;

  const notes: PhraseNote[] = [];
  let at = start;
  for (let index = 0; index < statementDegrees.length; index++) {
    // Every note must land inside the active portion of its own period. A note
    // that spilled past it would be dropped by the window holding its period and
    // never picked up by the next — the exact shape of a partition-invariance
    // bug, and one the headline test caught.
    if (at >= activeEnd) break;
    notes.push({
      degree: statementDegrees[index] as number,
      startSeconds: at,
      durationSeconds: noteLength,
      gain: 1,
      part: 'statement',
    });
    at += statementGaps[index] ?? 0;
  }

  // ---- the answer: a reply, not a repeat
  const statementEnd = at;
  const placed = notes.length;
  if (allowance.answer > 0 && placed > 0) {
    const answerDegrees = transposeDegrees(
      statementDegrees.slice(0, Math.min(allowance.answer, placed)),
      -1,
    );
    const answerGaps = statementGaps.slice(0, Math.max(0, answerDegrees.length - 1));
    let answerAt = statementEnd + ANSWER_DELAY;

    for (let index = 0; index < answerDegrees.length; index++) {
      if (answerAt >= activeEnd) break;
      notes.push({
        degree: answerDegrees[index] as number,
        startSeconds: answerAt,
        durationSeconds: noteLength * 0.7,
        gain: ANSWER_GAIN,
        part: 'answer',
      });
      answerAt += answerGaps[index] ?? 0;
    }
  }

  const lastNote = notes[notes.length - 1];
  const restFrom = lastNote ? lastNote.startSeconds + 0.1 : start;

  return {
    phraseIndex,
    subject,
    notes,
    restFromSeconds: restFrom,
    phraseId: `p${phraseIndex}:${subjectKey(subject)}`,
  };
}

/**
 * Choose the phrase for one period, given which subjects are barred.
 *
 * Candidates come only from the ACTIVE portion at the front of the period; the
 * tail is the scheduled rest. Silence is not the absence of the piece — it is
 * part of it, and it is budgeted.
 */
function chooseForPhrase(plan: SessionPlan, phraseIndex: number, barred: Set<string>): Phrase | null {
  const { from, to } = phraseBounds(plan, phraseIndex);
  if (from < 0) return null;

  const activeEnd = from + (to - from) * (1 - plan.silenceBudget);

  const candidates: PhraseSubject[] = [
    ...motifEventsInRange(plan, from, activeEnd),
    ...eventsInRange(plan, from, activeEnd),
  ].filter((s) => !barred.has(subjectKey(s)));

  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort(
    (a, b) => salience(b) - salience(a) || subjectKey(a).localeCompare(subjectKey(b)),
  );

  // Take the most salient subject that can actually be *said* in the room left.
  // A constellation firing near the end of the active portion would be truncated
  // to one or two notes, and a one-note motif is not a motif — better to let the
  // next subject speak than to mangle the figure that carries the identity.
  for (const subject of ranked) {
    const phrase = buildPhrase(plan, phraseIndex, subject, activeEnd);
    const statementNotes = phrase.notes.filter((n) => n.part === 'statement').length;
    const viable =
      subject.kind === 'constellation'
        ? statementNotes >= Math.min(MOTIF_MIN_AUDIBLE_NOTES, subject.motif.degrees.length)
        : statementNotes >= 1;
    if (viable) return phrase;
  }
  return null;
}

/**
 * The phrase for one period, with recency applied.
 *
 * Replays the bounded lookback from an absolute anchor so the result depends
 * only on `phraseIndex` — never on the window that asked. That is what keeps the
 * stream partition-invariant while still letting the Conductor remember.
 */
export function phraseForIndex(plan: SessionPlan, phraseIndex: number): Phrase | null {
  if (phraseIndex < 0) return null;
  const lookback = Math.max(0, Math.floor(plan.config.lookbackPhrases));
  const anchor = Math.max(0, phraseIndex - lookback);

  const history: string[] = [];
  let result: Phrase | null = null;

  for (let index = anchor; index <= phraseIndex; index++) {
    const barred = new Set(lookback > 0 ? history.slice(-lookback) : []);
    result = chooseForPhrase(plan, index, barred);
    history.push(result ? subjectKey(result.subject) : `silence:${index}`);
  }
  return result;
}

/** Every phrase whose period overlaps `[from, to)`. */
export function phrasesInRange(plan: SessionPlan, from: number, to: number): Phrase[] {
  const p = plan.config.phraseSeconds;
  // Look back one period as well: notes are bounded to their own period, but the
  // extra period costs almost nothing and removes a whole class of boundary bug.
  const firstPhrase = Math.max(0, Math.floor(from / p) - 1);
  const lastPhrase = Math.floor(Math.max(from, to - 1e-9) / p);

  const phrases: Phrase[] = [];
  for (let index = firstPhrase; index <= lastPhrase; index++) {
    const phrase = phraseForIndex(plan, index);
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

/** Where a star sits at the moment it speaks — for pan and twinkle. */
export function horizonAtEvent(plan: SessionPlan, star: Star, pieceSeconds: number) {
  return toHorizon(star, plan.observer.latitude, lstAt(plan.lst0, pieceSeconds, plan.kappa));
}

export { subjectKey };

function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}
