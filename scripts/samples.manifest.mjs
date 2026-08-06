/**
 * Slice B0 — the SAMPLE SOURCE MANIFEST.
 *
 * Every bundled sound in `public/samples/` is derived from exactly one entry
 * here. Nothing gets bundled that is not licensed, versioned and hashed, and
 * every source below was read from its AUTHORITATIVE home before it was used
 * (see `docs/ATTRIBUTION_AUDIO.md` for the evidence trail and access dates).
 *
 * Packs are pinned to an immutable ref (a git commit SHA, or an archive whose
 * SHA-256 we record), so `npm run samples:fetch` is reproducible: the same
 * manifest always yields the same bytes.
 *
 * Consumed by `scripts/fetch-samples.mjs`, which downloads, verifies, trims,
 * encodes and writes `public/samples/manifest.json` (the runtime index).
 */

/** Pinned upstream packs. */
export const PACKS = {
  vcsl: {
    id: 'vcsl',
    title: 'Versilian Community Sample Library (VCSL)',
    author: 'Versilian Studios LLC (Sam Gossner)',
    licence: 'CC0-1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    homepage: 'https://github.com/sgossner/VCSL',
    version: 'commit c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e (2026-01-14)',
    commit: 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e',
    raw: (path) =>
      `https://raw.githubusercontent.com/sgossner/VCSL/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/${path}`,
    creditRequired: false,
  },
  vsco2: {
    id: 'vsco2',
    title: 'VSCO 2 Community Edition',
    author: 'Versilian Studios LLC (Sam Gossner) & Bigcat Instruments',
    licence: 'CC0-1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    homepage: 'https://github.com/sgossner/VSCO-2-CE',
    version: 'commit 440300901dfe9275fd84e0b7763af1f8443ae62e (2020-08-05)',
    commit: '440300901dfe9275fd84e0b7763af1f8443ae62e',
    raw: (path) =>
      `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e/${path}`,
    creditRequired: false,
  },
  salamander: {
    id: 'salamander',
    title: 'Salamander Grand Piano V3',
    author: 'Alexander Holm',
    // The author's own page (rytmenpinne.wordpress.com) declares the library
    // public domain as of 2022-03-04; the FreePats distribution we actually
    // downloaded still ships it under CC BY 3.0. We take the STRICTER of the
    // two and carry the credit line — see ATTRIBUTION_AUDIO.md.
    licence: 'CC-BY-3.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
    homepage: 'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html',
    version: 'V3+20161209, 44.1 kHz 16-bit SFZ+WAV distribution',
    archive:
      'https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz',
    archiveSha256:
      '58750eb1366761e187f71ddb9b932355ea894d28ec4331e74ab8acb44c819936',
    archivePrefix: 'SalamanderGrandPianoV3_44.1khz16bit/44.1khz16bit/',
    creditRequired: true,
    credit: 'Salamander Grand Piano V3 by Alexander Holm — CC BY 3.0',
  },
  freesound: {
    id: 'freesound',
    title: 'Freesound (individually-licensed CC0 sounds)',
    author: 'per-sound, see notes',
    licence: 'CC0-1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    homepage: 'https://freesound.org/',
    // Freesound's original-quality download needs an authenticated account;
    // the publicly-served high-quality preview is what we can fetch, so these
    // two sounds are the ONLY lossy-sourced material in the bundle.
    version: 'high-quality public preview renditions (see per-sound sourceUrl)',
    creditRequired: false,
  },
};

/**
 * Instrument definitions.
 *
 * `kind`
 *   'sustained' — the note can be held indefinitely; the trimmed sample carries
 *                 a loop region that the sampler/renderer crossfades forever.
 *   'decay'     — a struck/plucked note that rings out; played once, no loop.
 *
 * `trimSeconds` is the encoded length; `loop` is in seconds within that trim.
 * `notes` maps a scientific pitch name to its upstream path (relative to the
 * pack root). `detectPitch` means the upstream file is not pitch-named and the
 * fetch script measures its fundamental instead (result recorded in the built
 * manifest, so it is auditable).
 */
export const INSTRUMENTS = [
  // ── Sustained bowed strings — CHORD beds and Aurora's swells ──────────────
  {
    id: 'strings-violin',
    pack: 'vsco2',
    title: 'Violin section, sustain vibrato',
    kind: 'sustained',
    trimSeconds: 4.5,
    loop: { start: 1.4, end: 4.2 },
    attackSeconds: 0.35,
    dir: 'Strings/Violin Section/susVib/',
    notes: {
      G2: 'VlnEns_susVib_G2_v1.wav',
      A2: 'VlnEns_susVib_A2_v1.wav',
      B2: 'VlnEns_susVib_B2_v1.wav',
      D3: 'VlnEns_susVib_D3_v1.wav',
      'F#3': 'VlnEns_susVib_F#3_v1.wav',
      C4: 'VlnEns_susVib_C4_v1.wav',
      E4: 'VlnEns_susVib_E4_v1.wav',
      G4: 'VlnEns_susVib_G4_v1.wav',
      B4: 'VlnEns_susVib_B4_v1.wav',
      D5: 'VlnEns_susVib_D5_v1.wav',
    },
  },
  {
    id: 'strings-cello',
    pack: 'vsco2',
    title: 'Cello section, sustain vibrato',
    kind: 'sustained',
    trimSeconds: 4.5,
    loop: { start: 1.4, end: 4.2 },
    attackSeconds: 0.4,
    dir: 'Strings/Cello Section/susvib/',
    notes: {
      C1: 'susvib_C1_v1_1.wav',
      E1: 'susvib_E1_v1_1.wav',
      G1: 'susvib_G1_v1_1.wav',
      B1: 'susvib_B1_v1_1.wav',
      D2: 'susvib_D2_v1_1.wav',
      F2: 'susvib_F2_v1_1.wav',
      A2: 'susvib_A2_v1_1.wav',
      C3: 'susvib_C3_v1_1.wav',
      E3: 'susvib_E3_v1_1.wav',
      G3: 'susvib_G3_v1_1.wav',
      B3: 'susvib_B3_v1_1.wav',
      D4: 'susvib_D4_v1_1.wav',
    },
  },
  {
    id: 'contrabass',
    pack: 'vsco2',
    title: 'Solo contrabass, sustain vibrato — the GROUND drone',
    kind: 'sustained',
    trimSeconds: 4.5,
    loop: { start: 1.5, end: 4.2 },
    attackSeconds: 0.5,
    dir: 'Strings/Solo Contrabass/SusVib/',
    notes: {
      'F#0': 'BKCtbss_SusVib_F#0_v1_rr1.wav',
      G0: 'BKCtbss_SusVib_G0_v1_rr1.wav',
      'A#0': 'BKCtbss_SusVib_A#0_v1_rr1.wav',
      C1: 'BKCtbss_SusVib_C1_v1_rr1.wav',
      D1: 'BKCtbss_SusVib_D1_v1_rr1.wav',
      E1: 'BKCtbss_SusVib_E1_v1_rr1.wav',
      'F#1': 'BKCtbss_SusVib_F#1_v1_rr1.wav',
      'G#1': 'BKCtbss_SusVib_G#1_v1_rr1.wav',
      A1: 'BKCtbss_SusVib_A1_v1_rr1.wav',
      'C#2': 'BKCtbss_SusVib_C#2_v1_rr1.wav',
      E2: 'BKCtbss_SusVib_E2_v1_rr1.wav',
      'G#2': 'BKCtbss_SusVib_G#2_v1_rr1.wav',
    },
  },
  // ── Airy texture — WEATHER ───────────────────────────────────────────────
  {
    id: 'flute',
    pack: 'vsco2',
    title: 'Flute, sustain vibrato — airy WEATHER texture',
    kind: 'sustained',
    trimSeconds: 4.0,
    loop: { start: 1.2, end: 3.7 },
    attackSeconds: 0.25,
    dir: 'Woodwinds/Flute/susvib/',
    notes: {
      C3: 'LDFlute_susvib_C3_v1_1.wav',
      E3: 'LDFlute_susvib_E3_v1_1.wav',
      A3: 'LDFlute_susvib_A3_v1_1.wav',
      C4: 'LDFlute_susvib_C4_v1_1.wav',
      E4: 'LDFlute_susvib_E4_v1_1.wav',
      A4: 'LDFlute_susvib_A4_v1_1.wav',
      C5: 'LDFlute_susvib_C5_v1_1.wav',
      E5: 'LDFlute_susvib_E5_v1_1.wav',
      A5: 'LDFlute_susvib_A5_v1_1.wav',
      C6: 'LDFlute_susvib_C6_v1_1.wav',
    },
  },
  {
    id: 'wine-glass',
    pack: 'vcsl',
    title: 'Wine glasses, bowed rim — glass WEATHER / LEAD',
    kind: 'sustained',
    trimSeconds: 4.0,
    loop: { start: 1.5, end: 3.8 },
    attackSeconds: 0.6,
    dir: 'Idiophones/Friction Idiophones/Wine Glasses/Sustains/Slow/',
    notes: {
      'D#4': 'glass1_D#4_Slow_1_Main.wav',
      'F#4': 'glass2_F#4_Slow_1_Main.wav',
      'A#4': 'glass3_A#4_Slow_1_Main.wav',
      D5: 'glass4_D5_Slow_2_Main.wav',
    },
  },
  {
    id: 'vibraphone-bowed',
    pack: 'vcsl',
    title: 'Vibraphone, bowed — glassy sustained glow',
    kind: 'sustained',
    trimSeconds: 4.0,
    loop: { start: 1.5, end: 3.8 },
    attackSeconds: 0.5,
    dir: 'Idiophones/Struck Idiophones/Vibraphone/Bowed/',
    notes: {
      A2: 'Vibes_bowed_A2_rr1_Main.wav',
      E3: 'Vibes_bowed_E3_rr1_Main.wav',
      G3: 'Vibes_bowed_G3_rr1_Main.wav',
      D4: 'Vibes_bowed_D4_rr1_Main.wav',
      A4: 'Vibes_bowed_A4_rr1_Main.wav',
      E5: 'Vibes_bowed_E5_rr1_Main.wav',
    },
  },
  // ── Struck / plucked — FIGURATION and LEAD ───────────────────────────────
  {
    id: 'kalimba',
    pack: 'vcsl',
    title: 'Kalimba (mbira), Kenya — FIGURATION',
    kind: 'decay',
    trimSeconds: 2.6,
    loop: null,
    attackSeconds: 0.004,
    dir: 'Idiophones/Plucked Idiophones/Kalimba, Kenya/',
    notes: {
      B2: 'Mbira6_Normal_MainSpirit_B2_k8_vl3_rr2.wav',
      'C#3': 'Mbira6_Normal_MainSpirit_C#3_k7_vl3_rr2.wav',
      'D#3': 'Mbira6_Normal_MainSpirit_D#3_k6_vl3_rr2.wav',
      'F#3': 'Mbira6_Normal_MainSpirit_F#3_k5_vl3_rr2.wav',
      'G#3': 'Mbira6_Normal_MainSpirit_G#3_k4_vl3_rr2.wav',
      B3: 'Mbira6_Normal_MainSpirit_B3_k3_vl3_rr2.wav',
      'C#4': 'Mbira6_Normal_MainSpirit_C#4_k2_vl3_rr2.wav',
      'D#4': 'Mbira6_Normal_MainSpirit_D#4_k13_vl3_rr2.wav',
      'F#4': 'Mbira6_Normal_MainSpirit_F#4_k14_vl3_rr2.wav',
      A4: 'Mbira6_Normal_MainSpirit_A4_k1_vl3_rr2.wav',
      B4: 'Mbira6_Normal_MainSpirit_B4_k15_vl3_rr2.wav',
    },
  },
  {
    id: 'handpan',
    pack: 'freesound',
    title: 'Handpan / steel tongue drum — FIGURATION (Ground lens)',
    kind: 'decay',
    trimSeconds: 4.0,
    loop: null,
    attackSeconds: 0.003,
    // Freesound sounds are individually licensed; each is verified CC0 on its
    // own sound page. We measure rather than trust the titles: one names a
    // pitch class with no octave, and the other's stated octave is wrong (the
    // strike measures F4, not the F3 in its title).
    detectPitch: 'strike',
    pitchBand: [90, 1200],
    sounds: [
      {
        note: 'C#4',
        url: 'https://cdn.freesound.org/previews/493/493864_5583677-hq.mp3',
        soundUrl: 'https://freesound.org/s/493864/',
        author: 'GeorgeNaimeh',
        title: 'handpan-C#.wav (Shaktipan handpan, nitrated steel)',
        licence: 'CC0-1.0',
      },
      {
        note: 'F3',
        url: 'https://cdn.freesound.org/previews/692/692829_5309408-hq.mp3',
        soundUrl: 'https://freesound.org/s/692829/',
        author: 'Sirkoto51',
        title: 'F3 - steel tongue drum (10-inch, 11-note, key of F)',
        licence: 'CC0-1.0',
      },
    ],
  },
  {
    id: 'slit-drum',
    pack: 'vcsl',
    title: 'Slit (log) drum — handpan-class FIGURATION, low register',
    kind: 'decay',
    trimSeconds: 2.2,
    loop: null,
    attackSeconds: 0.003,
    detectPitch: true,
    dir: 'Idiophones/Struck Idiophones/Slit Drum/',
    // Upstream names are Hi/Lo, not pitches — the fetch script measures both.
    notes: {
      LO: 'LogDrumLo_MedM_v1_rr1_Sum.wav',
      HI: 'LogDrumHi_MedM_v1_rr1_Sum.wav',
    },
  },
  {
    id: 'hand-bells',
    pack: 'vcsl',
    // NOT singing bowls — these are small, high, bright Nepalese bells. See the
    // "known gap" note in docs/ATTRIBUTION_AUDIO.md: no CC0 singing bowl with a
    // usable note map was found, so the bowl slot is filled by bells + gong-like
    // low material rather than mislabelled.
    title: 'Nepalese hand bells — bright bell LEAD (bell/bowl family)',
    kind: 'decay',
    trimSeconds: 4.5,
    loop: null,
    attackSeconds: 0.005,
    detectPitch: 'strike',
    dir: 'Idiophones/Struck Idiophones/Hand Bells, Nepalese/',
    notes: { bell1: 'HB_1.wav', bell2: 'HB_2.wav', bell3: 'HB_3.wav' },
  },
  {
    id: 'hand-chimes',
    pack: 'vcsl',
    title: 'Hand chimes — bell LEAD, long sustain',
    kind: 'decay',
    trimSeconds: 3.6,
    loop: null,
    attackSeconds: 0.006,
    dir: 'Idiophones/Struck Idiophones/Hand Chimes/',
    notes: {
      C3: 'sus_C3_r01_main.wav',
      'D#3': 'sus_D3_r01_main.wav',
      'F#3': 'sus_F#3_r01_main.wav',
      'A#3': 'sus_A#3_r01_main.wav',
      C4: 'sus_C4_r01_main.wav',
      'F#4': 'sus_F#4_r01_main.wav',
      'G#4': 'sus_G#4_r01_main.wav',
      C5: 'sus_C5_r01_main.wav',
      'F#5': 'sus_F#5_r01_main.wav',
      C6: 'sus_C6_r01_main.wav',
    },
  },
  {
    id: 'glockenspiel',
    pack: 'vcsl',
    title: 'Glockenspiel, soft mallets — bright LEAD',
    kind: 'decay',
    trimSeconds: 3.0,
    loop: null,
    attackSeconds: 0.003,
    dir: 'Idiophones/Struck Idiophones/Glockenspiel/',
    notes: {
      G4: 'glock_soft_G4_01.wav',
      C5: 'glock_soft_C5_02.wav',
      G5: 'glock_soft_G5_01.wav',
      C6: 'glock_soft_C6_01.wav',
      G6: 'glock_soft_G6_01.wav',
      C7: 'glock_soft_C7_03.wav',
    },
  },
  {
    id: 'vibraphone-soft',
    pack: 'vcsl',
    title: 'Vibraphone, soft mallets — warm glow (Embrace)',
    kind: 'decay',
    trimSeconds: 3.5,
    loop: null,
    attackSeconds: 0.004,
    dir: 'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/',
    notes: {
      F2: 'Vibes_soft_F2_v1_rr1_Main.wav',
      A2: 'Vibes_soft_A2_v1_rr1_Main.wav',
      C3: 'Vibes_soft_C3_v1_rr2_Main.wav',
      E3: 'Vibes_soft_E3_v1_rr2_Main.wav',
      G3: 'Vibes_soft_G3_v1_rr1_Main.wav',
      B3: 'Vibes_soft_B3_v1_rr1_Main.wav',
      D4: 'Vibes_soft_D4_v1_rr1_Main.wav',
      F4: 'Vibes_soft_F4_v1_rr1_Main.wav',
      A4: 'Vibes_soft_A4_v1_rr1_Main.wav',
      C5: 'Vibes_soft_C5_v1_rr1_Main.wav',
      E5: 'Vibes_soft_E5_v1_rr1_Main.wav',
    },
  },
  // ── Keys ─────────────────────────────────────────────────────────────────
  {
    id: 'piano-felt',
    pack: 'salamander',
    title: 'Salamander Grand Piano V3, soft velocity layer — felt-piano LEAD',
    kind: 'decay',
    trimSeconds: 3.6,
    loop: null,
    attackSeconds: 0.004,
    dir: '',
    // Sampled in minor thirds; velocity layer 5 of 16 is the soft, felt-like one.
    notes: {
      A1: 'A1v5.wav',
      C2: 'C2v5.wav',
      'D#2': 'D#2v5.wav',
      'F#2': 'F#2v5.wav',
      A2: 'A2v5.wav',
      C3: 'C3v5.wav',
      'D#3': 'D#3v5.wav',
      'F#3': 'F#3v5.wav',
      A3: 'A3v5.wav',
      C4: 'C4v5.wav',
      'D#4': 'D#4v5.wav',
      'F#4': 'F#4v5.wav',
      A4: 'A4v5.wav',
      C5: 'C5v5.wav',
      'D#5': 'D#5v5.wav',
      'F#5': 'F#5v5.wav',
      A5: 'A5v5.wav',
      C6: 'C6v5.wav',
    },
  },
  // NOTE: the TX81Z Clavisynth was auditioned here as the Pulse lens's synth
  // pad and REJECTED on measurement — it falls 50 dB across three seconds, so
  // looping it to hold a chord loops silence. Pulse's sustained roles use bowed
  // vibraphone instead. `fetch-samples.mjs` now refuses any 'sustained'
  // instrument whose loop region has already decayed.
  {
    id: 'fm-piano',
    pack: 'vcsl',
    title: 'Yamaha TX81Z FM piano — the electronic lens (Pulse)',
    kind: 'decay',
    trimSeconds: 3.5,
    loop: null,
    attackSeconds: 0.004,
    dir: 'Electrophones/TX81Z/FM Piano/',
    notes: {
      C1: 'FMPiano_C1_vl2.wav',
      E1: 'FMPiano_E1_vl2.wav',
      'G#1': 'FMPiano_G#1_vl2.wav',
      C2: 'FMPiano_C2_vl2.wav',
      E2: 'FMPiano_E2_vl2.wav',
      'G#2': 'FMPiano_G#2_vl2.wav',
      C3: 'FMPiano_C3_vl2.wav',
      E3: 'FMPiano_E3_vl2.wav',
      'G#3': 'FMPiano_G#3_vl2.wav',
      C4: 'FMPiano_C4_vl2.wav',
      E4: 'FMPiano_E4_vl2.wav',
      'G#4': 'FMPiano_G#4_vl2.wav',
      C5: 'FMPiano_C5_vl2.wav',
      E5: 'FMPiano_E5_vl2.wav',
      'G#5': 'FMPiano_G#5_vl2.wav',
      C6: 'FMPiano_C6_vl2.wav',
    },
  },
];

/**
 * Encoder settings — quoted verbatim in docs/ATTRIBUTION_AUDIO.md.
 *
 * `.ogg` here is **Ogg Opus**, not Ogg Vorbis: the pinned toolchain's ffmpeg is
 * built without libvorbis, and Opus is both smaller and better at these rates.
 * The runtime picks `.ogg` when the browser reports it can play Opus and falls
 * back to the universally-supported `.mp3` otherwise — the usual two-format
 * pair, with a better codec in the ogg slot.
 */
export const ENCODE = {
  sampleRate: 44100,
  channels: 1,
  /** Peak-normalise each trimmed sample to this dBFS before encoding. */
  peakDbfs: -1.0,
  fadeOutSeconds: 0.12,
  ogg: ['-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-application', 'audio'],
  mp3: ['-c:a', 'libmp3lame', '-q:a', '5'],
};

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Scientific pitch name (e.g. "F#3", "A#0") → MIDI note number. A4 = 69. */
export function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`not a pitch name: ${name}`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + SEMITONE[m[1]] + accidental;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note number → scientific pitch name. */
export function midiToNote(midi) {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
