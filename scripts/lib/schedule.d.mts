/**
 * Types for the shared schedule builder.
 *
 * `schedule.mjs` is plain ESM so the Node renderer can import it directly; this
 * declaration is what lets the TypeScript audio layer import the SAME module
 * rather than reimplementing it. One derivation, two consumers.
 */

export interface ScheduleEvent {
  role: string;
  sourceId: string;
  midi: number;
  amplitude: number;
  pan?: number;
  startSeconds: number;
  durationSeconds: number;
  registerHint?: number;
  twinkle?: number;
  envelope?: readonly { atSeconds: number; amplitude: number }[];
  timbre?: { warmth: number; brightness: number };
}

export interface ScheduledVoice {
  role: string;
  sourceId: string;
  startSeconds: number;
  durationSeconds: number;
  /** Pitch after the event's own `registerHint` is applied. */
  midi: number;
  instrument: string;
  sampleMidi: number;
  sampleFile: string | null;
  rate: number;
  /** Event amplitude after the mix law's per-role velocity shaping. */
  velocity: number;
  /** Lens voicing offset + the instrument's loudness match. */
  gainDb: number;
  /** B–V colour, as dB of high shelf. A level, this is not. */
  tiltDb: number;
  pan: number;
  /** The star's altitude arc, event-relative. Composed data, not an effect. */
  envelope: readonly { atSeconds: number; amplitude: number }[] | null;
  twinkle: number;
  kind: 'sustained' | 'decay';
  attackSeconds: number;
  loopStart: number | null;
  loopEnd: number | null;
}

export interface ChosenInstrument {
  instrument: string;
  sampleMidi: number;
  sampleFile: string | null;
  shiftSemitones: number;
  rate: number;
  gainDb: number;
  kind: 'sustained' | 'decay';
  attackSeconds: number;
  loopStart: number | null;
  loopEnd: number | null;
}

export interface ConcurrencyGrid {
  fromSeconds: number;
  stepSeconds: number;
  counts: number[];
}

export declare const SCHEDULE_ROLES: readonly string[];

/**
 * The roles a lens declares, in the mix law's order — Slice B4.
 *
 * A lens may leave a role out, and a role it leaves out is not scheduled at all.
 * Both consumers read this rather than assuming five.
 */
export declare function declaredRoles(lenses: unknown, lensId: string): string[];
export declare function lensDeclaresRole(lenses: unknown, lensId: string, role: string): boolean;
export declare const DEFAULT_ROLE_SHAPING: Record<string, { velocityCompress: number }>;

export declare function voicedMidi(event: ScheduleEvent): number;
export declare function shadingTilt(
  shading: { tiltDb: number; neutralBrightness: number } | undefined,
  timbre: { warmth: number; brightness: number } | undefined,
): number;
export declare function chooseVoiceFor(
  lenses: unknown,
  manifest: unknown,
  lensId: string,
  role: string,
  midi: number,
): ChosenInstrument;
export declare function buildSchedule(
  events: readonly ScheduleEvent[],
  lenses: unknown,
  manifest: unknown,
  lensId: string,
  options?: { roleShaping?: Record<string, { velocityCompress: number }>; shading?: unknown },
): ScheduledVoice[];
export declare function concurrencyGrid(
  schedule: readonly ScheduledVoice[],
  role: string,
  fromSeconds: number,
  toSeconds: number,
  stepSeconds: number,
): ConcurrencyGrid;
export declare function concurrencyGains(grid: ConcurrencyGrid, slewSeconds?: number): number[];
