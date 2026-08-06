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

export interface LensDefinition {
  title: string;
  /** Which reference this lens is an homage to (MUSICAL_VISION §5). */
  homage: string;
  palette: string;
  roles: Record<VoiceRole, LensVoicing[]>;
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
  const lens = config.lenses[lensId];
  if (!lens) {
    throw new Error(`unknown lens "${lensId}" — have ${Object.keys(config.lenses).join(', ')}`);
  }
  const chain = lens.roles[role];
  if (!chain || chain.length === 0) throw new Error(`lens "${lensId}" has no role "${role}"`);

  let fallback: ChosenVoice | null = null;
  for (const link of chain) {
    const entry = manifest.instruments[link.instrument];
    if (!entry || entry.samples.length === 0) continue;

    let best = entry.samples[0] as SampleEntry;
    for (const sample of entry.samples) {
      if (Math.abs(sample.midi - midi) < Math.abs(best.midi - midi)) best = sample;
    }
    const shiftSemitones = midi - best.midi;
    const voice: ChosenVoice = {
      instrument: link.instrument,
      entry,
      sample: best,
      shiftSemitones,
      rate: 2 ** (shiftSemitones / 12),
      gainDb: (link.gainDb ?? 0) + entry.levelDb,
    };
    if (Math.abs(shiftSemitones) <= (link.maxShiftSemitones ?? 12)) return voice;
    fallback = voice;
  }
  if (!fallback) throw new Error(`lens "${lensId}" role "${role}": no usable instrument`);
  return fallback;
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
