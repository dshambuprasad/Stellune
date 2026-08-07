/**
 * Slice B1.1 — WHAT THE LIVE GRAPH DID, and when.
 *
 * Shambu's ear found three defect windows in the B1 live capture that the
 * offline render of the same score does not have. HQ's hypothesis is a
 * lazy-load race: notes voiced through a fall-through instrument, or stretched
 * a long way from their nearest recorded pitch, because the sample they wanted
 * had not finished downloading. Both of those sound exactly like what he
 * described — thin, sharp, "an instrument I can't identify".
 *
 * A hypothesis that cannot be falsified is not worth fixing against, so this
 * module exists to make it falsifiable. Every event that could plausibly
 * produce the reported artefacts is recorded WITH ITS PIECE TIMESTAMP, so the
 * log can be lined up against the timestamps on the capture rather than against
 * a story about what probably happened.
 *
 * It is deliberately not a logger. It writes to a bounded array in memory, does
 * no string formatting on the hot path, and holds no references to audio nodes
 * — a diagnostic that perturbs the thing it measures is worse than none.
 */

import type { VoiceRole } from '../mapping/index.ts';

export type LiveEventKind =
  /** The lens's first-choice instrument for this role was not the one used. */
  | 'fallback-voicing'
  /** The note was resampled further than the tuning pass considers clean. */
  | 'far-shift'
  /** The sample had not loaded; the note did not sound. */
  | 'not-loaded'
  /** A sounding voice was cut short to make room. */
  | 'voice-steal'
  /** An instrument finished downloading. */
  | 'instrument-ready'
  /**
   * The audio thread missed its deadline.
   *
   * Added after the first B1.1 reproduction falsified both of the hypotheses
   * that had been written down: not one note was dropped for an unloaded
   * sample, and the limiter's worst gain reduction across the whole run was
   * 0.072 dB. Neither mechanism was present, and the ear report still had to be
   * about something. A render quantum that overruns produces exactly what was
   * described — distortion, and notes that appear from nowhere — so it is now
   * measured rather than assumed absent.
   */
  | 'audio-underrun'
  /** A lens change was requested / took effect. */
  | 'lens-requested'
  | 'lens-committed'
  | 'playback-started';

export interface LiveEvent {
  kind: LiveEventKind;
  /** Seconds into the PIECE — the axis Shambu's timestamps live on. */
  atPieceSeconds: number;
  role?: VoiceRole;
  sourceId?: string;
  instrument?: string;
  /** For 'fallback-voicing': what the lens would have preferred. */
  preferred?: string;
  midi?: number;
  sampleMidi?: number;
  /** Semitones of resampling. Negative is down. */
  shiftSemitones?: number;
  lens?: string;
  detail?: string;
  /** For 'audio-underrun': Chrome's AudioContext render-capacity figures. */
  averageLoad?: number;
  peakLoad?: number;
  underrunRatio?: number;
  /** How many voices were sounding when this was recorded. */
  voices?: number;
}

/**
 * How far a note may be resampled before it is worth recording.
 *
 * ±3 semitones is the tuning pass's cap. Beyond it a struck instrument's
 * transient stretches audibly and a sustained one's formants move, which is the
 * "sharp note out of nowhere" and the "instrument I can't identify".
 */
export const FAR_SHIFT_SEMITONES = 3;

/** Bounded so a long session cannot grow the log without limit. */
const MAX_EVENTS = 20000;

export class LiveDiagnostics {
  #events: LiveEvent[] = [];
  #dropped = 0;
  #enabled: boolean;

  constructor(enabled = false) {
    this.#enabled = enabled;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(value: boolean) {
    this.#enabled = value;
  }

  record(event: LiveEvent): void {
    if (!this.#enabled) return;
    if (this.#events.length >= MAX_EVENTS) {
      this.#dropped += 1;
      return;
    }
    this.#events.push(event);
  }

  get events(): readonly LiveEvent[] {
    return this.#events;
  }

  clear(): void {
    this.#events = [];
    this.#dropped = 0;
  }

  /**
   * Counts per kind, plus the windows where the suspicious kinds cluster.
   *
   * `windowSeconds` buckets the timeline so a burst is visible as a burst. The
   * question being asked is not "did this ever happen" — a fall-through voicing
   * is legal and happens hundreds of times — but "did it happen A LOT, right
   * where the ear heard something wrong".
   */
  summarise(windowSeconds = 5): {
    total: number;
    droppedFromLog: number;
    byKind: Record<string, number>;
    buckets: { fromSeconds: number; counts: Record<string, number> }[];
  } {
    const byKind: Record<string, number> = {};
    const bucketMap = new Map<number, Record<string, number>>();

    for (const event of this.#events) {
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
      const bucket = Math.floor(event.atPieceSeconds / windowSeconds) * windowSeconds;
      const counts = bucketMap.get(bucket) ?? {};
      counts[event.kind] = (counts[event.kind] ?? 0) + 1;
      bucketMap.set(bucket, counts);
    }

    return {
      total: this.#events.length,
      droppedFromLog: this.#dropped,
      byKind,
      buckets: [...bucketMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([fromSeconds, counts]) => ({ fromSeconds, counts })),
    };
  }

  /**
   * Everything that happened inside a window, for lining up against an ear
   * report. `label` is carried through so the report says which of Shambu's
   * three windows a row belongs to.
   */
  inWindow(fromSeconds: number, toSeconds: number): LiveEvent[] {
    return this.#events.filter(
      (e) => e.atPieceSeconds >= fromSeconds && e.atPieceSeconds < toSeconds,
    );
  }
}
