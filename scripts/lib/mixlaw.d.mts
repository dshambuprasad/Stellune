/**
 * Types for THE MIX LAW.
 *
 * `mixlaw.mjs` is plain ESM so the Node renderer and the checker can import it;
 * this declaration lets the TypeScript audio layer import the SAME numbers
 * rather than restating them. Restating them is how the renderer and the app
 * would come to disagree about what the law says.
 */

export type MixRole = 'ground' | 'chord' | 'figuration' | 'lead' | 'weather';

export declare const STEM_TARGETS_DBFS: Record<MixRole, number>;
export declare const STEM_TOLERANCE_DB: number;
export declare const FIGURATION_OVER_LAYER_DB: { ground: number; chord: number; tolerance: number };
export declare const ROLE_SHAPING: Record<
  MixRole,
  { concurrencyNormalise: boolean; velocityCompress: number }
>;
export declare const WEATHER_OCTAVE_SHIFT: number;
export declare const WEATHER_MIN_SEPARATION_SEMITONES: number;
export declare const MASTER: {
  highpassHz: number;
  /** Where the master fader lands the loudest sample. Outranks the LUFS target. */
  peakCeilingDbfs: number;
  maxPeakDbfs: number;
  peakAssertEpsilonDb: number;
  maxLimiterBusyFraction: number;
  maxLimitingDb: number;
};
export declare const WINDOW_TOLERANCE_DB: number;
export declare const WINDOW_TOLERANCE_BY_ROLE: Partial<Record<MixRole, number>>;
export declare function windowToleranceFor(role: MixRole | string): number;
export declare const WINDOW_SECONDS: number;
export declare const WINDOW_GATE_DBFS: number;

/**
 * `min(loudness trim, peak-safe trim)` — the one derivation the offline
 * renderer and the live graph both apply. A non-finite `measuredPeakDbfs`
 * means "not measured", and falls back to the loudness trim alone.
 */
export declare function masterTrimDb(measurement: {
  lufsTarget: number;
  measuredLufs: number;
  measuredPeakDbfs?: number;
}): number;
