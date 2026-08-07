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
  limiterCeilingDbfs: number;
  maxPeakDbfs: number;
  maxLimiterBusyFraction: number;
  maxLimitingDb: number;
};
export declare const WINDOW_TOLERANCE_DB: number;
export declare const WINDOW_SECONDS: number;
export declare const WINDOW_GATE_DBFS: number;
