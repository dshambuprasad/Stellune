/**
 * Layer 2 — sonification / mapping: the musical vocabulary.
 *
 * Pure, typed, serializable. No Tone.js, no DOM, no Web Audio. A `MusicalScore`
 * is the contract between "what the sky is" and "what it sounds like" — it must
 * be fully describable as JSON so it can be snapshot-tested and diffed.
 */

/** Everything an author can tweak about how a sky becomes music. */
export interface MappingConfig {
  /** Scale name, e.g. "minor-pentatonic". Pitches are always quantized to it. */
  scale: string;
  /** MIDI note number of the key root. */
  rootMidi: number;
  /** How many of the brightest visible objects become voices, e.g. 8. */
  maxVoices: number;
  /** Length of one seamless loop, in seconds, e.g. 18. */
  loopSeconds: number;
  /** Seed for ANY pseudo-randomness. Same seed ⇒ same score, always. */
  seed?: number;
}

/** Timbre shaped by a star's B–V colour index. */
export interface TimbreParams {
  /** 0..1 — cool/red stars score high; mellower, rounder tone. */
  warmth: number;
  /** 0..1 — hot/blue stars score high; glassier, brighter tone. */
  brightness: number;
}

/**
 * Which of the five performance roles a sound belongs to (Musical Vision §3).
 *
 * `figuration` is the role the Vision called PULSE, renamed in Slice A3. The old
 * name was part of why it stayed dormant: a *pulse* is a beat, and the lesson
 * that percussion flattens the emotion got over-read into "no meso layer at
 * all". What the handpan reference actually shows is that a soft cyclic weave
 * hypnotises where a beat demands — so the role now says what it is.
 */
export type VoiceRole = 'ground' | 'chord' | 'figuration' | 'lead' | 'weather';

/**
 * What real thing caused this note — the truth claim, made auditable.
 *
 * Every event carries one. It costs a few bytes and buys three things: a
 * reviewer can re-derive any note by hand, the visual layer can glow exactly the
 * star that is speaking, and "structure is true" stops being a promise and
 * becomes a queryable property of the output.
 */
export interface EventOrigin {
  kind: 'rise' | 'culmination' | 'set' | 'visible' | 'constellation' | 'ground' | 'gesture';
  /** The catalogue id of the star responsible, when there is one. */
  starId?: string;
  /** Constellation abbreviation, for motif events (Slice A1b). */
  constellation?: string;
  /**
   * When this happened in SKY time — seconds of real sky elapsed since the
   * session's origin instant. Divide by the session's compression to get piece
   * time; multiply nothing to check it against an ephemeris by hand.
   */
  skySeconds: number;
}

/** One point on a slow amplitude curve. */
export interface AmplitudeBreakpoint {
  atSeconds: number;
  amplitude: number;
}

export interface MusicalEvent {
  /** Which object produced this voice (e.g. a `Star.id`). */
  sourceId: string;
  /** Which performance role this sound belongs to. */
  role: VoiceRole;
  /** Pitch as a MIDI note number, quantized to the configured scale. */
  midi: number;
  /** 0..1, from apparent magnitude (brighter = louder, gently compressed). */
  amplitude: number;
  /** −1..1, from azimuth (east ↔ west becomes left ↔ right). */
  pan: number;
  /** From B–V colour. */
  timbre: TimbreParams;
  /** 0..1 modulation depth, from low altitude (horizon stars scintillate more). */
  twinkle: number;
  /**
   * Onset in ABSOLUTE piece time, seconds since the session began.
   *
   * (For the static single-instant `sonify()` this is 0, as before.)
   */
  startSeconds: number;
  /**
   * Sounding length in seconds. May extend past the end of the window that
   * carried it — a chord voice can sustain for tens of minutes.
   */
  durationSeconds: number;
  /** Slow amplitude curve over the event's life, for swelling chord voices. */
  envelope?: AmplitudeBreakpoint[];
  /** Groups a statement with its answer (Slice A1b). */
  phraseId?: string;
  /** Which constellation motif this note belongs to (Slice A1b). */
  motifId?: string;
  /** The real event that caused this sound. */
  origin: EventOrigin;
}

/** The complete, deterministic musical description of one sky (or one system). */
export interface MusicalScore {
  events: MusicalEvent[];
  /** Human-readable key, e.g. "A minor-pentatonic". */
  key: string;
  loopSeconds: number;
  meta: {
    /** Objects considered. */
    objectCount: number;
    /** Objects that were actually above the horizon. */
    visibleCount: number;
    /** Honest label for the UI, e.g. "Bengaluru · 1993-08-01 · 8 stars". */
    label: string;
  };
}

// ---------------------------------------------------------------------------
// Living Sky — the streaming, evolving piece (design: docs/LIVING_SKY_DESIGN.md)
// ---------------------------------------------------------------------------

/** Which shape a session takes. */
export type SessionMode = 'birth-sky' | 'endless';

/** Where in the composed arc a moment sits. `endless` never leaves its stage. */
export type ArcStage =
  | 'opening'
  | 'gathering'
  | 'building'
  | 'bloom'
  | 'release'
  | 'closing'
  | 'endless';

/**
 * The sky's own statistics, measured — never invented. These select the
 * emotional weather (Musical Vision §2.3).
 */
export interface SkyWeather {
  /** Catalogue stars above the horizon. */
  visibleCount: number;
  /** Σ 10^(−0.4·mag) over visible stars — total light, linear. */
  integratedBrightness: number;
  /** Magnitude of the brightest star up; +99 when the sky is empty. */
  brightestMag: number;
  /** Mean angular distance from the brightness centroid, degrees. */
  spread: number;
  /** 0..1 — how concentrated the visible stars are (a Milky Way proxy). */
  clustering: number;

  // ---- the three dials everything downstream reads
  /** 0..1 — how much is up and how bright. Drives layers and note budget. */
  density: number;
  /** 0..1 — how brilliant. Drives register span and mode choice. */
  luminosity: number;
  /** 0..1 — the inverse of density. Drives silence and solo behaviour. */
  solitude: number;
}

/** Where the piece is in its arc at a given moment. */
export interface ArcState {
  stage: ArcStage;
  /** Normalised session position 0..1. Always 0 in endless mode. */
  u: number;
  /** 0..1 — how much of the layer stack is sounding. */
  intensity: number;
}

/** A window of the stream: everything that STARTS in [fromSeconds, toSeconds). */
export interface ScoreWindow {
  fromSeconds: number;
  toSeconds: number;
  /** Events may extend past `toSeconds`; a chord voice can last many minutes. */
  events: MusicalEvent[];
  key: string;
  scale: string;
  rootMidi: number;
  /** Sky-seconds per listening-second for this session. */
  kappa: number;
  /** Sampled at `fromSeconds`. */
  weather: SkyWeather;
  /** Sampled at `fromSeconds`. */
  arc: ArcState;
  meta: {
    objectCount: number;
    visibleCount: number;
    label: string;
  };
}

/** Everything a Living Sky session can be tuned by. */
export interface LivingSkyConfig extends MappingConfig {
  mode: SessionMode;
  /** Birth-sky only: total length of the composed arc. */
  sessionSeconds: number;
  /** Endless mode uses this directly; birth-sky solves for one in the band. */
  kappa: number;
  kappaBand: [number, number];
  /** The pace the solver is drawn toward. */
  preferredKappa: number;
  /** Where in the session the cathartic bloom should land. */
  bloomFraction: number;

  /** Magnitude limits for each pool. */
  chordMagLimit: number;
  leadMagLimit: number;
  bloomMagLimit: number;

  /** Altitude over which a chord voice is lifted an octave, degrees. */
  octaveLiftDegrees: number;
  /** Altitude over which a chord voice reaches full amplitude, degrees. */
  horizonFadeDegrees: number;
  /** Seconds between amplitude breakpoints on a swelling voice. */
  envelopeStepSeconds: number;
  /** Circumpolar voices are cut into segments this long, on an absolute grid. */
  circumpolarSegmentSeconds: number;

  /** The Conductor. */
  phraseSeconds: number;
  lookbackPhrases: number;
  minNoteGapSeconds: number;
  /** How far above the chord register the lead sits, in octaves. */
  leadOctaveOffset: number;

  /** The opening and closing gesture. */
  gestureSeconds: number;
  gatheringSeconds: number;
  closingSeconds: number;

  /** A constellation must clear this mean altitude to be worth speaking of. */
  constellationAltitudeThreshold: number;
  /**
   * How the opening (and closing) anchor is chosen. Three settings so they can
   * be compared by ear:
   *
   *   'brightest'          the brightest star up at t = 0. Truest to the Vision's
   *                        wording, but it may be setting — on Shambu's own sky
   *                        Arcturus qualifies and then vanishes 16 s in.
   *   'survives-gathering' the brightest that is still up when the sky has
   *                        finished answering (HQ's ruling).
   *   'bookends'           as above, and still up at the close, so the
   *                        one → all → one mirror can actually complete.
   */
  openingAnchorRule: 'brightest' | 'survives-gathering' | 'bookends';
  /** Fraction of the session the anchor must survive (the GATHERING stage). */
  openingStarMinVisibleFraction: number;

  // ---- the FIGURATION layer (Slice A3): the meso timescale
  /** Positions in one repeating cycle. */
  figurationSlots: number;
  /** Seconds per slot. Slots × this is the cycle length. */
  figurationSlotSeconds: number;
  /** Fewest and most slots that may sound; density rides the arc between them. */
  figurationMinActive: number;
  figurationMaxActive: number;
  /** Level relative to the chord — the figuration sits UNDER the lead. */
  figurationGain: number;
  /** Deterministic timing drift, so the weave never clicks on a grid. */
  figurationHumanizeSeconds: number;
  /** How long one figuration note rings. */
  figurationNoteSeconds: number;
  /** Register centre, in octaves above the root, at lowest and highest energy. */
  figurationRegisterLowOctave: number;
  figurationRegisterHighOctave: number;
  /** Note-rate change the layer may not exceed, notes per second per second. */
  figurationMaxRateStep: number;

  // ---- the FORM layer (Slice A4): movements, transitions, ostinato
  /** Shortest and longest a movement body may run. */
  movementMinSeconds: number;
  movementMaxSeconds: number;
  /** How far before its anchor a movement begins, so it arrives at the structure. */
  movementLeadInSeconds: number;
  /** Transition zones sit in this band, chosen deterministically per seam. */
  transitionSecondsRange: [number, number];
  /** How long the bloom movement is given to build before the climax. */
  bloomBuildSeconds: number;
  /** The movement's motif replays as the section groove every N cycles. */
  ostinatoEveryCycles: number;
  /** The bloom adds one Zimmer layer every N cycles, then strips in reverse. */
  bloomLayerEveryCycles: number;
  /** Most layers the bloom may stack. */
  bloomMaxLayers: number;
  /** Note-rate change per cycle the form may not exceed, notes/s. */
  formMaxRateStep: number;

  /** Continuous roles are emitted on this absolute grid. */
  continuousSegmentSeconds: number;
  /** Slow modulator periods; mutually incommensurate (§11). */
  modulatorPeriods: number[];
}
