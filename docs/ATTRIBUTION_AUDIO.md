# Audio attribution — the bundled instrument samples

*Slice B0. Every sound in `public/samples/` is listed here with its source URL,
pinned version, licence, SHA-256 and access date. Nothing gets bundled that is
not on this page.*

**Access date for every row below: 2026-08-06.** Licences were read from each
pack's own authoritative page or in-repo `LICENSE` file **before** anything was
downloaded, not inferred from a mirror or a wiki.

Regenerate everything here with:

```sh
npm run samples:fetch      # download, verify, trim, encode, re-hash
```

---

## 1. The packs

| Pack | Author | Licence | Pinned version | Credit required |
|---|---|---|---|---|
| [Versilian Community Sample Library (VCSL)](https://github.com/sgossner/VCSL) | Versilian Studios LLC (Sam Gossner) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e` (2026-01-14) | no |
| [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) | Versilian Studios LLC & Bigcat Instruments | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | commit `440300901dfe9275fd84e0b7763af1f8443ae62e` (2020-08-05) | no |
| [Salamander Grand Piano V3](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) | Alexander Holm | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | `V3+20161209`, 44.1 kHz 16-bit SFZ+WAV | **yes — see §2** |
| [Freesound](https://freesound.org/) (two individually-licensed sounds) | per sound, see §4 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | high-quality public preview renditions | no |

### How each licence was verified

- **VCSL** — repository `LICENSE` at the pinned commit is the full CC0 1.0
  Universal text; the README states *"This collection is under a Creative
  Commons 0 license… you can do whatever you want with these sounds (even make
  commercial software), no royalties, no credit, no special terms."*
- **VSCO 2 CE** — repository `LICENSE` at the pinned commit is the full CC0 1.0
  Universal text.
- **Salamander** — see the note below; this is the one row where the sources
  disagree.
- **Freesound** — each sound's own page on freesound.org states its licence.
  Both sounds used here declare CC0 1.0 on their sound page (§4).

### The Salamander licence, stated honestly

The two authoritative sources **disagree**:

- The author's own page,
  [rytmenpinne.wordpress.com/sounds-and-such/salamander-grandpiano](https://rytmenpinne.wordpress.com/sounds-and-such/salamander-grandpiano/),
  says: *"As of 4.3.2022, this is now public domain! Have fun with it, it's
  yours and noones!"*
- The FreePats distribution we actually downloaded still publishes it under
  **Creative Commons Attribution 3.0**.

We take **the stricter of the two** and carry the credit line. If the intent is
ever to drop attribution, that should be a deliberate decision recorded here,
not a silent one.

---

## 2. Credit lines (required in the shipped app)

> Salamander Grand Piano V3 by Alexander Holm — CC BY 3.0
> <https://creativecommons.org/licenses/by/3.0/>

Everything else is CC0 and needs no credit. We list it anyway, because knowing
where a sound came from is worth more than the licence minimum.

---

## 3. Encoding

Trimmed and encoded by `scripts/fetch-samples.mjs` using **ffmpeg 8.1.2**
(Homebrew, `--enable-libopus --enable-libmp3lame`, Apple clang 21.0.0):

| | |
|---|---|
| Sample rate | 44 100 Hz |
| Channels | mono (the renderer and the app do the panning) |
| Trim | starts at the measured onset; length is per-instrument, 2.2 – 4.5 s |
| Peak normalise | −1.0 dBFS |
| Fade out | 120 ms, so a truncated sustain does not click |
| `.ogg` | `-c:a libopus -b:a 64k -vbr on -application audio` |
| `.mp3` | `-c:a libmp3lame -q:a 5` |

**`.ogg` here is Ogg Opus, not Ogg Vorbis.** The pinned toolchain's ffmpeg is
built without `libvorbis`, and Opus is both smaller and better at these rates.
Every note is therefore encoded twice: the runtime asks the browser what it can
play (`canPlayType('audio/ogg; codecs="opus"')`) and falls back to `.mp3`, which
every target decodes. That is the usual two-format pair with a better codec in
the ogg slot.

Two further numbers are measured at build time and recorded in
`public/samples/manifest.json`:

- **`impactDbfs`** — each note's RMS over its first half second.
- **`levelDb`** — a per-instrument gain that brings its *median* `impactDbfs` to
  a −20 dBFS reference. Peak-normalising alone is not enough: a bowed violin and
  a struck kalimba can share a peak and differ by 10 dB in how loud they sound,
  and a role that falls through from one to the other mid-render then lurches.
  Measured across the bundle, that spread was **19 dB** (`strings-violin` +5.7,
  `vibraphone-soft` −13.5).

### Payload per mood lens

Target was ≤ 3 MB per lens. Ogg bytes, primary tier (the instruments a lens must
have before it can play anything) and the full chain including fall-throughs:

| Lens | Primary | Full chain |
|---|---|---|
| Aurora | 1.84 MB | 2.49 MB |
| Embrace | 1.94 MB | 2.97 MB |
| Sonata | 2.33 MB | 2.64 MB |
| Pulse | 1.55 MB | 2.14 MB |
| Ground | 1.30 MB | 2.46 MB |
| *union of all five* | — | 4.44 MB |

---

## 4. Pitch, measured rather than assumed

Several sources are not pitch-named, and one is named **wrongly**. Rather than
trust the filenames, `fetch-samples.mjs` measures the fundamental and records
both the measurement and the original label, so the disagreement is auditable:

| Sound | Labelled | Measured | Method |
|---|---|---|---|
| VCSL `LogDrumLo` | "Lo" | **A2**, 107.30 Hz | autocorrelation |
| VCSL `LogDrumHi` | "Hi" | **D#3**, 155.83 Hz | autocorrelation |
| VCSL `HB_1` | — | **C#6**, 1092.83 Hz | strongest partial |
| VCSL `HB_2` | — | **A#5**, 943.16 Hz | strongest partial |
| VCSL `HB_3` | — | **B6**, 1952.84 Hz | strongest partial |
| Freesound 493864 | "handpan-C#" (no octave) | **C#3**, 138.80 Hz | strongest partial |
| Freesound 692829 | "**F3** – steel tongue drum" | **F4**, 350.76 Hz | strongest partial |

Bells and gongs are inharmonic, so autocorrelation is the wrong tool for them:
their partials are not integer multiples and the correlator locks onto a
difference tone one or two octaves below anything audible. Measured, it called a
bell whose strongest partial is 1103 Hz "C#3". Those get a Goertzel probe for
the loudest partial in a plausible band instead.

Freesound 692829's uploader titled it F3; there is no energy at 175 Hz in the
file at all, and the strike measures 351 Hz. We use the measurement.

### The two Freesound sounds

Freesound's original-quality download requires an authenticated account. What is
publicly served is the high-quality preview rendition, so **these two sounds are
the only lossy-sourced material in the bundle** — an mp3 preview, re-encoded.
Both are CC0 on their own sound pages, which is the authoritative statement.

| Sound | Author | Licence | Fetched |
|---|---|---|---|
| [handpan-C#.wav](https://freesound.org/s/493864/) (Shaktipan handpan, nitrated steel) | GeorgeNaimeh | CC0 1.0 | `https://cdn.freesound.org/previews/493/493864_5583677-hq.mp3` |
| [F3 – steel tongue drum](https://freesound.org/s/692829/) (10-inch, 11-note, key of F) | Sirkoto51 | CC0 1.0 | `https://cdn.freesound.org/previews/692/692829_5309408-hq.mp3` |

---

## 5. Known gaps and rejected candidates

**Singing bowls — not found under CC0 with a usable note map.** The brief asked
for handpan / singing bowls / glass / kalimba from Freesound. Glass, kalimba and
handpan are covered (wine glasses and kalimba come from VCSL, which has better
provenance and proper note mapping than a scraped preview; handpan from the two
CC0 sounds above). For singing bowls, nothing CC0 was found with pitched,
note-mapped samples. Rather than mislabel, the bowl slot in the Ground lens is
filled by **Nepalese hand bells** and **hand chimes** — genuinely the bell family,
and named as such. A real singing bowl set remains open for B1, and would need
an authenticated Freesound pull.

**TX81Z Clavisynth — auditioned as the Pulse pad and rejected on measurement.**
It was bundled as `fm-pad`, then dropped: measured, it falls **50 dB across three
seconds** (−12.0 dBFS in its first half second, −64.2 by second three). It is a
plucked sound wearing a pad's name, and looping it to hold a ten-minute chord
voice loops silence. Pulse's sustained roles use bowed vibraphone instead.
`fetch-samples.mjs` now **refuses** any instrument declared `sustained` whose
loop region sits more than 12 dB below its attack, so this class of mistake
fails at build time rather than quietly in the mix.

**Freesound API.** Search and download both require an API token / OAuth. Only
the public search page and CDN previews are reachable unauthenticated, which is
why Freesound contributes two sounds here rather than a section.

---

## 6. Full provenance — every bundled note

SHA-256 is of the **upstream source file**, before trimming and encoding, so a
row can be re-verified against the pack without reproducing our processing.
Salamander rows are files inside
`SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz`, whose own SHA-256 is
`58750eb1366761e187f71ddb9b932355ea894d28ec4331e74ab8acb44c819936`
(412 313 804 bytes) and is verified on every fetch.

The machine-readable version of this section is
`scripts/.cache/samples-provenance.json` (regenerated by `npm run samples:fetch`;
`npm run samples:report` prints it as a table).

<!-- BEGIN GENERATED TABLE -->
#### `contrabass` — Solo contrabass, sustain vibrato — the GROUND drone
VSCO 2 CE · CC0-1.0 · sustained · 12 notes · 459 kB ogg · level -8.64 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| F#0 | `BKCtbss_SusVib_F#0_v1_rr1.wav` | `b965551477a816f38305f65b4cfa4595ca5c0d38e92c8b6128f070eb768671b5` |
| G0 | `BKCtbss_SusVib_G0_v1_rr1.wav` | `b73fed4cfd524f10eb2879032a44e079346d3b88ed6e5a7f776bc2a11103daab` |
| A#0 | `BKCtbss_SusVib_A#0_v1_rr1.wav` | `bfed36e434e4f8a10abecf9ef8875a409ed32a698ab0faad7e253337c7bc6bf6` |
| C1 | `BKCtbss_SusVib_C1_v1_rr1.wav` | `35031ed9356f18b2ad4de86fff3192fe0cbcf79d5d63c079285246b51472f280` |
| D1 | `BKCtbss_SusVib_D1_v1_rr1.wav` | `02aafdc953cd07649f4e0be571a5569c80665cf61ac6062b6bae22c302289d2f` |
| E1 | `BKCtbss_SusVib_E1_v1_rr1.wav` | `ffe06f830d10a24f04beb4683d5aae7516810d27c38dba3cc7a55d1c785840cd` |
| F#1 | `BKCtbss_SusVib_F#1_v1_rr1.wav` | `dbf26625b7e12392fb8222f75b82fc2e48d3121cbb9b7b7ebe6361225b9a2313` |
| G#1 | `BKCtbss_SusVib_G#1_v1_rr1.wav` | `601eda5755db1d15efa3203d457a8c43eb26f85ffe19455bf4efa895ed54adc6` |
| A1 | `BKCtbss_SusVib_A1_v1_rr1.wav` | `c1594db9e43851d429e34086cf16944b5a9f5e48d544d10ebd17a4f682d376e1` |
| C#2 | `BKCtbss_SusVib_C#2_v1_rr1.wav` | `083751a59f87ed5ded98d073226ea975441748ee5a2a1647784029cb60cb4570` |
| E2 | `BKCtbss_SusVib_E2_v1_rr1.wav` | `1f4f7b8718c3e3562f4dd851981ceccf2200741573adc24d3f8bfe9fc3087123` |
| G#2 | `BKCtbss_SusVib_G#2_v1_rr1.wav` | `ddde6da7902a3b00d5086bce6604ce1c4b6b6a45e81cff8ea2225420ab3d397d` |

#### `flute` — Flute, sustain vibrato — airy WEATHER texture
VSCO 2 CE · CC0-1.0 · sustained · 10 notes · 419 kB ogg · level -10.14 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| C3 | `LDFlute_susvib_C3_v1_1.wav` | `073631c8442b275d803e608e840c2ce6cad3b08320018e08510cf3cb57373154` |
| E3 | `LDFlute_susvib_E3_v1_1.wav` | `831386b21a704a5fccf204b18a536d638ea191f1b56662200192241215e21abd` |
| A3 | `LDFlute_susvib_A3_v1_1.wav` | `4ea04a7a2ba152752e1b475798619a62f2546f54972caa6ddcd88f29a2046c81` |
| C4 | `LDFlute_susvib_C4_v1_1.wav` | `e88a0ff35e6b8c29fd88bc778a4c817d955b2c3a2934def97a7d093b72e2ae97` |
| E4 | `LDFlute_susvib_E4_v1_1.wav` | `83d4eed0c54ebfe25fe9dfb0475fb90a88a43d11777bc2afac879b8b695e494c` |
| A4 | `LDFlute_susvib_A4_v1_1.wav` | `cf3c1c30943b8b8ef8b5b9ced89430c014987a037204098d002f86e424391ba9` |
| C5 | `LDFlute_susvib_C5_v1_1.wav` | `ecb78c59069866ea7c3327594851827cd2f50c5d411aad422269a88e53614fbe` |
| E5 | `LDFlute_susvib_E5_v1_1.wav` | `6eab0a4827c43b49415cb0c846affd40e9555c884c74683422554923faf17681` |
| A5 | `LDFlute_susvib_A5_v1_1.wav` | `067a42df19ec1864389c28235a6794033471c0ffa3d7e16637396a505ca7d7fd` |
| C6 | `LDFlute_susvib_C6_v1_1.wav` | `0ead172a529daad09ecbab66027027b92189afe79f50f71dc20ee58ca66c9135` |

#### `fm-piano` — Yamaha TX81Z FM piano — the electronic lens (Pulse)
VCSL · CC0-1.0 · decay · 16 notes · 527 kB ogg · level -8.98 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| C1 | `FMPiano_C1_vl2.wav` | `85c2e6fefe86c214dcbca4fcc22466bd7bbcec39e2cfe31a116adacf9f52ceb8` |
| E1 | `FMPiano_E1_vl2.wav` | `94cd5f7475ecc26023a940a1889ba15a460cf129e4af7c186cdb0a53e27c6104` |
| G#1 | `FMPiano_G#1_vl2.wav` | `940fe3b627525e5e0d8f9677e40320e7e02b3846c3baf3db8832ae87fe03ea16` |
| C2 | `FMPiano_C2_vl2.wav` | `1c22c1eca8ecc5474fd8ee254a0af1c69623c938ee0bc0076a11a4e7d1f2020a` |
| E2 | `FMPiano_E2_vl2.wav` | `d738ad3fa006ca3429cef9dc13a7f8d8f27154100c8c6ea8757016d5e46114a9` |
| G#2 | `FMPiano_G#2_vl2.wav` | `629441d4ff0de4ab03009d985b8b1961d66d80b73faf9f40fabe78bc46df13cb` |
| C3 | `FMPiano_C3_vl2.wav` | `6f11eda294358ac5931225e3cf2400dadf0730a1fe092a75457f6e097148fdec` |
| E3 | `FMPiano_E3_vl2.wav` | `f950e18183502e94637fb0fcad09c39f3d67ea5be26673e2de55b7bd34198d30` |
| G#3 | `FMPiano_G#3_vl2.wav` | `6c32c0dea461ea49f4cf3c3439b20f5f94340e387fd0a32d6d5cbaa937a4a04d` |
| C4 | `FMPiano_C4_vl2.wav` | `7578fbb7b8203d1cfdcff1f3cbb74f158e183d810faa52dfb3656114e33fa595` |
| E4 | `FMPiano_E4_vl2.wav` | `ffdb976f02bc4b1ab8a8eda4f880a46c2505804f35ce07e73fff02b177b54e46` |
| G#4 | `FMPiano_G#4_vl2.wav` | `fceb186ca57ae8c15666e2e23a066e0c5be5d63dc569136b2b136142923bb16e` |
| C5 | `FMPiano_C5_vl2.wav` | `b5d604f62d61b427214a34bef34974a9cb0bc3ac216b16f1e7ebf6ab27969d40` |
| E5 | `FMPiano_E5_vl2.wav` | `71dc680134a6b8da7204cc57d4e7085bf39e1eece3fd480492a929e40a8c2525` |
| G#5 | `FMPiano_G#5_vl2.wav` | `ed1f17ce4f69a063debe4c4caa5067521efaf16da96758aa609b8c8eddb441f4` |
| C6 | `FMPiano_C6_vl2.wav` | `ff41a17dde6baf761e9a0b9a8daa971c7a129d948ae1c15c84d3fa1692af2325` |

#### `glockenspiel` — Glockenspiel, soft mallets — bright LEAD
VCSL · CC0-1.0 · decay · 6 notes · 177 kB ogg · level -5.68 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| G4 | `glock_soft_G4_01.wav` | `cd92f9402c28d3e951dc8d575ce61f0a550b7e316cb6427b1b455ac3aab09000` |
| C5 | `glock_soft_C5_02.wav` | `4fa149e6f224557df5fab98ad660a8f192bc6fbf2556077dd1089509bf4424e2` |
| G5 | `glock_soft_G5_01.wav` | `73f6a6de89291d0292b303d641444de5e6e1561881f09f6cf20d77f245f7bec3` |
| C6 | `glock_soft_C6_01.wav` | `e0fdb3a134ee828530c654db7f94b04f94272984938875b0d5535ec40c658324` |
| G6 | `glock_soft_G6_01.wav` | `b4407b60c2dff43a3a80fe5231beed95caad4d9b8f3f9cdbd80a27642207f35d` |
| C7 | `glock_soft_C7_03.wav` | `68d823a0deffef138d4ed583bd027b9932643a630064274e73d67a644385be4c` |

#### `hand-bells` — Nepalese hand bells — bright bell LEAD (bell/bowl family)
VCSL · CC0-1.0 · decay · 3 notes · 74 kB ogg · level -0.69 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| A#5 *(labelled bell2; measured 943.16 Hz)* | `HB_2.wav` | `e201ef095eac406a1bd5a9ec774229b57f40407d633e6dbeed53c67ebb973d56` |
| C#6 *(labelled bell1; measured 1092.83 Hz)* | `HB_1.wav` | `46e19962db5cb9b339f22609f1c529cd187249c36f3bcd05d4002179c403c222` |
| B6 *(labelled bell3; measured 1952.84 Hz)* | `HB_3.wav` | `9824e5aafb07085913231fe4f574561e92b02ba44bcd4a105783b857c1ca2f71` |

#### `hand-chimes` — Hand chimes — bell LEAD, long sustain
VCSL · CC0-1.0 · decay · 10 notes · 381 kB ogg · level -11.09 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| C3 | `sus_C3_r01_main.wav` | `47bec5759eb7b435c255dd7df38fbbd41306b75a4000a890b951b3640f0af50a` |
| D#3 | `sus_D3_r01_main.wav` | `fc9e1ee181909bf8b1d82b31e26af6379c3a84def609befd98db1752e260a561` |
| F#3 | `sus_F#3_r01_main.wav` | `729347d799fd5e4d09d83033719caa4c24e5ebdfa8a74fd6983e20aa62941de0` |
| A#3 | `sus_A#3_r01_main.wav` | `2eb505e93627247114582d8e103d77ff427ab2e882bb73e30925d265c09210a4` |
| C4 | `sus_C4_r01_main.wav` | `89980f18db9e08a137d1fc18f0505281bd6c192021b9dd33dafb7d3117ef608c` |
| F#4 | `sus_F#4_r01_main.wav` | `858c506fc9c6c35bcb9e0c08850892cab77c1496a83ccff493377df6e6fb1bd4` |
| G#4 | `sus_G#4_r01_main.wav` | `e52f03ab7ccd2227581e913f6822f225b8973eec4cc48feb917bae91b3de9c59` |
| C5 | `sus_C5_r01_main.wav` | `836f13d448c9d6d685da634368615c2f7c03b6fb5b99ac93627e1fbb40368e58` |
| F#5 | `sus_F#5_r01_main.wav` | `7bf55316322d46c635be1b1180e0bc8a4988b26e4ebc5cff2d326ecd46b82302` |
| C6 | `sus_C6_r01_main.wav` | `202a0c95519668c7afb72835c5fd3a9a80805ba3cc9ea8bfc2f40a48d05b0283` |

#### `handpan` — Handpan / steel tongue drum — FIGURATION (Ground lens)
Freesound · CC0-1.0 · decay · 2 notes · 60 kB ogg · level -12.03 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| C#3 *(labelled C#4; measured 138.8 Hz)* | [handpan-C#.wav (Shaktipan handpan, nitrated steel)](https://freesound.org/s/493864/) | `c4bb6287da124408c2a9e928ab4d8fc0c71646b9b887e9050a25df92708f2f33` |
| F4 *(labelled F3; measured 350.76 Hz)* | [F3 - steel tongue drum (10-inch, 11-note, key of F)](https://freesound.org/s/692829/) | `c28f81d21b4bc4c907a194aa3652528a67c361849867da77424cc0a9a449c8f8` |

#### `kalimba` — Kalimba (mbira), Kenya — FIGURATION
VCSL · CC0-1.0 · decay · 11 notes · 184 kB ogg · level -1.31 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| B2 | `Mbira6_Normal_MainSpirit_B2_k8_vl3_rr2.wav` | `b4bd2db5c868be7398e2028ec818a3edc3979e49df620f2250b786f2e45b3905` |
| C#3 | `Mbira6_Normal_MainSpirit_C#3_k7_vl3_rr2.wav` | `3ba8ac79db31fbdb68f907de7c59da0c64ae48bc75350a4f7f0c957f72c420cc` |
| D#3 | `Mbira6_Normal_MainSpirit_D#3_k6_vl3_rr2.wav` | `429e2a4797dcd79905cbd9cd13a8a221bf0f4dace5c8ff4290aa70087f08a7ce` |
| F#3 | `Mbira6_Normal_MainSpirit_F#3_k5_vl3_rr2.wav` | `b1f9bbb8a3860306aab71c9fcbeff5ed9cf17a123eef0381380fb20f0e3daa95` |
| G#3 | `Mbira6_Normal_MainSpirit_G#3_k4_vl3_rr2.wav` | `6b6fd6225b6589e21e49850d51405c7881ba2e297b6e1ec448b09383e0953155` |
| B3 | `Mbira6_Normal_MainSpirit_B3_k3_vl3_rr2.wav` | `d35e8f5773ee989511e376876d9698e0027f44a754eb9e001de01abb29b19808` |
| C#4 | `Mbira6_Normal_MainSpirit_C#4_k2_vl3_rr2.wav` | `79643a37ffc158acb9995390c3c20aa8d0246375e074e2ea38661313e58b6a5f` |
| D#4 | `Mbira6_Normal_MainSpirit_D#4_k13_vl3_rr2.wav` | `25cee2aabafa43a0acac052a93f95e43b61f12686c0b0f47176f80a06e10deee` |
| F#4 | `Mbira6_Normal_MainSpirit_F#4_k14_vl3_rr2.wav` | `534754f601c2a16577bd26e87b8c8241b5d76c53a01ed196e54bf53f22cea7bc` |
| A4 | `Mbira6_Normal_MainSpirit_A4_k1_vl3_rr2.wav` | `153c55100dc25cdbec013b1153018e78fa094e5c0ee0b9f050ee57c2b198a500` |
| B4 | `Mbira6_Normal_MainSpirit_B4_k15_vl3_rr2.wav` | `b26d42ab0fe80fd54ec8cfb1cea72ef26cd07ef2dae914e1ffa00471a05f1698` |

#### `piano-felt` — Salamander Grand Piano V3, soft velocity layer — felt-piano LEAD
Salamander · CC-BY-3.0 · decay · 18 notes · 556 kB ogg · level -8.85 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| A1 | `A1v5.wav` | `51d72c11f388271c9b2d212b036222896d839e6db317cbaab6465e119abd3646` |
| C2 | `C2v5.wav` | `ec69c4ae379969741d1228b7657b44589de7a23e609e2b14c9e7db0b62a8554c` |
| D#2 | `D#2v5.wav` | `233ce125b277255d5c0083b577e4b279433ec38f08986bab54d347a40b7432ff` |
| F#2 | `F#2v5.wav` | `3dc49d5186e01325f54d3bdd551cbd6dd667d2190a8165df5b0c7d081f36b6a8` |
| A2 | `A2v5.wav` | `2123587fffb533f637ffae36c53b800565d2eaf1a519a7218267cc8df014c406` |
| C3 | `C3v5.wav` | `dd2a27ce7f83a028e7e01ad62a0290b895f2e168aa7701e81293ece7dad0ba05` |
| D#3 | `D#3v5.wav` | `3d4147f14b0563e245df0166ee395bed9bb51dc4504d7fb5cc0d20410b18ef84` |
| F#3 | `F#3v5.wav` | `5f83d18a82bed5a95515dc482632253fa618623d7625ce9084ee30c32ac8e1e1` |
| A3 | `A3v5.wav` | `50ffa1d7347fa0ddae4ec2635525c5e85fdc73fab65c1dc2621f57ba91b7f621` |
| C4 | `C4v5.wav` | `1d4877ddebcf21bd934e5fc7bc6fd2d506dff7e12fc6785f8d39be0c7d9682a9` |
| D#4 | `D#4v5.wav` | `0aff23bf6628233904300c38212deda96c390b840d29a67df0098c6d726c91ba` |
| F#4 | `F#4v5.wav` | `587ad9634b73e651cf4fb562c7311fc11788fc125808f7529763effd168c690c` |
| A4 | `A4v5.wav` | `ffcdff45bfe9c958678e015ac3ae3b52b8905682e341b38c2e3bafa607222959` |
| C5 | `C5v5.wav` | `66e782c7cf4d9ad3d2fff64fd15b3fda61646e153280a28cf56fadeb9e4bf0b7` |
| D#5 | `D#5v5.wav` | `b166d8409d25aee49705395e79cbfef375fd22e8f3a565d9c106f32c43d3deec` |
| F#5 | `F#5v5.wav` | `704554644c2bd93a9b035ed848c2f7198f3d6c4c2aaca281f7db26cfbaed58e0` |
| A5 | `A5v5.wav` | `948cfd54d76660338a5c6f1c28bc680cc36570ed5592ff08919568a4ce56db21` |
| C6 | `C6v5.wav` | `83a3c0dee2412393fa472ca9799a950e8728c130117134e74190faa625e45190` |

#### `slit-drum` — Slit (log) drum — handpan-class FIGURATION, low register
VCSL · CC0-1.0 · decay · 2 notes · 20 kB ogg · level -4.27 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| A2 *(labelled LO; measured 107.3 Hz)* | `LogDrumLo_MedM_v1_rr1_Sum.wav` | `cb77b9a6e7fc560d03b45102632ee0be5d08158cb03f59d63dd6fd2c4443ba4f` |
| D#3 *(labelled HI; measured 155.83 Hz)* | `LogDrumHi_MedM_v1_rr1_Sum.wav` | `6ca70964e7d1dd80daf6c67cff226db6e0cadbff3234944de9055c3ef1d7f4eb` |

#### `strings-cello` — Cello section, sustain vibrato
VSCO 2 CE · CC0-1.0 · sustained · 12 notes · 493 kB ogg · level -3.44 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| C1 | `susvib_C1_v1_1.wav` | `abdcea431f384e135c469b0f3e4ac2a437f282f521dc5bcbe22abc221536e8de` |
| E1 | `susvib_E1_v1_1.wav` | `de31a61b02d4e1d5a79b8bc432b0f35fe2e434290ad34402cc0f2dd7dc278cde` |
| G1 | `susvib_G1_v1_1.wav` | `9e5d24e8e28d6c7f650f9bb2b33d43c13e341a8bd33124c64e23881378b181ba` |
| B1 | `susvib_B1_v1_1.wav` | `4f95c087c4b8d87ee591e9d39c3c9caf085c6f1b9125eac3ca9e4e637da628ee` |
| D2 | `susvib_D2_v1_1.wav` | `e8640dec9febc6e39fcf06b19d2c95a85d5ff8c38f13c9879e69f551eaf38ab8` |
| F2 | `susvib_F2_v1_1.wav` | `162054eab4ba118924f8f8986cf1b17ccfd65211d1945743ffbae30b4953f901` |
| A2 | `susvib_A2_v1_1.wav` | `c97a003184fdcb153d6b6c0bae8d82a90592a1b04b06bd7caaeda8b9776d5284` |
| C3 | `susvib_C3_v1_1.wav` | `a614ee7ca821b44660236e47b89620cf914ec6ad27a99bc0d9764f47dbe512e1` |
| E3 | `susvib_E3_v1_1.wav` | `d2f961e30bf64021cf4acbd88e0e7a1fd1840943ae78c62a711bcce3d109216e` |
| G3 | `susvib_G3_v1_1.wav` | `8d658346b8d2054fd534b3222b5d7a23196d22a83a68c3a04ffb76b21853a3db` |
| B3 | `susvib_B3_v1_1.wav` | `bd25d66c1c4e73f5827bf3b931244e51ec8388594d8004529a762be81258097f` |
| D4 | `susvib_D4_v1_1.wav` | `b4aa3a7fec1f0e783fa560f493868c17045feb271738e3d6834d1b00594b1c38` |

#### `strings-violin` — Violin section, sustain vibrato
VSCO 2 CE · CC0-1.0 · sustained · 10 notes · 458 kB ogg · level +5.69 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| G2 | `VlnEns_susVib_G2_v1.wav` | `feb96c5064fbef43087c495d61a9cab9f70ff1be5b22905147c1f86d5f89547c` |
| A2 | `VlnEns_susVib_A2_v1.wav` | `5b3ff9f991642a6dc2fdad56a7d94f581077d2c4082cc1ed89156737716ff22c` |
| B2 | `VlnEns_susVib_B2_v1.wav` | `1a873970a86da78ed8c9aa068303958496c34eee6fa94fcab39d499dbdfb7826` |
| D3 | `VlnEns_susVib_D3_v1.wav` | `583e660bc5daa4e094aef5fc014fbb92751040be8741ed7a16847306a1fe0a99` |
| F#3 | `VlnEns_susVib_F#3_v1.wav` | `8dc13d197373f0d1fe1b0744de57796800bde372906d3667398c55d473a383ea` |
| C4 | `VlnEns_susVib_C4_v1.wav` | `c07edd5b2119fa1da2207aba996961b50dd616f69bbcf2300ab271bc6c16239f` |
| E4 | `VlnEns_susVib_E4_v1.wav` | `787fb4bcfb47d5c88ee1573c8db15f32d345386301be4a8eea6a825847413ae2` |
| G4 | `VlnEns_susVib_G4_v1.wav` | `ed2a89cf254432d2af073699fa43ebfa16cfbc5552c7fc964a184fc434eaaa39` |
| B4 | `VlnEns_susVib_B4_v1.wav` | `ec4cea41ac77f251bf5f4158fe9cbeeae13755e3785106e505808de18fdddc0d` |
| D5 | `VlnEns_susVib_D5_v1.wav` | `f8d870457826c94270b9c3ead8e8ec02cb7e6c4a3481cded055641b7fab7df62` |

#### `vibraphone-bowed` — Vibraphone, bowed — glassy sustained glow
VCSL · CC0-1.0 · sustained · 6 notes · 267 kB ogg · level -6.54 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| A2 | `Vibes_bowed_A2_rr1_Main.wav` | `4c2a8cdbfaa4ee77c9f948cae7b764ce9b316a4eb24ea58f17c45072bf12264f` |
| E3 | `Vibes_bowed_E3_rr1_Main.wav` | `bd41a203f16bf090677d8cc3ec0778c0f8865ae965cb0e5fe37c0a08ece8e09f` |
| G3 | `Vibes_bowed_G3_rr1_Main.wav` | `4b566300ee58c75de89e97278607f710ba0a807622582118d9f2e451d8bf573c` |
| D4 | `Vibes_bowed_D4_rr1_Main.wav` | `b5a6ab0a6c51b446832bc3686e27a62489f3169182ad4c872698912536d1ece6` |
| A4 | `Vibes_bowed_A4_rr1_Main.wav` | `78be0c9d01f464cb76a46a398b3ae7ed412e9ae3d573f76c99a6821a1a04279f` |
| E5 | `Vibes_bowed_E5_rr1_Main.wav` | `da6ea2e49db457b30e7a72e0361f7da67863ed3077977e73ff45ec09b2a91c65` |

#### `vibraphone-soft` — Vibraphone, soft mallets — warm glow (Embrace)
VCSL · CC0-1.0 · decay · 11 notes · 314 kB ogg · level -13.49 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| F2 | `Vibes_soft_F2_v1_rr1_Main.wav` | `df5cfcc72af80fac2191300d09922474c4ac25c5cbc43ff387953d607f7c1320` |
| A2 | `Vibes_soft_A2_v1_rr1_Main.wav` | `b6e23a94322107d0ab884d7c38e51be538eb45f613c6a24e980c2261151bed75` |
| C3 | `Vibes_soft_C3_v1_rr2_Main.wav` | `1dda9a4c3205c365345d66dcb68c8e09c0dca76a310b8fe8108e43c7e8c1cd0a` |
| E3 | `Vibes_soft_E3_v1_rr2_Main.wav` | `620a241017d0de0e6cb789c97d439401f25d659d08f753746690632e71de8f0b` |
| G3 | `Vibes_soft_G3_v1_rr1_Main.wav` | `9b479e4c84fb1caafba8c1c106a8922cea20bba81c37d65f93afae339626767f` |
| B3 | `Vibes_soft_B3_v1_rr1_Main.wav` | `7edfbd70f93781d2cbb17c2fc8befe474de9987c6353db2358af4e13a0269345` |
| D4 | `Vibes_soft_D4_v1_rr1_Main.wav` | `daedf613863d4de0a383d66b2db6ab9ffd8dc492d16ff7d735cf3b3107046a26` |
| F4 | `Vibes_soft_F4_v1_rr1_Main.wav` | `95b7d6eeb71d77cce607c0c52b0a6dfd23d0eeedc2eb393fb9a6c5a5768f4aa5` |
| A4 | `Vibes_soft_A4_v1_rr1_Main.wav` | `48e942290a982768d7a0038e28a76a99cb666673518b29ebdc55de5e1491025f` |
| C5 | `Vibes_soft_C5_v1_rr1_Main.wav` | `be995c1164dcbbcf83688d095864a4abd0feaa68b71d1d2e78c35f62461fc03b` |
| E5 | `Vibes_soft_E5_v1_rr1_Main.wav` | `d2a9412550115bfdc4e1087cad3cd6e9d8146c1f4a91bf47f60aa7936c5f5dbe` |

#### `wine-glass` — Wine glasses, bowed rim — glass WEATHER / LEAD
VCSL · CC0-1.0 · sustained · 4 notes · 162 kB ogg · level -12.14 dB

| note | upstream file | SHA-256 of source |
|---|---|---|
| D#4 | `glass1_D#4_Slow_1_Main.wav` | `6cdc2f602fac912a768561b3831ebb9099c884cb5ea76c88befedf545bab1997` |
| F#4 | `glass2_F#4_Slow_1_Main.wav` | `a6dea146ee3b11fb1d667742ac4a3c16f0bdb567103ef5602cdf3df163b52080` |
| A#4 | `glass3_A#4_Slow_1_Main.wav` | `b35da8d5c9ea4e24b33508094e3cb3e736e7ff5ea4517335844023f82c9bb503` |
| D5 | `glass4_D5_Slow_2_Main.wav` | `ffb776b67e6d43f6eeb8ff2b73d9a45e233919a83d4cb104c5dad2807f681322` |
<!-- END GENERATED TABLE -->
