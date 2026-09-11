/**
 * THE MIX LAW and THE MASTERING LAW, as the live graph reads them.
 *
 * The numbers themselves live in `scripts/lib/mixlaw.mjs` and
 * `public/samples/lenses.json`, not here. This module is the bridge: it types
 * them for the audio layer, adds the two things only a live graph needs (send
 * levels and the measured calibration), and states the fallbacks out loud.
 *
 * THE PROBLEM THIS FILE SOLVES
 *
 * The mix law is written as MEASURED STEADY-STATE STEM LEVELS — figuration at
 * −19 dBFS, chord at −25, and so on. The offline renderer can satisfy that
 * directly: render each stem, measure it, apply the trim that lands it on
 * target. A live graph cannot. It has not played the music yet, and the
 * obvious workaround — meter the bus and chase the target — is a compressor
 * wearing a disguise; it would flatten the very macro arc that Slice A4 exists
 * to shape.
 *
 * So the live graph reads the renderer's measurement. `render-score.mjs`
 * writes `public/samples/calibration.json` on every run: per lens, the stem
 * trims it measured and the integrated loudness the mix arrived at. The live
 * graph applies those as static faders. One measurement, two consumers — the
 * same arrangement that `schedule.mjs` makes for the notes.
 */

import {
  masterTrimDb,
  REVERB,
  reverbDecaySeconds,
  ROLE_SENDS,
  ROLE_SHAPING,
  STEM_TARGETS_DBFS,
  STEM_TOLERANCE_DB,
} from '../../../scripts/lib/mixlaw.mjs';
import type { VoiceRole } from '../mapping/index.ts';
import { samplesBase } from './assetBase.ts';

export { ROLE_SHAPING, STEM_TARGETS_DBFS, STEM_TOLERANCE_DB };
/**
 * THE MASTER FADER, imported rather than restated.
 *
 * `min(loudness trim, peak-safe trim to −1.0 dBFS)`. Slice B3, Ruling 1: this is
 * the one place the number is defined, and the live graph and `render-score.mjs`
 * both call it. The whole reason the app shipped clipping is that the two paths
 * each had their own idea of what the master fader was.
 */
export { masterTrimDb };
export type { MasteringConfig, EqLane } from './samplerLenses.ts';

/**
 * How much of each role goes into its own share of the space.
 *
 * SLICE B4 — IMPORTED, NOT RESTATED. This table used to be written out here
 * "to the digit" from `render-score.mjs`, and the first time it was written from
 * memory the live mix came back with chord 6 dB and lead 5 dB under their
 * targets while ground and weather sat exactly on theirs. A per-role error is
 * what a per-role constant that disagrees with the renderer's looks like from
 * the outside. It is now one table in `mixlaw.mjs`, the way B3 made the master
 * fader one function.
 *
 * "Motion in front, vastness behind": the bed is bathed, the figuration is only
 * touched, so the moving parts stay legible instead of smearing into the pad
 * they are meant to be heard over.
 *
 * THE SPACE IS PER ROLE, NOT SHARED. The mix law is stated as measured stem
 * levels, and the renderer's stems each carry their own reverb — so a live
 * graph with one shared reverb bus is not measuring, or mixing, the same thing.
 */
export const SEND_LEVELS: Record<VoiceRole, { reverb: number; delay: number }> = ROLE_SENDS;

/**
 * THE ROOM, in the units a live graph needs.
 *
 * `REVERB.combFeedback` is a comb feedback coefficient — the offline Schroeder
 * network's own knob — and `Tone.Reverb` wants an RT60 in seconds, so the
 * seconds are DERIVED from the coefficient rather than typed in beside it. Until
 * B4 they were typed in: the renderer's tail was ~1.5 s and this graph's was
 * 8 s, from the same ratified word "reverb". `REVERB.dampHz` is the one-pole
 * darkening the offline tail gets, and it is applied here as a lowpass on the
 * reverb's own output so both rooms are dark by the same number.
 */
export { REVERB, reverbDecaySeconds };

/** The master highpass, shared with the renderer. */
export { MASTER } from '../../../scripts/lib/mixlaw.mjs';

/** What the renderer measured, per lens. */
export interface LensCalibration {
  /** dB to apply to each role's stem so it lands on the mix law's target. */
  stemTrimDb: Partial<Record<VoiceRole, number>>;
  /** Integrated loudness of the resulting mix at unity master, in LUFS. */
  measuredLufs: number;
  /**
   * Peak of the same unity-master mix, in dBFS — the half of the fader a
   * loudness number cannot tell you. Optional because a calibration written
   * before Slice B3 does not carry it; a graph reading such a file falls back to
   * the loudness trim alone and is, correctly, no worse than it was.
   */
  measuredPeakDbfs?: number;
  /** Which score this was measured on — so a stale number can be spotted. */
  measuredOn?: string;
}

export interface MixCalibration {
  generatedBy: string;
  lenses: Record<string, LensCalibration>;
}

/**
 * The fallback when a lens has never been calibrated.
 *
 * Deliberately NOT silence and NOT zero. Zero trim would play the raw sum of
 * the instrument levels, which is the v1 render — the chord bed at −7.6 dBFS
 * swallowing everything. These are the mix law's own targets expressed against
 * a −20 dBFS nominal stem, which puts the hierarchy in roughly the right shape
 * while being obviously an approximation. `_fallback` is a lens id no real lens
 * can collide with, and the harness reports when it is in use rather than
 * quietly playing an unlevelled mix.
 */
export const FALLBACK_STEM_REFERENCE_DBFS = -20;

/** Peak-over-loudness of the peakiest lens measured at B2. See below. */
export const FALLBACK_CREST_DB = 21;

export const DEFAULT_CALIBRATION: MixCalibration = {
  generatedBy: 'fallback (no calibration.json — run `npm run render` to measure)',
  lenses: {
    _fallback: {
      stemTrimDb: {
        ground: STEM_TARGETS_DBFS.ground - FALLBACK_STEM_REFERENCE_DBFS,
        chord: STEM_TARGETS_DBFS.chord - FALLBACK_STEM_REFERENCE_DBFS,
        figuration: STEM_TARGETS_DBFS.figuration - FALLBACK_STEM_REFERENCE_DBFS,
        lead: STEM_TARGETS_DBFS.lead - FALLBACK_STEM_REFERENCE_DBFS,
        weather: STEM_TARGETS_DBFS.weather - FALLBACK_STEM_REFERENCE_DBFS,
      },
      measuredLufs: -18,
      /**
       * The fallback's peak, stated rather than assumed.
       *
       * An uncalibrated lens has no measurement, and "no measurement" must not
       * quietly mean "no peak guard" — that is the failure mode Ruling 1 exists
       * to close. 21 dB is the WIDEST crest factor measured across the five
       * lenses at B2 (pulse: +8.7 dBFS peak over −12.3 LUFS at unity master),
       * so an unknown lens is treated as the peakiest known one. It plays a few
       * dB quiet and it does not clip, which is the right way round for a number
       * nobody has measured.
       */
      measuredPeakDbfs: -18 + FALLBACK_CREST_DB,
    },
  },
};

/** True when the player is running on the approximation rather than a measurement. */
export function isCalibrated(calibration: MixCalibration, lensId: string): boolean {
  return Boolean(calibration.lenses[lensId]);
}

/**
 * Fetch `calibration.json`, falling back rather than failing.
 *
 * A missing calibration should not stop the music. It should make the mix
 * approximate and say so — which is what `isCalibrated` is for.
 */
export async function loadCalibration(baseUrl = samplesBase()): Promise<MixCalibration> {
  try {
    const response = await fetch(`${baseUrl}/calibration.json`);
    if (!response.ok) return DEFAULT_CALIBRATION;
    const parsed = (await response.json()) as MixCalibration;
    if (!parsed?.lenses) return DEFAULT_CALIBRATION;
    return { ...parsed, lenses: { ...DEFAULT_CALIBRATION.lenses, ...parsed.lenses } };
  } catch {
    return DEFAULT_CALIBRATION;
  }
}
