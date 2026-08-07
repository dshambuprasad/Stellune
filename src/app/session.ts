/**
 * Phase 4 — one listening session: the engine, the clock, and what is singing.
 *
 * This is the seam between the app and the engine's public surface. It touches
 * exactly four things — `prepareSession`, `renderWindow`, `createStreamEngine`
 * and `getLevels()`/`getLevelSources()` — and nothing else, so the parallel
 * B1 stream can rework the audio internals without this file noticing.
 *
 * WHAT DRIVES THE MUSIC: when and where, and the lens. Nothing else. The camera
 * is not an input here and never will be.
 */

import type { City, ObserverInput, Star, StreamEngine } from '../engine/index.ts';
import { createStreamEngine } from '../engine/index.ts';
// The Living Sky surface is published by the mapping layer's own index; the
// top-level engine barrel does not forward it, and that barrel belongs to the
// parallel stream. Importing the layer's public entry point directly is the
// documented way in, and costs this slice no edits outside its territory.
import type {
  LivingSkyConfig,
  ScoreWindow,
  SessionPlan,
} from '../engine/mapping/index.ts';
import { prepareSession, renderWindow } from '../engine/mapping/index.ts';
import type { LensId } from './lenses.ts';
import { audioStyleForLens } from './lenses.ts';
import type { GlowState } from './starfield.ts';

export type SessionMode = 'tonight' | 'birth-sky';

export interface SessionRequest {
  mode: SessionMode;
  observer: ObserverInput;
  /** Where the observer came from, for the honesty label. */
  placeLabel: string;
  lens: LensId;
}

/** How far ahead the app keeps its own copy of the score, in seconds. */
const WINDOW_AHEAD = 45;
/** Rebuild the window when fewer than this many seconds of it are left. */
const WINDOW_REFRESH_AT = 15;

/**
 * A lead phrase keeps its halo for a beat after the note stops, so the eye has
 * time to find the star the ear just heard.
 */
const LEAD_AFTERGLOW = 2.5;

export interface LeadMoment {
  starId: string;
  label: string | null;
  startSeconds: number;
  endSeconds: number;
}

export class Session {
  readonly plan: SessionPlan;
  readonly request: SessionRequest;
  readonly mode: SessionMode;
  /** Total length in seconds; Infinity for endless. */
  readonly totalSeconds: number;

  #engine: StreamEngine | null = null;
  #window: ScoreWindow;
  #starNames = new Map<string, string | undefined>();

  /** Piece position in seconds, tracked app-side from the wall clock. */
  #elapsed = 0;
  #startedAt = 0;
  #playing = false;
  #lens: LensId;

  constructor(plan: SessionPlan, request: SessionRequest, catalog: Star[], totalSeconds: number) {
    this.plan = plan;
    this.request = request;
    this.mode = request.mode;
    this.totalSeconds = totalSeconds;
    this.#lens = request.lens;
    for (const star of catalog) this.#starNames.set(star.id, star.name);
    this.#window = renderWindow(plan, 0, WINDOW_AHEAD);
  }

  get lens(): LensId {
    return this.#lens;
  }

  get playing(): boolean {
    return this.#playing;
  }

  get elapsedSeconds(): number {
    return this.#elapsed;
  }

  /** 0..1 through a birth-sky session; always 0 for endless. */
  get progress(): number {
    if (!Number.isFinite(this.totalSeconds) || this.totalSeconds <= 0) return 0;
    return Math.min(1, this.#elapsed / this.totalSeconds);
  }

  get scoreWindow(): ScoreWindow {
    return this.#window;
  }

  /** Sky-seconds per listening-second — the number the honesty label quotes. */
  get kappa(): number {
    return this.plan.kappa;
  }

  async play(fromSeconds = this.#elapsed): Promise<void> {
    this.#elapsed = fromSeconds;
    if (!this.#engine) {
      this.#engine = createStreamEngine(this.plan, {
        style: audioStyleForLens(this.#lens),
        meters: true,
      });
    }
    await this.#engine.play(fromSeconds);
    this.#startedAt = performance.now() - fromSeconds * 1000;
    this.#playing = true;
  }

  pause(): void {
    this.#engine?.stop();
    this.#playing = false;
  }

  /**
   * Change the mood lens without changing the music's pitches or timing.
   *
   * The piece resumes at the same second it was at, because a lens is a change
   * of instrument, not a change of piece. (Until B1 lands the sampled
   * instruments, the only timbral difference the engine can express is its
   * reverb/chorus voicing — see `audioStyleForLens`. The seam is here so that
   * wiring is a one-line change.)
   */
  async setLens(lens: LensId): Promise<void> {
    if (lens === this.#lens) return;
    this.#lens = lens;
    const wasPlaying = this.#playing;
    const at = this.#elapsed;
    this.#engine?.stop();
    this.#engine?.dispose();
    this.#engine = null;
    if (wasPlaying) await this.play(at);
  }

  dispose(): void {
    this.#engine?.stop();
    this.#engine?.dispose();
    this.#engine = null;
    this.#playing = false;
  }

  /** True once a birth-sky session has run its length. */
  get complete(): boolean {
    return Number.isFinite(this.totalSeconds) && this.#elapsed >= this.totalSeconds;
  }

  /**
   * Advance the clock and refresh what the starfield should show.
   *
   * Called once per animation frame. The piece position comes from the wall
   * clock rather than from the audio graph: the engine does not publish its
   * transport time, and asking it to would mean editing a file this slice does
   * not own. Drift against Tone's clock is on the order of milliseconds over a
   * session, which is invisible in a glow.
   */
  tick(): void {
    if (this.#playing) {
      this.#elapsed = (performance.now() - this.#startedAt) / 1000;
      if (this.complete) {
        this.#elapsed = this.totalSeconds;
        this.pause();
      }
    }

    // Keep a rolling window of the score ahead of the playhead.
    if (this.#elapsed > this.#window.toSeconds - WINDOW_REFRESH_AT) {
      const from = Math.max(0, this.#elapsed - 2);
      this.#window = renderWindow(this.plan, from, from + WINDOW_AHEAD);
    }
  }

  /** Local sidereal time for the current moment, in degrees. */
  siderealTimeDegrees(): number {
    const skyDegreesPerSecond = 360 / 86164.0905;
    return (this.plan.lst0 + this.#elapsed * this.plan.kappa * skyDegreesPerSecond) % 360;
  }

  /**
   * WHAT IS SINGING RIGHT NOW.
   *
   * Two sources, deliberately crossed:
   *
   *   the ENGINE'S METERS give the true level of each sounding voice, which is
   *   what makes the glow feel alive rather than animated;
   *
   *   the APP'S OWN SCORE WINDOW says which stars the piece intends to be
   *   sounding at this second.
   *
   * A level is only believed when the score agrees the star is up and sounding.
   * That cross-check costs nothing and closes a real hole: the engine rebuilds
   * its source list only when the number of voices changes, so two different
   * sets of voices that happen to be the same size can leave the names stale
   * for a moment. Cross-referencing means a stale name simply fails to match
   * and is ignored, instead of lighting up the wrong star.
   */
  glow(): GlowState {
    const levels = new Map<string, number>();
    const now = this.#elapsed;

    // Which stars the score says are sounding, and how loud they should be.
    const expected = new Map<string, number>();
    let lead: LeadMoment | null = null;
    for (const event of this.#window.events) {
      if (event.startSeconds > now) continue;
      const end = event.startSeconds + event.durationSeconds;
      if (event.role === 'lead') {
        // Keep the most recent lead phrase, including its afterglow.
        if (now <= end + LEAD_AFTERGLOW && event.origin.kind !== 'ground') {
          const starId = leadStarId(event.origin);
          if (starId && (!lead || event.startSeconds >= lead.startSeconds)) {
            lead = {
              starId,
              label: this.#starNames.get(starId) ?? null,
              startSeconds: event.startSeconds,
              endSeconds: end,
            };
          }
        }
      }
      if (now > end) continue;
      if (event.role === 'ground' || event.role === 'weather') continue;
      const starId = event.sourceId;
      const previous = expected.get(starId) ?? 0;
      expected.set(starId, Math.max(previous, event.amplitude));
    }

    const engine = this.#engine;
    if (engine && this.#playing) {
      // getLevels() must be called before getLevelSources(): it is what
      // refreshes the source list.
      const measured = engine.getLevels();
      const sources = engine.getLevelSources();
      for (let i = 0; i < measured.length; i++) {
        const id = sources[i];
        const value = measured[i];
        if (id == null || value == null || !expected.has(id)) continue;
        levels.set(id, Math.max(levels.get(id) ?? 0, Math.min(1, value)));
      }
    }

    // Before the first meter reading — and whenever a voice has no meter — fall
    // back to the score's own amplitude, so the sky never looks silent while it
    // is audibly playing.
    for (const [id, amplitude] of expected) {
      if (!levels.has(id)) levels.set(id, this.#playing ? amplitude * 0.5 : 0);
    }

    let leadIntensity = 0;
    if (lead) {
      leadIntensity =
        now <= lead.endSeconds
          ? 1
          : Math.max(0, 1 - (now - lead.endSeconds) / LEAD_AFTERGLOW);
    }

    return {
      levels,
      leadStarId: lead?.starId ?? null,
      leadLabel: lead?.label ?? null,
      leadIntensity,
    };
  }
}

/** The star behind a lead event, whatever kind of origin it carries. */
function leadStarId(origin: ScoreWindow['events'][number]['origin']): string | null {
  if ('starId' in origin && typeof origin.starId === 'string') return origin.starId;
  return null;
}

export interface BuildSessionResult {
  session: Session;
  /** Stars above the horizon at the session's opening moment. */
  visibleCount: number;
}

/**
 * Build a session, or explain why the sky cannot carry one.
 *
 * Throws `EmptySkyError` when there is nothing up — a real outcome at the poles
 * and in a few odd geometries, and one the UI must be able to say plainly
 * rather than crash on.
 */
export class EmptySkyError extends Error {
  constructor(placeLabel: string) {
    super(`No catalogue stars are above the horizon at ${placeLabel} for that moment.`);
    this.name = 'EmptySkyError';
  }
}

export function buildSession(catalog: Star[], request: SessionRequest): BuildSessionResult {
  const config: Partial<LivingSkyConfig> =
    request.mode === 'birth-sky'
      ? { mode: 'birth-sky' }
      : // Endless mode: the sky's own pace, unbounded. The walkthrough's 80%
        // case — open it, press once, put the phone down.
        { mode: 'endless', kappa: 45 };

  const plan = prepareSession(catalog, request.observer, config);
  if (plan.weather.visibleCount === 0 || plan.chordStars.length === 0) {
    throw new EmptySkyError(request.placeLabel);
  }

  const totalSeconds =
    request.mode === 'birth-sky' ? (plan.config.sessionSeconds ?? 660) : Number.POSITIVE_INFINITY;

  return {
    session: new Session(plan, request, catalog, totalSeconds),
    visibleCount: plan.weather.visibleCount,
  };
}

/** Build an `ObserverInput` for "here, now". */
export function observerForNow(
  latitude: number,
  longitude: number,
  tzOffsetMinutes: number,
  now = new Date(),
): ObserverInput {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  const dateISO = local.toISOString().slice(0, 10);
  const timeMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return { latitude, longitude, dateISO, timeMinutes, tzOffsetMinutes };
}

/** Build an `ObserverInput` from a city and a chosen date/time. */
export function observerForCity(
  city: City,
  dateISO: string,
  timeMinutes: number | undefined,
): ObserverInput {
  return {
    latitude: city.lat,
    longitude: city.lon,
    dateISO,
    ...(timeMinutes == null ? {} : { timeMinutes }),
    tzOffsetMinutes: city.tzOffsetMinutes,
  };
}
