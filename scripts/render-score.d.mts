/**
 * Types for the offline renderer's public surface.
 *
 * `render-score.mjs` is plain ESM so Node can run it as a script and the
 * checker can import it. This declaration exists so the TypeScript side —
 * today, `test/calibration.test.ts` — can import the same functions rather than
 * restating what they do. Only what a TypeScript caller actually uses is
 * declared; the renderer's own result object is far larger than this and is
 * typed where it is measured, not here.
 */

import type { MixRole } from './lib/mixlaw.d.mts';

/** The one path the live app reads its faders from. */
export declare const CALIBRATION_FILE: string;

export interface RenderOptions {
  score: string;
  section: string;
  lens: string;
  from: number;
  seconds: number;
  out: string | null;
  stems: boolean;
  calibrateFrom: number | null;
  calibrateSeconds: number | null;
  json: string | null;
  noCache: boolean;
  mp3: boolean;
  masterTrimDb: number | null;
  /**
   * Slice B3: publication is an act, not a side effect of rendering. False
   * unless `--publish-calibration` was passed.
   */
  publishCalibration: boolean;
}

export declare function parseArgs(argv: string[]): RenderOptions;

/** What `writeCalibration` needs out of a render result. */
export interface CalibrationSource {
  lens: string;
  trims: Partial<Record<MixRole, number>>;
  /** Integrated loudness at unity master. */
  rawLufs: number;
  /** Peak at unity master — the other half of the Ruling 1 fader. */
  rawPeakDbfs: number;
  /** Absolute path to the score this was measured on. */
  score: string;
  section: string;
}

/**
 * Merge one lens's measurement into a calibration file, and return its path.
 * The destination is explicit; `CALIBRATION_FILE` is the only one the app reads.
 */
export declare function writeCalibration(
  result: CalibrationSource,
  file?: string,
): string;
