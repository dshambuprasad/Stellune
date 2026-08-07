/**
 * Slice B0 — the MOOD LENS contract, typed.
 *
 * Instrument = MOOD LENS (the user's choice) × ROLE (ground / chord /
 * figuration / lead / weather), shaded by the star's real B–V colour. Never
 * per-object — see MUSICAL_VISION §5 and PRODUCT_WALKTHROUGH "Instrument logic".
 *
 * The data itself lives in `public/samples/lenses.json`, NOT in this file. That
 * is deliberate: the offline renderer (`scripts/render-score.mjs`) has to make
 * exactly the same instrument choices as the live app, and it is a Node script
 * that cannot import TypeScript. One JSON file read by both is the only way the
 * two stay honest with each other. This module types it, validates it, and
 * holds the pure voicing rules; nothing here touches Tone.js or Web Audio.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT: switching lenses changes timbre
 * and nothing else. Same pitches, same onsets, same durations. The Phase 3.5
 * style-invariance test extends to moods, and `scripts/check-mix-law.mjs`
 * asserts it across all five lenses on every run.
 */

import { chooseVoiceFor } from '../../../scripts/lib/schedule.mjs';
import type { TimbreParams, VoiceRole } from '../mapping/index.ts';

/** One instrument in a role's fall-through chain. */
export interface LensVoicing {
  /** Instrument id — a key of the sample manifest. */
  instrument: string;
  /**
   * How far this instrument may be pitch-shifted from its nearest recorded note
   * before the bank falls through to the next one in the chain. A two-note
   * handpan stretched across four octaves stops sounding like a handpan; this
   * is the leash.
   */
  maxShiftSemitones?: number;
  /** Per-lens voicing offset, applied before the mix law's stem trims. */
  gainDb?: number;
}

/**
 * One role's EQ lane — THE MASTERING LAW's half of the mix.
 *
 * The mix law levels the stems; it does not stop them occupying the same
 * spectrum. Five roles can each hit their dBFS target and still pile into
 * 200–800 Hz, where the ear cannot separate them, which is what a musician's
 * review of the B0 clips found: correct levels, muddy result. So every lens
 * declares where each role lives, and the pads are CARVED where the moving
 * parts sing rather than the moving parts being pushed louder.
 *
 * The dip is the load-bearing part: a −5 dB notch in the chord bed at 2 kHz
 * costs the pad almost nothing (its energy is an octave lower) and hands the
 * figuration a clear window it did not have to shout through.
 */
export interface EqLane {
  /** Everything below this is gone. Keeps roles out of each other's mud. */
  highpassHz?: number;
  lowShelf?: { hz: number; db: number };
  /** The carve. Negative dB on a pad; where the motion lives. */
  dip?: { hz: number; db: number; q?: number };
  highShelf?: { hz: number; db: number };
}

export interface LensDefinition {
  title: string;
  /** Which reference this lens is an homage to (MUSICAL_VISION §5). */
  homage: string;
  palette: string;
  roles: Record<VoiceRole, LensVoicing[]>;
  /** Per-role spectral lanes. Documented per lens in `_curve`. */
  eq?: Partial<Record<VoiceRole, EqLane>>;
}

/**
 * THE MASTERING LAW's global half — loudness, glue, and the limiter's leash.
 *
 * Ratified in Slice B1. Three decisions worth keeping the reasons for:
 *
 *   LUFS, NOT PEAK. Peak normalisation rewards crest factor, not loudness: a
 *   sparse early sky and a full late one can share a peak and differ by 8 dB of
 *   perceived level. Ambient listening wants a stable, quiet floor, so the
 *   master is normalised to −18 LUFS — well under streaming's −14, because this
 *   is music to fall asleep under, not to compete on a playlist.
 *
 *   GLUE ON FIGURATION ONLY. The macro arc IS the composition; Slice A4 spent
 *   itself shaping how the night swells. Compressing the master would undo that.
 *   Figuration alone gets ≤2 dB of slow reduction, to stop individual chimes
 *   poking through — glue, never squash.
 *
 *   THE LIMITER MUST DO NOTHING. It stays in the graph as a safety net and the
 *   check asserts it never engages. A limiter that is working is a mix that is
 *   broken somewhere upstream.
 */
export interface MasteringConfig {
  lufsTargets: { birthSky: number; tonight: number; tolerance: number };
  limiter: {
    ceilingDbfs: number;
    /** Fraction of samples the limiter may be engaged for. */
    maxEngagedFraction: number;
    /** Hard cap on gain reduction, in dB. */
    maxReductionDb: number;
    /** Reduction above this counts as "engaged". */
    engagementThresholdDb: number;
    /**
     * Stems that get NO limiter, so their zero engagement is structural.
     *
     * The ratified amendment permits transient limiting but requires zero gain
     * reduction on the sustained bed. A limiter on the master would reduce
     * every stem at once, so the bed's protection is achieved by not giving it
     * a limiter rather than by asserting one stayed idle.
     */
    zeroEngagementStems: string[];
  };
  figurationGlue: {
    thresholdDb: number;
    ratio: number;
    attackSeconds: number;
    releaseSeconds: number;
    kneeDb: number;
    maxReductionDb: number;
  };
  spectralOverlap: {
    figurationBandHz: [number, number];
    leadBandHz: [number, number];
    padBandHz: [number, number];
    /**
     * How far figuration must lead each pad INSIDE the motion band.
     *
     * Comparative on purpose. "How much of a pad's energy sits in the motion
     * band" was tried first and is unanswerable: a violin section genuinely
     * lives at 700–5000 Hz, so the number condemned a mix that was fine.
     */
    minMotionLeadDb: number;
  };
}

/**
 * The B–V shading hook.
 *
 * Every event already carries `timbre.{warmth,brightness}`, derived by the
 * mapping layer from the star's real B–V colour index. Here that becomes a
 * spectral tilt around `hingeHz`: a hot blue star is voiced brighter, a cool
 * red one darker. Same sample, same pitch, same time — only the colour moves.
 */
export interface ShadingConfig {
  hingeHz: number;
  /** Full-scale swing between brightness 0 and 1, in dB. */
  tiltDb: number;
  neutralBrightness: number;
}

export interface LensConfig {
  version: number;
  roles: VoiceRole[];
  defaults: { tonight: string; birthSky: string };
  shading: ShadingConfig;
  lenses: Record<string, LensDefinition>;
  mastering?: MasteringConfig;
}

/** One recorded note of one instrument. */
export interface SampleEntry {
  note: string;
  midi: number;
  ogg: string;
  mp3: string;
  seconds: number;
  /** Present where the upstream file was not pitch-named and we measured it. */
  measuredHz?: number;
  impactDbfs?: number;
}

export interface InstrumentEntry {
  title: string;
  pack: string;
  licence: string;
  /** 'sustained' notes loop to hold; 'decay' notes are struck and ring out. */
  kind: 'sustained' | 'decay';
  attackSeconds: number;
  loop: { start: number; end: number } | null;
  /** Loudness match, so falling through the chain does not lurch in level. */
  levelDb: number;
  oggBytes: number;
  samples: SampleEntry[];
}

export interface SampleManifest {
  generatedBy: string;
  accessDate: string;
  encode: Record<string, string | number>;
  packs: Record<string, Record<string, string>>;
  instruments: Record<string, InstrumentEntry>;
}

export const LENS_ROLES: readonly VoiceRole[] = [
  'ground',
  'chord',
  'figuration',
  'lead',
  'weather',
] as const;

/**
 * Check a lens config against a built sample manifest.
 *
 * Runs at bank construction rather than at first note: a lens naming an
 * instrument that was never encoded should fail while the screen is still
 * loading, not eight minutes into a session when a rare high lead finally
 * reaches for it.
 */
export function validateLensConfig(config: LensConfig, manifest: SampleManifest): string[] {
  const problems: string[] = [];
  for (const [lensId, lens] of Object.entries(config.lenses)) {
    for (const role of LENS_ROLES) {
      const chain = lens.roles[role];
      if (!chain || chain.length === 0) {
        problems.push(`lens "${lensId}" has no instruments for role "${role}"`);
        continue;
      }
      for (const link of chain) {
        const instrument = manifest.instruments[link.instrument];
        if (!instrument) {
          problems.push(`lens "${lensId}" role "${role}": unknown instrument "${link.instrument}"`);
        } else if (instrument.samples.length === 0) {
          problems.push(`lens "${lensId}" role "${role}": "${link.instrument}" has no samples`);
        }
      }
    }
  }
  return problems;
}

/** The instrument and pitch shift a lens picks for one note of one role. */
export interface ChosenVoice {
  instrument: string;
  entry: InstrumentEntry;
  sample: SampleEntry;
  shiftSemitones: number;
  /** Playback rate to reach the requested pitch from the recorded one. */
  rate: number;
  /** Lens offset plus the instrument's loudness match. */
  gainDb: number;
}

/**
 * Choose the voice for (lens, role, midi).
 *
 * Walks the role's chain and takes the first instrument whose nearest recorded
 * note is inside its leash, falling through to the last link if none fits.
 * Pitch is always reached by resampling, never by substituting a different
 * note — a lens may change what a note sounds like, never which note it is.
 *
 * Pure and synchronous, so the offline renderer, the live bank and the tests
 * all agree by construction.
 */
export function chooseVoice(
  config: LensConfig,
  manifest: SampleManifest,
  lensId: string,
  role: VoiceRole,
  midi: number,
): ChosenVoice {
  // DELEGATED, not reimplemented. This used to be a second copy of the walk,
  // and on 2026-08-10 the two drifted the moment Slice B1.1 added the ±3 shift
  // cap to one of them — `test/schedule.test.ts` caught it on the first run,
  // which is exactly what that test is for. The typed surface below is what the
  // bank wants (the manifest entries, not just their ids); the DECISION comes
  // from the one place that makes it.
  const chosen = chooseVoiceFor(config, manifest, lensId, role, midi) as {
    instrument: string;
    sampleMidi: number;
    shiftSemitones: number;
    rate: number;
    gainDb: number;
  };
  const entry = manifest.instruments[chosen.instrument];
  if (!entry) throw new Error(`schedule chose an instrument the manifest lacks: ${chosen.instrument}`);
  const sample = entry.samples.find((s) => s.midi === chosen.sampleMidi);
  if (!sample) {
    throw new Error(`schedule chose a sample the manifest lacks: ${chosen.instrument}/${chosen.sampleMidi}`);
  }
  return {
    instrument: chosen.instrument,
    entry,
    sample,
    shiftSemitones: chosen.shiftSemitones,
    rate: chosen.rate,
    gainDb: chosen.gainDb,
  };
}

/**
 * The B–V tilt for one event, in dB of high-frequency shelf.
 *
 * Positive brightens (a hot blue star), negative darkens (a cool red one).
 * Zero at `neutralBrightness`, so a colourless event is left exactly alone.
 */
export function shadingTiltDb(shading: ShadingConfig, timbre: TimbreParams | undefined): number {
  const brightness = timbre?.brightness ?? shading.neutralBrightness;
  return shading.tiltDb * (brightness - shading.neutralBrightness) * 2;
}

/**
 * Which instruments a lens needs before it can play a note.
 *
 * The first link of every role is the primary tier — enough to start a session.
 * Later links only matter for notes the primary cannot reach, so the bank can
 * fetch them afterwards without holding up the first sound.
 */
export function instrumentsForLens(
  config: LensConfig,
  lensId: string,
): { primary: string[]; fallback: string[] } {
  const lens = config.lenses[lensId];
  if (!lens) throw new Error(`unknown lens "${lensId}"`);
  const primary = new Set<string>();
  const fallback = new Set<string>();
  for (const role of LENS_ROLES) {
    const chain = lens.roles[role] ?? [];
    chain.forEach((link, index) => {
      (index === 0 ? primary : fallback).add(link.instrument);
    });
  }
  for (const id of primary) fallback.delete(id);
  return { primary: [...primary], fallback: [...fallback] };
}

/**
 * THE MASTERING LAW's defaults, used when a config omits the block.
 *
 * These are the ratified numbers from `public/samples/lenses.json`; duplicating
 * them here is what lets a test build a minimal config without restating the
 * whole law, and the check asserts the two agree.
 */
export const MASTERING_DEFAULTS: MasteringConfig = {
  lufsTargets: { birthSky: -18, tonight: -18, tolerance: 1.0 },
  limiter: {
    ceilingDbfs: -1.0,
    maxEngagedFraction: 0.01,
    maxReductionDb: 3.0,
    engagementThresholdDb: 0.1,
    zeroEngagementStems: ['ground', 'chord'],
  },
  figurationGlue: {
    thresholdDb: -16,
    ratio: 2.0,
    attackSeconds: 0.25,
    // 1.0, not 1.2: Web Audio's DynamicsCompressorNode caps release at one
    // second and throws above it. A law the two paths implement differently is
    // not one law, so the number is what both can honour.
    releaseSeconds: 1.0,
    kneeDb: 6,
    maxReductionDb: 2.0,
  },
  spectralOverlap: {
    figurationBandHz: [700, 5000],
    leadBandHz: [900, 6000],
    padBandHz: [80, 700],
    minMotionLeadDb: 0.0,
  },
};

/** The mastering law in force for a config — its own block, or the defaults. */
export function masteringFor(config: LensConfig): MasteringConfig {
  return { ...MASTERING_DEFAULTS, ...(config.mastering ?? {}) };
}

/**
 * A lens's EQ lane for one role, or an empty lane if it declares none.
 *
 * An absent lane means "no carve" and is a legitimate choice — the `ground`
 * lens is a background listen and is deliberately the least sculpted — so this
 * returns a neutral lane rather than throwing.
 */
export function eqLaneFor(config: LensConfig, lensId: string, role: VoiceRole): EqLane {
  return config.lenses[lensId]?.eq?.[role] ?? {};
}

/**
 * Check the EQ lanes actually separate the roles.
 *
 * The law is not "every lens has an `eq` block" — that would be satisfied by
 * five empty objects. It is that the PADS ARE CARVED WHERE THE MOTION LIVES, so
 * this asserts the relationship: figuration and lead must be highpassed above
 * the pads, and any lens that carves at all must dip its chord bed inside the
 * motion band. `scripts/check-mix-law.mjs` then measures the result in the
 * rendered audio, which is the claim that actually matters.
 */
export function validateEqLanes(config: LensConfig): string[] {
  const problems: string[] = [];
  const { figurationBandHz } = masteringFor(config).spectralOverlap;

  for (const [lensId, lens] of Object.entries(config.lenses)) {
    if (!lens.eq) continue;
    const lane = (role: VoiceRole): EqLane => lens.eq?.[role] ?? {};
    const hp = (role: VoiceRole): number => lane(role).highpassHz ?? 0;

    for (const motion of ['figuration', 'lead'] as const) {
      for (const pad of ['ground', 'chord'] as const) {
        if (hp(motion) <= hp(pad)) {
          problems.push(
            `lens "${lensId}": ${motion} is highpassed at ${hp(motion)} Hz, not above ${pad} at ${hp(pad)} Hz — ` +
              `the moving parts must sit above the bed, not inside it`,
          );
        }
      }
    }

    const dip = lane('chord').dip;
    if (!dip) {
      problems.push(`lens "${lensId}": chord has no dip — nothing is carved for figuration to sing through`);
    } else if (dip.db >= 0) {
      problems.push(`lens "${lensId}": chord dip is ${dip.db} dB, which is a boost, not a carve`);
    } else if (dip.hz < figurationBandHz[0] || dip.hz > figurationBandHz[1]) {
      problems.push(
        `lens "${lensId}": chord dip at ${dip.hz} Hz is outside the motion band ` +
          `${figurationBandHz[0]}–${figurationBandHz[1]} Hz, so it carves where nothing sings`,
      );
    }
  }
  return problems;
}
