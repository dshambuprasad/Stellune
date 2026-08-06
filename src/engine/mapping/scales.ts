/**
 * Layer 2 — the musical scales pitches may be quantized to.
 *
 * Quantization is the single biggest lever between "data beeps" and "music":
 * once every voice is a member of one scale, any combination of stars is
 * consonant. Nothing else in the sound design matters as much.
 *
 * Semitone offsets from the root. All modes here avoid the tritone and the minor
 * second against the root, so stacked sustained voices stay calm.
 */

export type ScaleName =
  | 'minor-pentatonic'
  | 'major-pentatonic'
  | 'aeolian'
  | 'dorian'
  | 'lydian';

const SCALE_DEGREES: Record<ScaleName, readonly number[]> = {
  // The default mood: no semitone clashes at all, drones beautifully.
  'minor-pentatonic': [0, 3, 5, 7, 10],
  'major-pentatonic': [0, 2, 4, 7, 9],
  // Natural minor — more colour, still no tritone against the root.
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  // Minor with a raised sixth: gentler, more open than Aeolian.
  dorian: [0, 2, 3, 5, 7, 9, 10],
  // Bright and floating; the #4 is against the root's fifth, not the root.
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export const SCALE_NAMES = Object.keys(SCALE_DEGREES) as ScaleName[];

export function isScaleName(name: string): name is ScaleName {
  return Object.prototype.hasOwnProperty.call(SCALE_DEGREES, name);
}

/**
 * Semitone offsets for a scale.
 *
 * Throws on an unknown name rather than substituting a default: the scale comes
 * from developer-supplied config, and silently playing a different mode than the
 * one asked for is the kind of quiet wrongness this layer exists to prevent.
 */
export function scaleDegrees(name: string): readonly number[] {
  if (!isScaleName(name)) {
    throw new Error(
      `Cosmophony: unknown scale ${JSON.stringify(name)}. ` +
        `Available scales: ${SCALE_NAMES.join(', ')}.`,
    );
  }
  return SCALE_DEGREES[name];
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Pitch-class name of a MIDI note ("A" for 45, 57, 69…). */
export function pitchClassName(midi: number): string {
  const index = ((Math.round(midi) % 12) + 12) % 12;
  return PITCH_CLASSES[index] as string;
}
