/**
 * Slice B1 — THE SCHEDULE, computed once and shared.
 *
 * Turning a score event into "which instrument, at what pitch, how loud, panned
 * where" is the one calculation the live Tone graph and the offline renderer
 * absolutely must agree on. B0 already made them share the lens *config*; this
 * makes them share the *derivation*.
 *
 * The alternative — two implementations plus a test asserting they match — was
 * considered and rejected. A parity test only tells you the day they diverge;
 * one function means they cannot. So this file is plain ESM with no imports of
 * its own, importable by `render-score.mjs` directly and by the TypeScript audio
 * layer through `schedule.d.mts`.
 *
 * It is pure: no Tone, no Web Audio, no filesystem, no clock. Given the same
 * score, lens config and manifest it returns the same array forever, which is
 * also what makes it testable without a browser.
 */

/**
 * How far a note may be resampled before it stops sounding like the instrument.
 *
 * Slice B1.1, from measurement. The live path resamples with the browser's own
 * `playbackRate`, which is linear interpolation; the offline path uses 4-point
 * Hermite. At small shifts the two are indistinguishable, but at +5 and beyond
 * the linear one images badly — bright, sharp, and nothing like the recording.
 * That is the difference between "offline clean, live defective" on the SAME
 * score, and the B1.1 log found far shifts clustered in two of the three
 * windows Shambu flagged.
 *
 * Three semitones is a quarter-tone shy of a minor third: enough that a modest
 * sample set is affordable, tight enough that a struck instrument's transient
 * and a sustained one's formants stay where they belong.
 */
export const MAX_SHIFT_SEMITONES = 3;

/**
 * The register every lens must be able to play, MIDI.
 *
 * Stated once, here, and applied before any instrument is chosen — which is
 * what keeps it lens-INDEPENDENT. A pitch outside it is folded by whole
 * octaves until it is inside, so the pitch class (and therefore the scale) is
 * untouched and every lens folds identically.
 *
 * Folding per instrument was the obvious alternative and is wrong: each lens's
 * instruments have different ceilings, so the same score event would sound an
 * octave apart in two lenses. "A lens changes what a note sounds like, never
 * which note it is" is a ratified invariant, and a fix that breaks it is not a
 * fix.
 */
export const PLAYABLE_MIDI_RANGE = [24, 96];

/** Fold a pitch into a range by whole octaves. Pitch class is preserved. */
export function foldIntoRange(midi, [lo, hi] = PLAYABLE_MIDI_RANGE) {
  let folded = midi;
  while (folded < lo) folded += 12;
  while (folded > hi) folded -= 12;
  // A range narrower than an octave cannot always be satisfied; clamp so the
  // function is total rather than looping.
  return Math.max(lo, Math.min(hi, folded));
}

/** Roles, in the order the mix law lists them. */
export const SCHEDULE_ROLES = ['ground', 'chord', 'figuration', 'lead', 'weather'];

/**
 * Per-role amplitude shaping the mix law mandates, mirrored from `mixlaw.mjs`.
 *
 * Kept as a parameter rather than an import so this module stays dependency-free
 * and a caller can render a comparison with shaping off.
 */
export const DEFAULT_ROLE_SHAPING = {
  ground: { velocityCompress: 1 },
  chord: { velocityCompress: 1 },
  figuration: { velocityCompress: 0.5 },
  lead: { velocityCompress: 0.75 },
  weather: { velocityCompress: 1 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Round so two independently-computed schedules compare exactly. */
const round = (v, places) => {
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * The pitch a role actually sounds at.
 *
 * `registerHint` is carried by the event itself (Slice B1, mapping side): the
 * score says how far a role must be moved to stay out of another's register,
 * so no renderer has to remember. Weather carries +12; before that hint existed,
 * ground and weather both sounded midi 45 for an entire session.
 */
export function voicedMidi(event, range = PLAYABLE_MIDI_RANGE) {
  return foldIntoRange(event.midi + (event.registerHint ?? 0), range);
}

/**
 * The B–V tilt for one event, in dB of high shelf above `shading.hingeHz`.
 *
 * NOT a level. A hot blue star is voiced BRIGHTER, not louder, and the two are
 * not interchangeable: adding this to the gain would make the sky's colour
 * fight the mix law for the same fader. So it travels as its own field and the
 * consumers apply it as a shelf — a one-pole in the renderer, a BiquadFilter
 * live.
 */
export function shadingTilt(shading, timbre) {
  if (!shading) return 0;
  const brightness = timbre?.brightness ?? shading.neutralBrightness;
  return shading.tiltDb * (brightness - shading.neutralBrightness) * 2;
}

/**
 * Choose the instrument for one note.
 *
 * Walks the lens's chain for the role and takes the first instrument whose
 * nearest recorded note is within its leash, falling through to the last link
 * otherwise. Pitch is always reached by resampling — a lens changes what a note
 * sounds like, never which note it is.
 */
export function chooseVoiceFor(lenses, manifest, lensId, role, midi) {
  const lens = lenses.lenses[lensId];
  if (!lens) {
    throw new Error(`unknown lens "${lensId}" — have ${Object.keys(lenses.lenses).join(', ')}`);
  }
  const chain = lens.roles[role];
  if (!chain || chain.length === 0) throw new Error(`lens "${lensId}" has no role "${role}"`);

  // The chain is walked twice. First pass: take the earliest link that can
  // reach this pitch INSIDE THE SHIFT CAP — the lens's preference wins, but
  // only among instruments that will actually sound like themselves. Second
  // pass (`fallback`): the link that gets closest, for a pitch no instrument in
  // the chain can cover; the caller logs those, and the lens config is the
  // place to fix them, not the renderer.
  let fallback = null;
  for (const link of chain) {
    const entry = manifest.instruments[link.instrument];
    if (!entry || entry.samples.length === 0) continue;

    let best = entry.samples[0];
    for (const sample of entry.samples) {
      if (Math.abs(sample.midi - midi) < Math.abs(best.midi - midi)) best = sample;
    }
    const shiftSemitones = midi - best.midi;
    const voice = {
      instrument: link.instrument,
      sampleMidi: best.midi,
      sampleFile: best.ogg ?? null,
      shiftSemitones,
      rate: 2 ** (shiftSemitones / 12),
      // The lens's voicing offset PLUS the instrument's loudness match, so a
      // role that falls through mid-phrase does not lurch in level.
      gainDb: (link.gainDb ?? 0) + (entry.levelDb ?? 0),
      // Playback shape, straight from the manifest. Both consumers need it and
      // neither should be re-deriving it: a sustained instrument loops to hold,
      // a struck one rings out and stops.
      kind: entry.kind,
      attackSeconds: entry.attackSeconds,
      loopStart: entry.loop?.start ?? null,
      loopEnd: entry.loop?.end ?? null,
    };
    const leash = Math.min(link.maxShiftSemitones ?? MAX_SHIFT_SEMITONES, MAX_SHIFT_SEMITONES);
    if (Math.abs(shiftSemitones) <= leash) return voice;
    if (fallback === null || Math.abs(shiftSemitones) < Math.abs(fallback.shiftSemitones)) {
      fallback = voice;
    }
  }
  if (!fallback) throw new Error(`lens "${lensId}" role "${role}": no usable instrument`);
  return fallback;
}

/**
 * Build the full schedule for a set of score events under one lens.
 *
 * Returns one entry per event, in a stable order (time, then role, then source),
 * so two runs — or two consumers — compare element by element.
 *
 * Amplitude is expressed in dB relative to the event's own amplitude, so a
 * consumer can apply it to a sampler's velocity or to a gain node without
 * having to re-derive the shaping.
 */
export function buildSchedule(events, lenses, manifest, lensId, options = {}) {
  const shaping = options.roleShaping ?? DEFAULT_ROLE_SHAPING;
  const shading = options.shading ?? lenses.shading;

  const out = [];
  for (const event of events) {
    if (!SCHEDULE_ROLES.includes(event.role)) continue;

    const midi = voicedMidi(event);
    const voice = chooseVoiceFor(lenses, manifest, lensId, event.role, midi);

    const compress = shaping[event.role]?.velocityCompress ?? 1;
    const velocity = clamp(Math.pow(clamp(event.amplitude, 0, 1), compress), 0, 1);

    out.push({
      role: event.role,
      sourceId: event.sourceId,
      startSeconds: round(event.startSeconds, 4),
      durationSeconds: round(event.durationSeconds, 4),
      midi,
      instrument: voice.instrument,
      sampleMidi: voice.sampleMidi,
      sampleFile: voice.sampleFile,
      rate: round(voice.rate, 6),
      velocity: round(velocity, 5),
      gainDb: round(voice.gainDb, 3),
      tiltDb: round(shadingTilt(shading, event.timbre), 3),
      pan: round(clamp(event.pan ?? 0, -1, 1), 4),
      // Composed data, carried rather than re-derived. The envelope is the
      // star's altitude arc — a rising star swells, a setting one fades — and
      // twinkle is its real scintillation. Both belong to the score, so both
      // travel with the schedule and both consumers apply the same numbers.
      envelope: event.envelope ?? null,
      twinkle: round(clamp(event.twinkle ?? 0, 0, 1), 4),
      kind: voice.kind,
      attackSeconds: voice.attackSeconds,
      loopStart: voice.loopStart,
      loopEnd: voice.loopEnd,
    });
  }

  out.sort(
    (a, b) =>
      a.startSeconds - b.startSeconds ||
      SCHEDULE_ROLES.indexOf(a.role) - SCHEDULE_ROLES.indexOf(b.role) ||
      (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0) ||
      a.midi - b.midi,
  );
  return out;
}

/**
 * How many voices of each role sound at each moment, on a control grid.
 *
 * The mix law normalises the chord bed by the number of voices sounding AT THAT
 * MOMENT — not the section's maximum, which is what left the bed 6 dB hot as the
 * sky filled. Returned as a grid so the live graph can automate a gain along it
 * and the renderer can apply it per sample, from the same numbers.
 */
export function concurrencyGrid(schedule, role, fromSeconds, toSeconds, stepSeconds) {
  const steps = Math.max(1, Math.ceil((toSeconds - fromSeconds) / stepSeconds));
  const counts = new Array(steps + 1).fill(0);
  const inRole = schedule.filter((s) => s.role === role);

  for (let i = 0; i <= steps; i++) {
    const t = fromSeconds + i * stepSeconds;
    let n = 0;
    for (const s of inRole) {
      if (s.startSeconds <= t && s.startSeconds + s.durationSeconds > t) n++;
    }
    counts[i] = n;
  }
  return { fromSeconds, stepSeconds, counts };
}

/**
 * Slew a concurrency grid into the gain the mix law asks for: 1/sqrt(N),
 * smoothed so voices entering and leaving glide rather than step.
 */
export function concurrencyGains(grid, slewSeconds = 2.0) {
  const alpha = Math.exp(-grid.stepSeconds / Math.max(1e-6, slewSeconds));
  const gains = new Array(grid.counts.length);
  let smoothed = Math.max(1, grid.counts[0] ?? 1);
  for (let i = 0; i < grid.counts.length; i++) {
    const n = Math.max(1, grid.counts[i] ?? 1);
    smoothed = n + (smoothed - n) * alpha;
    gains[i] = round(1 / Math.sqrt(smoothed), 6);
  }
  return gains;
}
