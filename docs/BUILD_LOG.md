# BUILD LOG — Cosmophony (POC-5)

One paragraph per phase: what was built, and the evidence it works. Phases run
strictly in order, each ending in a halt for review.

---

## Phase 0 — Scaffold & boundaries · 2026-08-01 · ✅ complete, awaiting review

Scaffolded a Vite + TypeScript project in `builds/POC5_Cosmophony/` carrying the
full three-layer engine skeleton — `engine/model` (`Star`, `ObserverInput`,
`HorizonStar`, `City`), `engine/mapping` (`MappingConfig`, `TimbreParams`,
`MusicalEvent`, `MusicalScore`, plus `sonify`, `starsAboveHorizon`, `julianDate`,
`greenwichMeanSiderealTime` as stubs that `throw new Error("not implemented")`),
and `engine/audio` (the `AudioEngine` interface and a `createAudioEngine` stub) —
alongside `instruments/types.ts` (the `Instrument<TInput>` plug-in contract), a
`birthSky` instrument stub, a reserved-but-empty `instruments/orrery/`, and an
`app/` shell that renders a placeholder title, tagline, and the honesty label. All
the type contracts from the build plan exist as real exported interfaces and the
whole thing typechecks under `strict`. The dependency rule is enforced rather than
merely documented: `test/boundaries.test.ts` scans the source and fails the suite
if `model` imports anything at all, if `mapping` imports anything outside
`../model`, if `mapping` mentions `Tone`/`document`/`window`/`AudioContext`/
`Math.random`/`Date.now`, or if any layer above `engine/audio` imports Tone
directly. **Evidence:** `npm run typecheck` (`tsc --noEmit`) exits 0 clean;
`npm run test` → *Test Files 1 passed (1), Tests 14 passed (14)*; `npm run build`
→ *6 modules transformed, ✓ built in 91ms*, emitting `dist/index.html` 0.71 kB,
CSS 0.79 kB, JS 1.31 kB; `npm run dev` serves on `http://localhost:5173` and the
page was loaded in a real browser — it renders correctly with zero console errors
(screenshot: `docs/phase0-scaffold.jpg`). The boundary test was also
negative-tested: temporarily adding `import * as Tone from 'tone'` and
`document.body` to `engine/mapping/sonify.ts` turned 3 tests red with the right
messages, and the file was restored — so the guard genuinely bites rather than
passing vacuously. Tone.js was deliberately **not** installed (Phase 3), no star
or city data exists yet (Phase 1), and nothing was committed or pushed — the
README carries copy-paste `git init`/remote/push and GitHub Pages commands for
Shambu to run himself.

**Decisions made in this phase** (all small, all reversible — flagged for the review gate):

- **`strict: true` and `noUncheckedIndexedAccess` added** to the Vite template's
  `tsconfig.json`, which ships without them. The mapping layer is the deterministic
  heart of the project; catching an `undefined` there at compile time is worth the
  friction.
- **Stub parameters are underscore-prefixed** (`_stars`, `_config`) because
  `noUnusedParameters` is on. They get real names when the bodies land.
- **`.ts` extensions in relative imports**, matching the template's
  `allowImportingTsExtensions` + `verbatimModuleSyntax` settings.
- **`base: './'` in `vite.config.ts`** so the build works from any GitHub Pages
  sub-path without hard-coding a repo name.
- **`vitest.config` folded into `vite.config.ts`** via `vitest/config` — one config
  file instead of two.
- **`@types/node` added as a dev dependency** — the boundary test reads the source
  tree with `node:fs`. It is dev-only and never reaches the bundle.
- **The boundary test is a source-text scan, not a module-graph analysis.** It
  catches the mistakes people actually make (an import statement, a `window.`
  reference) and is honest in its own doc comment that clever indirection would
  slip past it.
- **`instruments/orrery/` holds only a placeholder note**, no TypeScript. The
  folder makes the Phase 6 boundary visible without pulling any of that work
  forward.

**Not done, deliberately** (later phases): no star or city data, no astronomy, no
sonification logic, no Tone.js, no audio, no canvas, no PWA, no export, no orrery
code, no `docs/LLD.md` (Phase 2, when there is a hard part to describe).

**Blockers:** none.

**◇ REVIEW GATE — Atlas HQ · 2026-08-01 · PASSED → proceed to Phase 1.** Reviewed the
full scaffold against the build plan. All type contracts match the spec exactly;
the dependency rule is not just documented but *enforced and negative-tested*
(`boundaries.test.ts`, 14 green) — and the guard correctly forbids `Math.random`/
`Date.now`/`new Date()` in the mapping layer, which pre-protects the Phase-2
determinism requirement. `tsc --noEmit`, `vitest`, and `vite build` all clean; the
dev page renders calm with the honesty label already in place; README carries the
copy-paste git + Pages steps and nothing was pushed under Shambu's identity. All
flagged phase-decisions accepted (strict + noUncheckedIndexedAccess is the right
call for the deterministic heart). No changes requested. One forward-looking note
(not a blocker): the toolchain is on very recent majors (Node 25 / Vite 8 / TS 6 /
vitest 4) — confirm the GitHub Pages deploy path still works at Phase 5.

---

## Phase 1 — Data layer · 2026-08-01 · ✅ complete, awaiting review

Bundled the two datasets the whole project rests on, and made them reproducible
rather than hand-carried. `scripts/build-data.mjs` (zero dependencies — plain Node
`fetch`/`zlib`/`crypto`, including a ~40-line ZIP central-directory reader so
GeoNames needs no unzip binary) downloads **HYG v3.8** and **GeoNames
`cities15000`**, caches the raw files in the gitignored `scripts/.cache/`, and
emits `public/data/stars.hyg.subset.json` (773 KB, **8,849 stars**),
`public/data/cities.json` (138 KB, **1,500 cities across 244 countries**), and a
**generated** `public/data/ATTRIBUTION.md` carrying source URLs, licences,
SHA-256 checksums of the inputs, every transform applied, and the access date —
generated precisely so the honesty claim can never go stale. The critical star
transform is **RA hours → degrees (×15)**, since HYG stores right ascension in
hours 0–24 while the `Star` model is degrees throughout. Typed loaders live in
`src/engine/model/load.ts`, split into pure `parseStarCatalog`/`parseCities`
validators (testable without a browser, and strict about ranges — a star with
RA 400 or Dec 120 is rejected rather than silently placed in the wrong part of the
sky) and thin `loadStarCatalog`/`loadCities` fetch wrappers that raise a `DataError`
naming the file, the entry index, the field, the value found, and how to fix it.
The model layer stays dependency-free (`fetch` is a global, not an import), so the
boundary suite is still green. **Evidence:** `npm run typecheck` clean;
`npm run test` → **53 passed (53)**, up from 14, covering the real bundled files
rather than fixtures — count in band (8,849, asserted 8,000–10,000), magnitude
limit respected, no Sun, unique ids, and spot-checks against published J2000
values: **Sirius** RA 101.2872° / Dec −16.7161° / mag −1.44 / CMa and brightest in
the file, **Betelgeuse** RA 88.7929° / Dec +7.4071° / Ori with B–V 1.50 (red, as it
must be), **Polaris** Dec +89.2641°, **Vega** B–V 0.00; cities resolve correctly —
**Bengaluru** 12.97 N / 77.59 E / +330 min, **London** 51.51 N / −0.13 E / 0,
**New York City** 40.71 N / −74.01 E / −300, and **Kathmandu** at **+345** proving
quarter-hour zones survive. `npm run build` succeeds (13 modules, 4.56 kB JS) and
copies all three data files into `dist/`. The loaders were also **verified in a
real browser** — the dev page fetches both catalogues and reports *"Data loaded:
8,849 naked-eye stars (brightest Sirius, mag -1.44) and 1,500 cities"* with zero
console errors (screenshot: `docs/phase1-data-loaded.jpg`). Regenerating twice
produced **byte-identical** output (md5-compared), so the subset is genuinely
reproducible.

**Two real data problems the tests caught** (both found by assertions written
before the data was inspected, then fixed in the prep script):

- **HYG lists secondary components of multiple-star systems as separate rows.**
  Capella's companion sits **13.2 arcseconds** from Capella; 71 such pairs existed
  under 1 arcminute. Left in, the Phase-2 "brightest N above the horizon"
  selection would have spent two voices on one visible point of light — musically
  wasteful and a small lie about what someone would actually see. The script now
  merges pairs closer than **1 arcminute** (roughly naked-eye resolving power,
  and this is explicitly the naked-eye catalogue), keeping the brighter member.
  Deliberately not greedier: **Mizar and Alcor (11.8′) both survive**, and a test
  asserts both that no pair is closer than 1′ and that those two remain.
- **GeoNames holds distinct cities sharing a name within one country** (several
  Suzhous in China, two Gorakhpurs in India). Since the bundled record carries no
  admin-region field, the picker would show identical-looking rows; the script now
  keeps the most populous of each name+country pair (1,042 dropped across the
  source list). The manual latitude/longitude fallback covers the smaller ones.

**Decisions and honest corrections for the review gate:**

- **The build plan calls GeoNames "public-domain". It is not** — GeoNames is
  **CC BY 4.0**, and HYG v3 is **CC BY-SA 2.5** (Attribution-*ShareAlike*).
  Recorded accurately in ATTRIBUTION.md and the README instead of repeating the
  plan's wording. **Practical consequence worth Shambu's eye: the code stays MIT,
  but redistributing `stars.hyg.subset.json` carries a ShareAlike obligation.**
  Nothing here blocks the build; it only shapes how the data may be re-shared.
- **HYG v3.8 rather than "v3"** — the repo's v3 folder ends at v3.8 and `CURRENT/`
  has moved on to v4.x. v3.8 is the final v3-series release, so it is the closest
  faithful reading of the plan.
- **Sirius is mag −1.44 in HYG v3.8**, not the modern published −1.46. The
  catalogue's value is used as-is (no silent "corrections") and the test asserts
  −1.45 ± 0.1 with the discrepancy noted in a comment.
- **The Sun (HYG id 0, mag −26.7) is excluded.** At that brightness it would swamp
  every other voice, and it is not one of "the stars above you."
- **1,500 cities, chosen as every country's largest city first, then by global
  population.** Guarantees the picker is usable everywhere on Earth rather than
  only in dense regions.
- **Fixed standard UTC offsets, no DST.** `rawOffset` from GeoNames `timeZones.txt`,
  preserving fractional zones. A birth moment inside a DST period is off by up to
  an hour, which rotates the sky by up to ~15°. Stated in ATTRIBUTION.md; the UI
  must say it too (Phase 4).
- **ATTRIBUTION.md is generated, not hand-written**, so its access date and counts
  cannot drift from the data they describe.
- **The app shell now reports data-load status.** This is Phase-1 evidence that
  the loaders work over real `fetch`, not a step toward the Phase-4 UI; it gets
  replaced wholesale by the Birth Sky instrument.

**Not done, deliberately** (later phases): no astronomy — `starsAboveHorizon`,
`julianDate`, and `greenwichMeanSiderealTime` still throw "not implemented"; no
sonification, no Tone.js, no audio, no canvas, no PWA, no export, no orrery, no
`docs/LLD.md`.

**Blockers:** none. Both data sources were open — no login, no payment, no ToS
obstacle.

**◇ REVIEW GATE — Atlas HQ · 2026-08-01 · PASSED → proceed to Phase 2.** Verified
against the actual files, not just this log. The bundled `stars.hyg.subset.json`
was independently checked: the brightest-first ordering is astronomically correct
(Sirius → Canopus → Arcturus → Rigil Kentaurus → Vega → Capella …), RA is stored in
degrees, colours are right (Rigel bv −0.03 blue, Betelgeuse 1.50 red, Antares 1.87),
constellations correct, unnamed stars omit the field rather than nulling it, and
Sirius sits at RA 101.2872 / Dec −16.7161 matching published J2000. The licensing
is now correct and version-matched: **HYG v3.8 → CC BY-SA 2.5**, **GeoNames →
CC BY 4.0**, both recorded in a generated (drift-proof) ATTRIBUTION.md with SHA-256
of the source files, and the ShareAlike obligation on the star subset is flagged
— exactly the grounding standard we set. The loader (`load.ts`) is clean: pure
parse split from fetch, strict range validation (RA 0–360 confirming the hours→deg
conversion, Dec −90..90, tz −720..840), human-readable `DataError`s, model layer
still imports nothing. Two real data problems were caught by tests written before
inspection (double-star merge at 1′ keeping Mizar/Alcor; same-name city dedup) —
good instinct. Loaders verified in a real browser; regeneration is byte-identical.
No changes requested. Accepted decisions: HYG v3.8 as the faithful "v3"; Sun
excluded; 1,500 cities; standard offsets with the DST caveat surfaced for the
Phase-4 UI to state.

---

## Phase 2 — Mapping layer · 2026-08-01 · ✅ complete, awaiting review

Implemented the deterministic heart. `astro.ts` does the standard Meeus alt/az
reduction — `dateISO` + `timeMinutes` − `tzOffsetMinutes` → Julian Date → GMST →
LST = GMST + longitude → hour angle `H = LST − RA` →
`sin(alt) = sin(dec)sin(lat) + cos(dec)cos(lat)cos(H)`, with azimuth from
`atan2(−cos(dec)sin(H), sin(dec)cos(lat) − cos(dec)sin(lat)cos(H))` measured from
north through east. Degrees in and out, radians only inside the trig, sidereal
time computed **once per call** rather than ~8,800 times. The JD formula is linear
in the day term, so a local midnight that resolves to the previous UTC day needs
**no calendar-rollover logic at all** — `d = 32.27` simply means the 1st of the
next month, which is why UTC+5:30 works without a single special case.
`sonify.ts` selects the `maxVoices` brightest stars above the horizon and maps
altitude→pitch (quantized so an off-scale pitch is not unlikely but
*unrepresentable* — the horizon-to-zenith range is divided into
`scaleDegrees.length × 3` discrete steps), magnitude→amplitude **linearly in
decibels** (a magnitude already *is* a log measure of flux, so this is the
physically faithful mapping; the naked-eye span's natural ~32 dB is gently
compressed to 24 dB so the faintest star whispers at ~6% instead of vanishing),
B–V→timbre, azimuth→pan as `0.85·sin(azimuth)` (exactly the east-west component
of the direction you'd face — east +1, west −1, north/south 0, with natural
compression near the meridian and no arbitrary curve), and altitude→twinkle from
**airmass** `1/sin(alt)`, full depth at airmass 5 (~11.5°). A new `scales.ts`
holds five drone-friendly modes. `docs/LLD.md` documents both modules, the stated
simplifications with their error magnitudes, every edge case, and the full test
list. **Evidence:** `npm run typecheck` clean; `npm run test` → **154 passed
(154)**, up from 53; `npm run build` succeeds. All four gate tests pass —
**Polaris altitude ≈ latitude** across 7 latitudes × 7 longitudes × 5 dates × 7
times of day (1,715 distinct skies, all within 1°); **zenith transit** at 8
latitudes (a star with `dec = latitude` reaches altitude 90.000000 at `H = 0`);
**circumpolar geometry both ways** — from London no star below `dec = −(90−lat)`
ever rises and no star above `dec = 90−lat` ever sets, swept over a full day in
20-minute steps; **every emitted pitch on-scale** across 5 scales × 4 roots × 8
times of day plus a 0.1°-resolution sweep of the whole altitude range;
**determinism** by deep-equality on repeated calls, on freshly recomputed skies,
across a JSON round-trip, and with magnitude ties broken by catalogue id rather
than array order. The boundary guard was **re-negative-tested against the new
files**: adding `Math.random()`/`Date.now()` to `astro.ts` and Tone/`document` to
`scales.ts` turned 4 tests red with the right messages before restoring them.

**Hand-verified against an independent sky** (the worked example is in
`docs/LLD.md` §3, for the review gate to re-derive). Bengaluru, 1993-08-01
00:00 IST = 1993-07-31 18:30 UTC → JD 2449200.27083, LST 304.4782° = 20.299 h,
4,279 of 8,849 stars up. LST 20.3 h means stars near RA 20.3 h are on the
meridian, so **Altair** (RA 19.85 h, dec +8.87° — almost exactly Bengaluru's
latitude) must be near the zenith, and it reports **82.2°**. **Deneb** (RA 20.69 h,
dec +45.3°) sits just east of the meridian and north of the zenith → azimuth
**7.7°**, nearly due north. **Arcturus** (RA 14.26 h, ~6 h west) is setting at
altitude **3.7°**, azimuth **288.8°** — and being lowest correctly earns the
maximum twinkle of **1.000**. Antares and Shaula are in the south-west, Fomalhaut
rising in the south-east, and **every winter star — Sirius, Betelgeuse, Rigel,
Capella, Procyon — is below the horizon**, exactly as it must be in August. The
resulting chord is C3 · G4 · E5 · E3 · A3 · G4 · G3 · G3, all members of A
minor-pentatonic.

**Decisions and one thing to listen for at the review gate:**

- **`config.seed` is accepted, validated, and unused in v1.** Nothing in the
  birth-sky mapping needs a random choice — every value derives from the star
  itself. Flagged rather than quietly dropped; it stays in the contract for
  instruments that will need it. The "seed any randomness" requirement is
  therefore satisfied vacuously, and saying so plainly beats inventing randomness
  to justify the field.
- **Two stars at the same altitude get the same pitch, deliberately.** They really
  are at the same height, the unison is consonant by construction, and their
  different pans and timbres make it read as chorus rather than duplication. The
  Bengaluru chord has two such pairs.
- **`starsAboveHorizon` filters rather than returning the whole sky**, so the name
  tells the truth; `sonify` filters defensively too, so it is correct whatever it
  is handed. This corrected a Phase-0 stub comment that said the opposite.
- **A bad config throws; a strange sky does not.** An unknown scale name, a
  non-positive `loopSeconds` or an out-of-range root are bugs and say so loudly
  (listing the available scales). A polar winter with nothing overhead is an
  ordinary sky and returns an ordinary empty score with an honest label.
- **`meta.label` never mentions place or date** — this layer does not know them,
  and inventing them here would be the layer overstepping. The instrument
  prefixes them for display in Phase 4.
- **Julian Dates near 2.45 million exhaust the double's mantissa** at ~5e-10 days
  (~40 µs), so two JD tests use 8-decimal tolerances rather than 10. Noted in the
  test file; it is a property of the number's magnitude, not of the arithmetic.
- **To listen for in Phase 3:** on the Bengaluru night, five of the eight voices
  pan left, because the bright stars genuinely sit in the west that evening. It is
  honest, not a bug — but worth hearing before settling on 0.85 stereo width.

**Not done, deliberately** (later phases): no Tone.js, no audio, no canvas, no UI,
no export, no PWA, no orrery. `createAudioEngine` still throws "not implemented".

**Blockers:** none.

**◇ REVIEW GATE — Atlas HQ · 2026-08-01 · PASSED → proceed to Phase 3.** The deep
gate, verified independently rather than on trust. I re-derived the Bengaluru
1993-08-01 sky with a from-scratch Meeus implementation (not this code): JD
2449200.27083 identical; **Polaris altitude 12.92° ≈ latitude 12.97°**; Altair
82.2° near zenith; Deneb az 7.7° (due north); Arcturus 3.7° setting west → twinkle
1.000; Sirius/Betelgeuse below the horizon — every figure matches. The azimuth
formula is algebraically identical to the standard atan2 form (the cos(dec)
factor cancels). Quantization is **provably on-scale** (pitch = root + scale-degree
+ whole octaves, so off-scale is unrepresentable), scale tables are correct, and
determinism holds (magnitude sort + numeric-id tiebreak, input not mutated, −0
normalized, rounded). Magnitude→dB, airmass→twinkle and sin(azimuth)→pan checked
by hand. 154 tests green; boundary guard re-negative-tested against the new
files. Accepted: seed validated-but-unused in v1 (correct — no randomness to
seed); equal-altitude unison deliberate; mean (not apparent) sidereal time — my
independent GMST differed by ~13″ (the omitted equation-of-equinoxes), far below
the stated ~1°/precession-skipped simplifications. One latent non-issue for later:
`altitudeToMidi`'s final clamp to 0–127 could in theory yield an off-scale pitch
only if `rootMidi` were set high enough to overflow 3 octaves — impossible with the
default A2 root; revisit only if a config ever uses an extreme root. No changes
requested. **Carry into Phase 3:** listen to the west-panning Bengaluru night
before settling on 0.85 stereo width.

---

## Phase 3 — Audio-synthesis layer · 2026-08-01 · ✅ complete, awaiting a LISTEN

Added **Tone.js 15.1.22 (MIT)** and built the graph, split deliberately in two so
the taste is testable: `voicing.ts` is pure and turns a `MusicalScore` into a
plain `AudioPlan` (frequencies, gains, cutoffs, LFO rates), and `engine.ts` — the
**only file in the project that imports Tone** — does nothing but wire nodes to
those numbers. The graph is a drone bed of two oscillators (a 55 Hz sine for
weight, a detuned triangle an octave up for body) under a filter that opens twice
per loop, plus one voice per `MusicalEvent`: `Synth(triangle) → lowpass →
tremolo gain → panner → bus → stereo widener → reverb (9 s) → master → limiter`.
B–V drives each voice's cutoff as a **multiple of its own fundamental** (so high
voices are not dulled by an absolute ceiling) — on the sample sky that puts
Antares, a red supergiant, at a 450 Hz cutoff and Altair at 6242 Hz, which is
audibly the difference between wooden and glassy. `play()` awaits `Tone.start()`
and the reverb's impulse response, and must be driven by a user gesture;
`stop()` releases and ramps the drone down over the same span rather than
cutting; `dispose()` frees every node. `getLevels()` returns per-voice meters —
**verified live in the browser**, eight non-zero values ordered by brightness,
which is the Phase 4 star-glow hook proven early. A dev-only harness
(`harness.html` + `src/harness/`, absent from the production build, confirmed)
loads the fixed Bengaluru sky, plays it, and renders a clip offline.
**Evidence:** typecheck clean, `npm run test` → **183 passed (183)** (up from
154), `npm run build` succeeds. Clip committed at
`docs/phase3-bengaluru-1993-08-01.wav` (18 s, 48 kHz stereo, 3.3 MB);
harness screenshot at `docs/phase3-harness.jpg`.

**Seamless looping is structural, not a crossfade.** Every LFO runs a whole
number of cycles per `loopSeconds` (twinkle rates 5, 7, 9, 11, 13, 17, 19, 23
cycles — mutually prime so voices drift against each other rather than pulsing
together; drone breath 1, filter sweep 2), so at the end of a loop each one is
exactly where it started. Unit-tested across five loop lengths.

**What the measurements say** (I analysed the rendered WAV; see the honesty note
below about what this does and does not establish):

| | first render | shipped |
| --- | --- | --- |
| peak | −17.8 dBFS | **−7.6 dBFS** |
| RMS | −29.2 dBFS | **−18.9 dBFS** |
| stereo balance | −3.43 dB | **−1.02 dB** |
| clipped samples | 0 | **0** |

Envelope: blooms from −21.5 to −18.5 dBFS over the first ~4 s (the 3.5 s attack),
then breathes slowly across about 2 dB for the rest of the loop — no pumping.
Spectral probes at the eight expected pitches all show strong energy, while two
deliberately **off-scale probes (F3 174.6 Hz, B3 246.9 Hz) sit 47–52 dB down** —
independent confirmation that Phase 2's quantization holds in the actual audio
and not merely in the score. Two identical renders were **bit-identical by md5**,
so the audio is reproducible within a session.

**Three real defects the measurements caught, all fixed:**

- **The drone was inaudible.** Two octaves below A2 is A0 at 27.5 Hz — under the
  bottom of human hearing and reproduced by essentially no laptop or phone
  speaker, so the bed would simply have vanished for most listeners. Moved to one
  octave (A1, 55 Hz), added the body oscillator an octave above it, and added an
  audibility floor that transposes the bed up a whole octave when a low pitch
  class (C, D, E…) would otherwise land in the 30 Hz region — the key is
  unchanged, only the register moves. Pinned by a test across roots 33–72.
- **The mix was far too quiet.** −29 dBFS RMS against the roughly −20 dBFS that
  ambient sits at; a listener would have reached for the volume and then been
  startled by whatever they played next. Master gain recalibrated by measuring a
  render, not by taste.
- **`Tone.Limiter` is a glue compressor, not a limiter.** It leaves `knee` at Web
  Audio's default of 30 dB, so it compresses far below its own threshold — it was
  taking ~1.8 dB off a mix peaking at −10 dBFS, flattening exactly the slow
  breathing this piece is made of. Replaced with `Tone.Compressor` at knee 0,
  which does nothing until a stray peak nears full scale. The breathing in the
  envelope above is what that fix bought.

**The Phase 2 carry-in, now measured and decided.** Five of the eight voices pan
left because the bright stars genuinely sat west that night. In the actual render
this comes out as **−1.02 dB of RMS imbalance** — essentially centred, because
the drone bed is mono and the 9 s reverb is wide, and together they anchor the
image. **Decision: keep the mapping layer's 0.85 pan spread and the 0.7 stereo
width unchanged.** The panning is true to the sky, the measured consequence is
about one decibel, and narrowing it would have been cosmetic smoothing of
something real. Ears may still overrule this — that is the phase's gate.

**Honesty note — I have not heard this.** I can measure level, spectrum,
dynamics, stereo balance and reproducibility, and all of those are now where they
should be. None of that establishes that it is *beautiful*, which is the actual
bar. The clip is committed precisely so Atlas HQ and Shambu can judge that.
Relatedly, **seamlessness is guaranteed by construction and unit-tested, but not
yet verified by ear across a loop boundary** — a 54 s three-loop render was
attempted and abandoned when the background tab throttled it past three minutes.
The committed clip also contains the initial bloom, so it is evidence of the
sound, not a loop-ready file; producing one is Phase 5's export work.

**What I would deepen, in order:** (1) the voices are a single triangle through a
lowpass — real bell and glass character wants a second inharmonic partial or a
short FM index, and that is the biggest available gain in beauty per line of
code; (2) the attack is uniform at 3.5 s, so the chord arrives as a block —
staggering entries by magnitude would let the brightest star lead; (3) the drone
is a single pitch, where a slowly-moving fifth underneath would add depth without
touching the truth claim; (4) nothing yet uses `startSeconds`, so the loop has no
internal event — a single soft arrival somewhere in the middle would give the ear
a landmark.

**Not done, deliberately** (later phases): no canvas, no UI, no PWA, no export, no
orrery. The app shell still shows only the Phase 1 data-load line.

**Blockers:** none. One number worth knowing: the production bundle went from
4.58 kB to **234 kB (59.7 kB gzipped)** because Tone entered the graph — expected,
and Phase 5's service worker will precache it.

**◇ REVIEW GATE — Atlas HQ · 2026-08-01 · ENGINEERING VERIFIED, EAR VERDICT = ITERATE
→ Phase 3.5.** Independently confirmed the measurable side: I analysed the committed
WAV in a separate toolchain — all six chord pitches present (C3/E3/G3/A3/G4/E5), drone
A1/A2 solid, **off-scale probes F3 & B3 ~125 dB down** (Phase-2 quantization proven in
the actual audio), 0 clipped samples, ~−20 dBFS RMS, stereo ~1 dB (centred). Code is
clean: Tone fenced to `engine.ts`, `renderOffline` kept in-layer, tidy lifecycle/dispose,
deterministic plan. **But the true gate is beauty, and Shambu listened: the v1 voice
(single triangle+lowpass, block attack) is calm but too plain.** Target set for the
beauty pass: the sound should *elevate the listener — mystical wonder, awe*. Requested a
focused **Phase 3.5** (audio layer only; the deterministic score/truth stays untouched)
before moving to Phase 4.

---

## Phase 3.5 — Beauty pass: "mystical wonder" · 2026-08-01 · ✅ complete, awaiting a LISTEN

Reworked the dressing without touching the truth. **Shimmer** is the headline: a
parallel send is pitch-shifted **up an octave** and fed back into the shifter, so
each pass climbs another octave into a 14 s reverb — tails bloom upward into a
haze instead of merely decaying. The octave is a correctness requirement, not a
preference: **+12 semitones is the same pitch class**, so no matter how many
times the cascade goes round it can never introduce a note the sky did not
choose. The conventional +7 shimmer would have injected a B into A
minor-pentatonic. **Voice timbre** moved from a plain triangle to an explicit
**octave-only partial stack** (1f, 2f, 4f, 8f, with 3f/5f/6f/7f held at exactly
zero), weighted by B–V so hot blue stars glitter and cool red ones stay wooden —
stricter than physics, since even the triangle it replaces carried a 3f twelfth,
but it makes the on-scale property airtight rather than merely probable.
**Entries now bloom**: the score is already sorted brightest-first, so voice index
*is* brightness rank — the brightest star leads and the rest arrive at 0.7 s
intervals over 4.5–6.7 s attacks, like stars appearing at dusk instead of a block
chord. Underneath, the drone's detune **wanders** ±7 cents once per loop so the
beat never settles, and a gentle chorus widens the image. All of it is planned in
the pure `voicing.ts` and merely wired in `engine.ts`. Two directions are
selectable so the ear can choose rather than the author guessing: **`lush`** and
**`subtle`**, differing only in shimmer send/feedback, reverb length, chorus
depth and width — a test asserts style changes **no pitch, pan, gain, or voice
count**. **Evidence:** typecheck clean, `npm run test` → **197 passed (197)** (up
from 183), build succeeds. Two new clips of the same Bengaluru sky, A/B against
the Phase 3 one which is kept: `docs/phase35-lush-bengaluru.wav` and
`docs/phase35-subtle-bengaluru.wav`.

| | Phase 3 | 3.5 lush | 3.5 subtle |
| --- | --- | --- | --- |
| peak | −7.6 dBFS | −4.3 | −6.2 |
| RMS (steady state) | −19.8 | **−19.0** | **−19.1** |
| clipped samples | 0 | **0** | **0** |
| worst off-scale leakage | −43.1 dB | **−52.3 dB** | **−44.8 dB** |
| octave-up energy (A4/A5) | −63 / −72 dB | **−17 / −40** | **−12 / −23** |

**The on-scale guarantee survived, and got stronger.** Off-scale probes (F3, B3,
F#4, B4, C#5, F5) sit **45–52 dB below** the strongest on-scale partial, against
43 dB in Phase 3 — so the shimmer added no off-scale energy at all. Meanwhile the
octave-up content rose by **more than 40 dB**, which is precisely the celestial
haze, and provably the same pitch class. Two consecutive renders were
**bit-identical by md5**, so the granular pitch shifter did not cost
reproducibility.

**A correction to what Phase 3 concluded about the stereo image.** Phase 3
measured −1.02 dB of imbalance and I reported the west-heavy sky as "essentially
centred". That reading was wrong — or rather, it was measuring a mix in which the
sky's placement was largely buried. Computing the balance implied by the score's
own pan values and equal-power panning gives **−4.83 dB** for this night. Phase
3.5 measures −4.4 dB (lush) and −3.2 dB (subtle): the beauty pass did not break
the image, it made the dry voices present enough for the real asymmetry to show.
**So the honest figure for this sky is roughly −4.8 dB left, and that is what the
azimuths dictate** — five of the eight bright stars genuinely sat west that
night. I have left it alone. If it reads as lopsided by ear, the only honest lever
is the mapping layer's `PAN_WIDTH` (0.85), which is Phase 2 territory and locked —
it would need a Phase 2 amendment, not a fix hidden in the audio layer. Separately
I did set the chorus `spread` to 0 rather than the usual 180, because opposite-
phase modulation combs left and right differently and was adding about 0.7 dB of
pull of its own; the stereo image is the score's to decide, not the chorus's.

**Honesty note — I still have not heard any of this.** Level, spectrum, dynamics,
stereo, and reproducibility are measured and in spec; whether it produces
anything like wonder is exactly the thing I cannot measure, and the verdict is
Shambu's. Two things I would flag for that listen: the shimmer feedback at 0.38
(lush) is the single dial most likely to be wrong in either direction, and the
bloom now takes about 9 seconds to fully arrive, which is intentional but means
the first third of an 18 s clip is deliberately sparse.

**Scope:** only `engine/audio/voicing.ts`, `engine/audio/engine.ts`, their
barrels, the tests, and the dev harness (which needed a `?style=` parameter to
render the two takes). `engine/mapping/` and `engine/model/` were not touched —
verified by file mtime. Boundary suite green: Tone still appears in `engine.ts`
alone.

**Not done, deliberately:** no canvas, no UI, no PWA, no export, no orrery.

**Blockers:** none.

---

## Slice A0 — Living Sky design note · 2026-08-05 · ◇ REVIEW GATE: PASSED WITH DISTINCTION → proceed to A1a

`LIVING_SKY_DESIGN.md` reviewed in full by Atlas HQ. The eight push-backs are
not friction — they are exactly the explicit-pushback behaviour the handoff
ordered, each one measured against the real bundled catalogue rather than
asserted. **All eight accepted (P1–P8).** Rulings on the open questions:
(Q1) YES — drop "stick figure" from all copy; say *"a path through its
brightest stars"* until a permissively-licensed asterism set is
licence-verified (the refusal to bundle GPL data unverified is the grounding
rule applied correctly). (Q2) YES — scale + root fixed per session; weather
moves only continuous dials. (Q3) YES — per-session κ in [40,90] with
paceComfort; the compression number is shown in the UI, honesty-line clause
adopted. (Q4) **APPROVED — §10.1 amends the Phase 2 pitch contract**: pitch
class from maximum altitude (90−|lat−dec|, a fixed per-observer truth),
register from current altitude in octaves; HQ verified the formula and accepts
this supersedes current-altitude→pitch for the streaming CHORD (static
MusicalScore/orrery path unaffected); to be re-derived independently at the A1
review. (Q5) YES — default 660 s. Additional notes: P4 (PULSE off by default)
is now *evidence-backed* — Shambu's independent Suno experiment ("Cosmic
Drift") was spectrally analysed and its drum-heavy midsection (percussive
share rising 8%→33%) is precisely where he reported the emotion dropping;
ear and measurement agree. P3 logged as a ticket: re-add `pmra`/`pmdec` in
the prep script before any time-scrub slice. Degree-space transforms (§7.3)
and partition invariance (§3.1) are recognised as the two load-bearing
correctness ideas and must survive any descoping, per §15. **Sequencing
decision: A1 splits into A1a (core stream: time model, closed-form events,
CHORD §10, weather §8, arc + gesture §9, simple single-star LEAD with budgets)
and A1b (constellation motifs §7, full phrase grammar §6.3, development
transforms); PULSE deferred to Slice B wiring.** Halt-review loop continues.

---

## Living Sky — Slice A1a: the core stream · 2026-08-03 · ✅ complete, awaiting review

Built the evolving stream in the pure mapping layer, per the approved design.
Six new modules — `skyTime` (listening ↔ sky ↔ sidereal time), `skyEvents`
(closed-form events), `skyWeather` (statistics → dials), `session` (the
once-per-session plan), `conductor` (salience and budgets) and `stream`
(`renderWindow`) — plus the §12 schema: every `MusicalEvent` now carries a
**`role`** (`ground`/`chord`/`pulse`/`lead`/`weather`), required
`startSeconds`/`durationSeconds`, an optional amplitude `envelope`, and an
**`origin`** naming the real star and the sky-second that caused it. The
astronomy is closed-form throughout — `cos H = (sin A − sin dec·sin lat) /
(cos dec·cos lat)` gives rise, set, culmination *and* the octave-lift crossing
from one function, so there is no search, no sampling and no tolerance anywhere
in the event layer. CHORD follows the approved §10.1: pitch class from the star's
**maximum** altitude (its stable identity), octave by voice-leading toward the
sounding centroid, amplitude swelling through a smoothstep horizon fade. The
Conductor works a fixed phrase grid, ranks true events by salience
(culmination 1.0 > rise 0.6 > set 0.45), and keeps note budget, silence budget,
minimum gap and recency. `solveKappa` chooses the compression so the night's most
dramatic real culmination lands at 68% of the session. **Evidence:** `tsc
--noEmit` clean; `npm run test` → **275 passed (275)**, up from 197, of which 66
are new Living Sky tests; `npm run build` succeeds; `boundaries.test.ts` green.

**Partition invariance holds** — the headline. Five different partitions of an
hour (halves, sixths, an uneven set with a 1-second window, a 1-2-3-second head,
and the trivial one) all reassemble into exactly the single-window rendering,
event for event; every event appears exactly once; 30 s, 120 s and 600 s windows
give identical unions; and a boundary placed precisely *on* a chord onset changes
nothing. It holds for birth-sky sessions too, where the arc and both gestures are
active. Nothing audibly restarts because there is no state to restart.

**The astronomy is cross-checked against Phase 2's independent code**, not
restated: each predicted rise has the star below the horizon 20 listening-seconds
before and above 20 after (via `toHorizon`); each culmination sits at
`90 − |lat − dec|` and is verified to be a genuine local maximum at ±25 s and
±60 s; and the three visibility regimes reproduce the design's measured London
figures exactly — **45 rise-and-set, 21 circumpolar, 26 never-rise** for stars
brighter than magnitude 2.5.

**Hand-derived output, for the review to re-check** (`docs/LLD.md` §4.10 has the
full table). Bengaluru, 1993-08-01 00:00 IST, defaults: **κ solves to 66.40×**,
so 660 s of listening traverses 12.2 sky-hours; the weather picks **dorian**;
**Arcturus** opens alone at t = 0 and is the **last voice sounding at 660 s** —
one, all, one; and the bloom is **Aldebaran culminating at 449 s, 68.0% through**,
which is the κ the design note predicted for Aldebaran in Slice A0. The chimes
either side of it read: Mirfak culminates, Deneb sets, Alsephina rises, Aldebaran
culminates, then Rigel, Bellatrix and Saiph culminate in turn — Orion crossing
the meridian right behind Taurus, which is exactly what that sky does.

**One real bug the tests caught:** a lead chime near the very end rang 2 seconds
past the session, so the closing gesture would have left one star *plus a stray
bell*. Chime durations are now clamped to the session end.

**A finding that corrects the design note.** §P7 said extreme latitudes give a
sparse sky. Measured, that is wrong: **latitude does not make a sky sparse — it
makes it still.** A pole sees half the celestial sphere permanently and that half
holds about as many stars as any other half (4,249 visible at 89.5° against 4,306
at Bengaluru; densities 0.67 either way). The genuinely lonely sky is the
**light-polluted** one — restricting the catalogue to magnitude ≤ 3 drops density
from 0.665 to **0.034**, a twentyfold difference, and that is exactly the
city-dweller the Vision names. The polar sky is still lonely, but through
*stasis*: 59 culminations against 2 rises and 1 set per hour of piece time. The
weather mechanism needed no change — two of my test premises did, and the LLD now
records the corrected story. It also vindicates leaning the LEAD on culmination.

**Two flagged deviations, both deliberate, both cheap to reverse:**

- **The octave lift is decided once per voice** from the star's culmination
  altitude rather than re-evaluated as it climbs. Design §10.1 wanted register to
  follow *current* altitude; doing that means splitting a sustained voice at the
  crossing and crossfading, which risks a click mid-note for a subtle gain.
  `hourAngleAtAltitude` already returns the crossing time, so this is a small
  A1b change if HQ wants it.
- **The voice-leading bound is measured against the canonical centroid** — the
  quantity `chooseOctave` actually optimises — rather than the centroid of
  assigned octaves, which would make the rule recursive and break window
  independence. Budget is 6 semitones of residue plus 12 for a lifted voice;
  measured worst case 17.7.

**A musical wart worth an ear, not a fix yet.** Arcturus is the brightest star up
at Shambu's birth moment, so it opens the piece — but it is *setting*, and at
κ = 66× it drops below the horizon 16 seconds in, returning near the end. The
gesture is structurally correct (it does open and close the piece) and it is
honest, but a 16-second opening voice is thin. The fix, if wanted, is to prefer
the brightest star with a minimum remaining visibility — a one-line change to the
opening-star rule, but it is a design decision rather than a bug, so it is flagged
rather than taken.

**One tooling improvement.** The boundary guard was scanning prose: an error
message that legitimately said "window bounds must be finite" tripped the DOM
rule. It now reduces a file to its **code** — dropping comments and string
contents while *keeping* template-literal `${...}` expressions, which are real
code. Negative-tested: `document.title` in `stream.ts` and a `Math.random()`
hidden inside a template expression in `scales.ts` are both still caught.

**Not done, deliberately** (Slice A1b): no constellation motifs, no
statement→answer phrase grammar, no development transforms (inversion,
augmentation). PULSE is declared in the role union but never emitted, per the
ruling that it is deferred to Slice B and defaults off. No audio wiring — the
audio layer still plays the Phase 3.5 static score; connecting it to the stream
is its own slice.

**Blockers:** none.

**◇ REVIEW GATE — Atlas HQ · 2026-08-06 · PASSED → proceed to A1b.** Deep gate,
independently verified: HQ re-derived the hand-derived table with its own Meeus
implementation — **κ = 66.40× exactly, bloom = Aldebaran culmination at 449 s
(68.0%)**, Arcturus confirmed as the brightest star above the horizon at t0
(mag −0.05, alt 3.7°, Vega second at 0.03), and the Arcturus set-time wart
reproduced (≈14.6–16 listening-s). `hourAngleAtAltitude` checked by hand: the
general form correctly reduces to cos H₀ = −tan(lat)tan(dec) at A = 0; regime
classification (max/min altitude) and the pole degeneracy are correct. The
latitude-makes-still-not-sparse correction is accepted — good science, honestly
reported — and it surfaces a roadmap gem: a **limiting-magnitude "light
pollution" dial** (the same sky from a city vs a dark site, both true) as a
future honest emotional control. *Rulings on the flagged deviations:* (1)
once-per-voice octave lift ACCEPTED for now — click risk outweighs the subtle
gain; revisit at the first audition; (2) canonical-centroid voice-leading bound
ACCEPTED (window independence wins). *Ruling on the opening-star wart:* the
gesture's meaning requires the anchor to still be sounding while the sky
gathers around it — A1b adds a **minimum-visibility rule** (opening star must
remain above the horizon through the GATHERING stage; brightest satisfying it,
plain brightest as fallback), config-flagged for A/B by ear. Sequencing
confirmed: A1b = motifs + phrase grammar + development transforms; then a small
**A2 audition slice** wiring the stream to the existing audio engine so Shambu's
ear can judge the living piece before Slice B's instruments.

---

## Living Sky — Slice A1b: the composed layer · 2026-08-04 · ✅ complete, awaiting review

Added the grammar. `motif.ts` derives a constellation's figure — brightest ≤5
stars above magnitude 3, ordered by the **exact shortest open Hamiltonian path**
(≤120 permutations, so the optimum is computed rather than approximated),
oriented from the brighter end, with the contour taken from declination offsets
and the rhythm from angular separations. All in RA/Dec, so the figure is
identical from every place and date. The Conductor was rebuilt around
**statement → answer → rest**: one phrase per period, the answer transposed down
one scale degree, truncated and quieter, then the scheduled silence. Development
transforms — inversion when a subject is **setting**, augmentation when it
**culminates**, octave shift for register — all operate in **scale-degree space**,
which is the structural reason the on-scale covenant survives the grammar.
`degreeToMidi` folds out-of-range pitches by whole octaves rather than clamping,
because a clamp is exactly how an off-scale note would sneak in at the edges.
**Evidence:** `tsc --noEmit` clean; `npm run test` → **305 passed (305)**, up from
275, of which 94 are Living Sky; `npm run build` succeeds; `boundaries.test.ts`
green and re-negative-tested (a `Math.random()` hidden in a template literal in
`motif.ts` is still caught). Copy and doc-comments say **"a path through its
brightest stars"** throughout; "stick figure" appears nowhere.

**The property test that matters:** arbitrary degree sequences — including
negatives and values like ±456 — pushed through every composition of
transposition, inversion and octave shift, across all five scales and four roots,
never leave the ladder. Measured contours are real: Orion `[-3,-1,-1,2,3]` walks
up through the belt, Cassiopeia `[0,-4,2,2]` zigzags, Canis Major
`[3,3,-1,-2,-3]` falls away from Sirius. **Motif stability** holds across six
observers × four dates (§14.17): identical star path, identical degrees,
identical gaps. **29 constellations qualify**, not the 31 the design note
predicted — that probe used `mag ≤ 3` while the spec says `mag < 3`, and two
constellations sit exactly on 3.00.

**Hand-derivable, Bengaluru 1993-08-01 00:00 IST** (κ 66.40×, dorian, bloom =
Aldebaran culminating at 449 s). Four motifs fire, in the order those
constellations cross the meridian — Cygnus at 5 s, Andromeda at 261 s, Perseus at
389 s, Gemini at 583 s. The phrases either side of the bloom:

```
t=369s  39840        rise           statement [0]        answer []
t=389s  Per (motif)  constellation  statement [-3,-1,-1] answer [-4]
t=417s  Alsephina    rise           statement [0]        answer [-1]
t=449s  Aldebaran    culmination    statement [0]        answer [-1]   <- BLOOM
t=484s  Rigel        culmination    statement [0]        answer [-1]
t=520s  Betelgeuse   culmination    statement [0]        answer [-1]
t=546s  Canopus      culmination    statement [0]        answer [-1]
```

The arc's climax and the Conductor's chosen phrase land on the same event —
**Aldebaran speaks at exactly 449 s**, the moment the piece was paced to reach —
and Orion follows it across the meridian star by star, because that is what that
sky does.

**The opening anchor, and a question for HQ.** All three rules pick a different
star on this sky, which is exactly why it is worth an ear:

| Rule | Star | alt at 0 / 231 / 660 s |
| --- | --- | --- |
| `brightest` | Arcturus (mag −0.05) | 4° / **−49°** / 8° |
| `survives-gathering` | Vega (mag 0.03) | 56° / 9° / **−32°** |
| `bookends` *(default)* | **Polaris** (mag 1.97) | 13° / 14° / 13° |

HQ's ruling was the gathering rule, which gives **Vega** — and it does fix the
thin opening. But Vega has set by the close, so the one → all → one mirror cannot
complete, and forcing it to sound would be a lie. So the default refines the
ruling *within its qualifying set*: prefer a qualifying star that is also up at
the end. On this sky that is **Polaris** — dimmer than the Vision's "brightest
star of your sky", but circumpolar and steady at ~13° all night, so it can
genuinely bookend the piece. Flagged rather than assumed: `openingAnchorRule`
takes all three values and A2 can A/B them.

**Three real bugs the tests caught, one of them structural:**

- **Partition invariance broke** once phrases existed. A note that spilled past
  its own period was dropped by the window holding that period and never picked
  up by the next — present in a single big window, missing from any partition.
  Notes are now bounded to the active portion of their own period, and
  `phrasesInRange` looks back one period as belt-and-braces. Re-proven with
  motifs and phrases active, at three window sizes.
- **The note budget was computed against the wrong denominator.** Dividing the
  per-minute figure by the phrase rate overshoots, because a *sliding* minute can
  straddle two periods; the sliding-window test caught 10 notes against a budget
  of 9.4. It now divides by `floor(60/phrase) + 1`.
- **Negative zero** in a motif contour (`[-0,-4,2,2]` for Cassiopeia) made
  deep-equality fail — normalised.

**A musical fix found by reading the output:** Pegasus and Taurus were firing
near the end of their active portion and getting truncated to a single note. A
one-note motif is not a motif, so a constellation is now only accepted as a
subject when at least 3 of its notes fit; otherwise the Conductor falls through
to the next-best subject. Six motifs became four, and all four now speak in full.

**A performance fix that matters for A2.** `arcAt` in endless mode was measuring
all 8,849 stars for *every* envelope breakpoint. It now follows the fraction of
chord-pool stars above the horizon — 48 reductions instead of 8,849, cheaper and
a better proxy for how full the music should be — and window weather is memoised
on an absolute 30-second grid, so slicing cannot change it. The Living Sky suite
went from **26 s to 2.4 s**, which is the difference between a stream that can be
scheduled in real time and one that cannot.

**Not done, deliberately:** PULSE is still declared but never emitted (deferred to
Slice B). No audio wiring — that is Slice A2, not started.

**Blockers:** none.

**◇ REVIEW GATE — Atlas HQ · 2026-08-06 · PASSED → proceed to A2 (audition).**
HQ re-derived Orion's motif independently from the raw catalogue: exact
shortest open Hamiltonian path over the five brightest = **Rigel → Alnitak →
Alnilam → Bellatrix → Betelgeuse (26.0°)** — identical; contour verified under
the (max−min)/2 half-span definition. Opening-anchor audit reproduced exactly
(Arcturus 4.0° remaining vs 64.1° needed → fails; Vega qualifies; and the
builder's catch is right — Vega sets before the close, so the mirror cannot
complete). **Ruling: the `bookends` refinement is ACCEPTED as default** — it is
the correct completion of HQ's own rule, and Polaris as the anchor has its own
truth-poetry (the one still point of the sky, opening and closing the piece
while everything wheels around it); all three `openingAnchorRule` values stay
for the A2 ear A/B. The partition-invariance regression that phrases introduced
is exactly the failure mode the headline test exists to catch — found, fixed,
re-proven at three window sizes; the note-budget denominator fix, −0
normalisation, the ≥3-notes motif-acceptance rule (a one-note motif is not a
motif — good musical judgment), and the 26 s → 2.4 s suite speedup (real-time
viability for A2) are all accepted. The bloom table is the system working as
dreamed: Aldebaran speaks at exactly 449 s and Orion follows it across the
meridian star by star. **Next: Slice A2 — the audition** (stream → existing
audio, offline clips per anchor rule + the bloom neighbourhood; Shambu's ear is
the gate).

---

## Living Sky — Slice A2: the audition · 2026-08-04 · ✅ complete, awaiting the EAR GATE

The living sky is audible. `src/engine/audio/streamEngine.ts` schedules
`ScoreWindow`s through the existing Phase 3.5 palette: GROUND is a persistent
drone whose level follows the arc, CHORD voices are octave-only partial stacks
swelling on the score's own horizon-fade breakpoints (the swell is the sky's, not
an ADSR's), LEAD chimes and motif notes use a brighter struck-glass voice, and
WEATHER drives the shimmer send and reverb wet. Because every event carries an
absolute piece time, scheduling is arithmetic against a fixed origin — no
crossfade, no re-trigger, no boundary state, which is exactly what partition
invariance bought. A slice may start anywhere: voices already sounding are begun
part-way through with their envelope read at the right offset, so a bloom clip
opens with the bed already in the air. `getLevels()` still reports per-voice, and
`getLevelSources()` now names the star each level belongs to, ready for the
Phase 4 star-field. The harness gained mode, anchor-rule, style and start-time
selectors. **Evidence:** `tsc --noEmit` clean, **305 tests still pass**, build
succeeds, harness confirmed absent from `dist/`.

**Six clips committed under `docs/`** (32 kHz stereo, 30 s each, ~3.7 MB):
`a2-opening-bookends.wav` (Polaris), `a2-opening-survives-gathering.wav` (Vega),
`a2-opening-brightest.wav` (Arcturus), `a2-bloom.wav` (435–465 s, Aldebaran
culminating at 449 s), `a2-bloom-subtle.wav` (same window, subtle style) and
`a2-endless.wav`.

| clip | peak | RMS | clipped |
| --- | --- | --- | --- |
| opening / bookends | −15.2 | −27.5 dBFS | 0 |
| opening / survives-gathering | −15.2 | −27.2 | 0 |
| opening / brightest | −15.9 | −29.1 | 0 |
| **bloom (lush)** | −4.8 | **−19.2** | **0** |
| bloom (subtle) | −6.6 | −20.4 | 0 |
| endless | −11.8 | −25.0 | 0 |

The ~8 dB between the opening and the bloom is not an error — it is the arc. One
star against a full sky *should* be quieter, and Phase 3.5's static chord was flat
to within a decibel for its whole length.

**What is actually in the clips** (re-derivable from `renderWindow`):

```
OPENING 0-30s              BLOOM 435-465s
 0.0s chord Polaris  (alone)    448.8s lead Aldebaran midi 79 [culmination]
 5.3s lead  Cygnus motif        450.2s lead Aldebaran midi 78 [answer, one degree down]
10.9s chord Arcturus            + the sustained chord bed carried in from earlier
13.7s chord Vega
23.7s chord Altair
29.4s chord Antares
```

The opening is the gesture, exactly as designed: one star alone, a constellation
answering, then the sky arriving in brightness order.

**A real bug the measurements caught.** The first bloom render clipped badly —
**6,282 clipped samples, peak 0.0 dBFS, the mix pinned flat at −11 dBFS**. Cause:
a fixed per-voice gain, where the opening has one voice and a later stretch has
twenty. Phase 3.5 avoided this with `masterGain / sqrt(voices)` on a static chord;
the stream now scales each chord voice by `1/sqrt(mean concurrent voices)` sampled
across a full sidereal turn, so the level is steady with no gain jump as the sky
fills. Zero clipped samples everywhere afterwards.

**A correction to what I reported in Phase 3.5.** I claimed "worst off-scale
leakage −43 to −52 dB". That was measured by probing **exact equal-tempered**
off-scale frequencies, and it is too weak a test. A peak-finding sweep of the
lush bloom finds strong energy at 115.0, 235.0, 475.0 and 955.0 Hz — all 14–33
cents off equal temperament, which is exactly why narrow probes missed them. Each
sits a **constant ~4.5 Hz** from an on-scale partial; constant in hertz rather
than cents means it is not a pitch relationship but granular sideband from
`Tone.PitchShift`, the octave-up shimmer. Confirmed by rendering the identical
window in `subtle`: the strongest off-scale peak drops from **+4.0 dB above** the
loudest on-scale partial to **−30.6 dB below** it, and the top six peaks go from
4-of-6 off-scale to **6-of-6 on-scale**. **The mapping layer is not implicated** —
every scheduled pitch is on-scale and 305 tests prove it — but the lush shimmer's
haze is inharmonic, and my earlier measurement understated it. Peak-finding is now
the method of record.

**Honest note on how it sounds — I have not heard it.** What I can say is what is
measurably different from the static chord, and it is not small: notes now *enter
and leave* (the 30 s opening alone contains five arrivals where Phase 3.5 had
eight voices all starting at zero and never changing), the piece has a dynamic
arc of about 8 dB where the old one was flat, there is a melodic line that speaks
and then rests, and a constellation states a four-note figure in the first ten
seconds. Those are the bones the static version lacked — arrival, departure,
phrase, silence, and shape. Whether they add up to *wonder* is precisely the thing
I cannot measure, and it is the gate.

**Two things to listen for, and one recommendation.** First: **the anchor.** The
three opening clips differ only in which star is alone at the start — Polaris
(steady, dimmer, and there at the close), Vega (bright and high but gone by the
end), Arcturus (brightest, and setting — it vanishes 16 s in). Second: **lush vs
subtle at the bloom.** On the measurements I would recommend **subtle as the
default for the streaming palette**: its spectrum is clean where lush's is
dominated by shimmer sideband, and with a living texture there is already plenty
of movement without the haze. That is a measurement-led opinion, not an ear one —
overrule it freely.

**What I could not deliver, and why.** The clips are **30 s, not the 150 s / 190 s
/ 90 s asked for**. Offline rendering runs at roughly half real time through this
graph (two long reverb impulse responses plus a granular pitch shifter), and
Chrome's intensive background-tab throttling reliably kills any render past about
40 s when the tab is not in front — a 150 s attempt ran over five minutes and never
finished. Thirty seconds completes dependably after a page reload. The chosen
windows still contain the events that matter (the whole opening gesture; the bloom
with 14 s of approach). **To render the full-length versions**, open the harness in
a **foreground** tab and use, for example,
`/harness.html?seconds=190&rate=48000&name=bloom-full.wav` with `from` set to 370
— it writes straight into `docs/`. Also worth knowing: `docs/` is now 32 MB of
WAVs. They are all regenerable from the harness, so gitignoring them before the
first push is a reasonable call if the repo weight matters.

**Not done, deliberately:** no samplers, no mood presets, no UI beyond the dev
harness — all Slice B. PULSE is still never emitted.

**Blockers:** none.

**◇ REVIEW GATE — Atlas HQ · 2026-08-06 · ENGINEERING VERIFIED → EAR GATE OPEN.**
All six renders independently re-measured: zero clipped samples, sane levels,
14–17 distinct arrivals per 30 s clip (the static chord had none — the music
demonstrably moves). The corrected off-scale methodology is confirmed by HQ's
own peak-finding: **subtle bloom = 6-of-6 top peaks on-scale** (clean A dorian,
F# sixth present), **lush bloom carries an off-scale A# granular sideband**
(−5.9 dB below the top on-scale peak in a 30 s average; worse at the bloom
instant per the builder's instant measurement). The voice-count-aware master
gain and the honest 30 s-render limitation (Chrome background throttling;
foreground workaround documented) are accepted. Recommendation noted — subtle
as streaming default — pending the only verdict that matters: **Shambu's
listen.** Clips delivered; his ear decides the opening anchor
(bookends/Polaris vs survives-gathering/Vega vs brightest/Arcturus), lush vs
subtle, and above all whether the living sky finally *moves* him. Slice B
brief follows his verdict.

**◇ EAR GATE VERDICT — Shambu · 2026-08-06 · FAILED on musicality.** "All the
sounds seem monotonous … one huge note + a few notes come and go … no ups, no
downs, no crescendo." Honest verdict, honestly recorded. **HQ diagnosis — the
MESO-TIMESCALE GAP:** music lives on three timescales; we built macro (the
11-min arc — real, verified) and are pending micro (Slice B timbres), but the
0.5–3 s layer where the ear binds notes into melody is EMPTY — the Conductor
speaks one phrase per 25–45 s over sustained voices, which perception reads as
isolated events over a hum, not music. Every reference in the Musical Vision
(Zimmer ostinato, handpan cycles, CaS arpeggios, Sigur Rós bowed motion) has
continuous meso-scale motion; deferring/off-defaulting PULSE removed ours (the
Cosmic Drift lesson was over-read — *drums* hurt emotion; gentle figuration is
precisely what the handpan reference proves right). *The 30 s clips also
structurally could not contain the macro arc — render-length spec error, HQ's
share of the miss.* **Fix hypothesis — the FIGURATION layer** (PULSE reborn,
correctly): continuously arpeggiate the CURRENT TRUE CHORD at ear speed,
density/register/velocity riding the arc and weather; covenant-safe (timing is
declared artistic; the pitches remain the real sky's). **Tested cheaply before
any build:** HQ hand-composed a 104 s direction sketch in-session
(A-dorian star chord, staged figuration, Orion's true contour as the climax
figure, statement→answer echo, one→all→one shape) — delivered to Shambu as the
hypothesis test. His verdict on the sketch gates the next slice; no build until
the direction is ear-confirmed.

**◇ SKETCH VERDICT — Shambu · 2026-08-06 · DIRECTION CONFIRMED. "This is much
better… I get the flow and this makes so much sense… I am excited again."**
The meso-timescale hypothesis is ear-validated; the figuration layer is the
fix. Two craft notes from his listen, both correct and both now acceptance
criteria for A3: **(1) transitions** — at 16 s / 40 s / 52 s the sketch
hard-switches patterns with no bridge ("done in haste"); the engine must evolve
patterns gradually (≤1 slot changed per cycle; transitional/anticipation
cycles at stage boundaries; density and register move continuously, never
step). **(2) instrument quality** — acknowledged; the sketch's numpy plucks are
the floor, Slice B's sampled instruments are the fix. New taste reference
registered: **Motorcycle Diaries OST (Santaolalla)** — sparse plucked intimacy
carrying large emotion → the figuration wants organic, finger-played warmth
(favors handpan/kalimba/felt-piano/nylon-adjacent plucks in the B palette).
**Next: Slice A3 — the FIGURATION layer in the engine**, then re-audition at
full length, then B.

---

## Living Sky — Slice A3: the FIGURATION layer · 2026-08-06 · ⚠️ ENGINE COMPLETE, AUDIO EVIDENCE BLOCKED

The meso layer exists. `src/engine/mapping/figuration.ts` weaves continuously
through the chord that is currently sounding, at ear speed — the 0.5–3 second
timescale the ear-gate diagnosis identified as empty. Its whole vocabulary is
`soundingChordTones`, extracted into a new `chordVoices.ts` so the figuration and
the CHORD events cannot disagree about what is in the air; a figuration note can
therefore only ever double a pitch that is genuinely sounding, which makes the
layer **on-scale and true by construction rather than by a check**. The dormant
`pulse` role is renamed **`figuration`** — the old name was part of why it stayed
dormant, since "a pulse is a beat" and the percussion lesson got over-read into
"no meso layer at all", when the handpan reference shows a soft cyclic weave is
exactly right. **Evidence:** `tsc --noEmit` clean, **326 tests pass** (up from
305), build succeeds, boundary guard green and re-negative-tested on the new
files. Over a full session the figuration contributes **716 notes** against 46
lead, 44 chord and 22 each of ground and weather — the meso layer is now by far
the densest, as it should be.

**The design problem, and how it was solved.** The pattern must evolve by at most
one slot per cycle *and* remain a pure function of absolute time, or partition
invariance dies. Iterating forward needs unbounded history, so instead every slot
carries a deterministic **change epoch**: a seeded permutation maps each
cycle-residue to the one slot allowed to change then, and because that map is a
bijection **exactly one slot changes per cycle by construction**. The key move is
that *everything* about a slot — its tone and whether it sounds at all — is read
at its own change cycle, so every other slot resolves to the same value it had a
cycle earlier and literally cannot differ. Density therefore rides the arc
continuously as a *target*, and each slot adopts it when its turn comes. An
earlier attempt suppressed the re-pick on "density cycles" instead; it failed at
cycle 32, because suppression only *shifted* the change rather than removing it.

**The evolution, measured across the GATHERING → BUILDING boundary** (cycle 17,
t = 74.8 s; `·` is a silent slot, and the last column is how many slots differ
from the line above):

```
cycle   t(s)   stage       slots                                          diff
   13   57.2   gathering   ·  ·  ·  Vega     ·  Fomalhaut Achernar Deneb    —
   14   61.6   gathering   ·  ·  ·  Vega     ·  Fomalhaut Achernar Deneb    1
   15   66.0   gathering   ·  ·  ·  Polaris  ·  Fomalhaut Achernar Deneb    1
   16   70.4   gathering   ·  ·  ·  Polaris  ·  Fomalhaut Achernar Deneb    1
   17   74.8   gathering   ·  ·  ·  Polaris  ·  Fomalhaut Achernar Deneb    1
   18   79.2   building    ·  ·  ·  Polaris  ·  Vega      Achernar Deneb    1
   19   83.6   building    ·  ·  ·  Polaris  ·  Vega      Achernar Deneb    1
   20   88.0   building    ·  ·  ·  Polaris  ·  Vega      Achernar Fomalhaut 1
   21   92.4   building    ·  ·  ·  Polaris  ·  Vega      Shaula   Fomalhaut 1
```

The stage boundary passes through as a **single tone substitution**, Fomalhaut →
Vega. No pattern switch, no density step, no lurch — which is precisely the craft
note from the sketch listen. Tests assert this over every cycle of the session and
over 400 cycles of endless mode, plus: migration is gradual (a set star's slot
falls silent at once, then takes a new tone only at its own next change cycle);
the note rate never steps more than the configured bound at a stage boundary; the
anticipation cycle dips velocity without touching the slot count, so only one
parameter moves; humanisation is deterministic, bounded, and never reorders the
weave; and **partition invariance survives with figuration active** at three
window sizes.

**Two rendering fixes, one of which finally explains Slice A2.** A2's long renders
never finished and I attributed it to background-tab throttling without proof.
The source confirms it: Tone's `OfflineContext.render()` defaults to
`asynchronous = true` and yields to **`setTimeout(done, 1)` every render block** —
exactly what Chrome throttles to roughly once a minute in a hidden tab.
`renderStreamOffline` now drives an `OfflineContext` directly with
`render(false)`, immune to timer throttling. Separately, every voice was being
given a `Tone.Meter` (an AnalyserNode); they are needed live for the star-field
but are pure waste offline, and are now off for renders.

**What I could not deliver: the audio.** The full-length renders did not complete.
With the throttling fix in place a render now *progresses* indefinitely instead of
stalling — that part is genuinely fixed — but throughput in this environment is
far too low: a **660 s render ran 29 minutes**, a **330 s half ran 31 minutes**,
and after the meter optimisation a **60 s clip still took over 16 minutes**
without finishing. The figuration is itself part of the cost — it roughly triples
the note count, and every note currently builds a `Tone.Synth` with a `custom`
partials oscillator, which means constructing a PeriodicWave per note. That is
worth fixing in Slice B anyway, where sampled instruments replace these synths and
should be markedly cheaper per note.

So this slice halts **incomplete on evidence**. The engine is done and verified in
the score; the ear gate cannot open until there is something to hear. To produce
the clips, open the harness in a **foreground** tab (the renderer no longer stalls
there) — `npm run dev`, then
`/harness.html?seconds=660&rate=32000&name=a3-birthsky-full.wav`, and for endless
mode switch the mode selector and use `seconds=180`. Expect roughly half an hour
per full session on this machine. I would rather say that plainly than ship a
30-second clip and call it an audition, since 30 seconds was structurally unable
to show the arc last time and would be no better now.

**A judgement call worth flagging:** I chose to keep the existing reverb/shimmer
tail rather than thin it to make renders finish. Cutting it would have produced
clips fast, but they would not be the piece Shambu is being asked to judge.

**Not done, deliberately:** no samplers, no mood presets (Slice B). The Motorcycle
Diaries reference — sparse plucked intimacy — is recorded for that palette; the
current figuration voice is a deliberately soft synth pluck and is the floor, not
the target.

**Blockers:** the ear gate needs a foreground render, which I cannot drive from
here.

**◇ REVIEW GATE — Atlas HQ · 2026-08-07 · ENGINE PASSED; RENDER BLOCKER SOLVED
BY HQ; EAR GATE OPEN.** The cycle table is exactly what the sketch verdict
demanded — the GATHERING→BUILDING boundary passes as a single tone substitution
(Fomalhaut→Vega), ≤1 slot per cycle asserted across the whole session and 400
endless cycles, anticipation moves one parameter only, migration is gradual,
partition invariance holds with figuration active. The A2 stall root-cause
(Tone's async offline render yielding via throttled setTimeout) and the
`render(false)` fix are accepted; the refusal to ship a 30 s non-audition and
the keep-the-reverb judgement call are both endorsed. **Render throughput
blocker resolved without the 30-min browser bake:** HQ added
`test/a3ScoreExport.test.ts` (score → JSON in 1.05 s — the pure layer paying
off) and rendered the TRUE engine score with the ear-approved sketch
synthesizer — full 660 s birth-sky session (850 events: 716 figuration / 46
lead / 44 chord, A dorian, Polaris bookends) + 180 s endless, delivered to
Shambu as mp3. Voices are sketch-grade (Slice B replaces them); the
COMPOSITION under audit is 100% engine. Note for Slice B: per-note synth cost
(PeriodicWave per note) is the real render bottleneck — samplers should fix
speed and beauty together. **Shambu's full-length verdict decides Slice B.**

**◇ EAR REPORT + FORENSICS — 2026-08-07 · Shambu: "continuous background note…
sounds like noise… other notes on top." HQ stem analysis: HIS EAR WAS RIGHT —
THE HQ RENDER'S MIX WAS INVERTED; the composition never reached him.** Stems of
the v1 render (steady state): chord bed −7.6 dBFS (loudest!), ground −12.4,
lead −29.3, **figuration −42.6 — the A3 layer sat 35 dB under the bed,
perceptually nonexistent**. Causes, all in HQ's renderer, not the engine: (1)
HQ failed to apply the concurrent-voice normalization the A3 builder documented
(≈20 simultaneous chord voices summed raw); (2) **ground AND weather both emit
midi 45 (A2)** — two roles stacked on one pitch for all 660 s = the "continuous
note," their mutual detune-beating = the "noise" (bed measured spectrally pure;
no actual noise); (3) figuration velocities (magnitude-derived, mostly faint)
rendered uncompressed. **v2 rendered and delivered** with the corrected
hierarchy — figuration foreground (velocity √-compressed), chord ÷√N, ground
halved, weather as octave-up whisper (never unison with ground), darker reverb,
38 Hz highpass. **THE MIX LAW (quantified, now Slice B acceptance criteria):**
steady-state stem targets — FIGURATION ≈ −19 dBFS (3–5 dB ABOVE the combined
bed), LEAD ≈ −21, GROUND ≈ −23, CHORD bed ≈ −25 concurrency-normalized,
WEATHER ≈ −34; motion in front, vastness behind. Slice B's audio layer must
implement + assert these as measured stem levels, and must NOT voice weather in
unison with ground. Engine-side note for B: consider weather events carrying a
distinct register/timbre hint so renderers cannot repeat this mistake.
Shambu's v2 listen is the reopened ear gate.

**◇ STRATEGY CHECKPOINT + v2 VERDICT — 2026-08-08.** Shambu on v2: "much
better, a good starting point" — but still lacking FORM (rhythms, patterns,
build-ups, transitions-like-mixing), and he challenged whether the path
converges. HQ diagnosis ratified: A3 over-corrected the transition note into
imperceptible drift; repetition belongs at MESO (patterns must be learnable),
non-repetition at MACRO — we had it inverted. His "lead music toward a pattern,
shift like a DJ mix" model formalized as the FORM LAYER (see MUSICAL_VISION
addendum §6b): movements anchored to real sky structures, motif-as-ostinato,
transitions as first-class objects, pattern-vocabulary = composed clothing
under the truth covenant. Process rule added: form iterates in HQ sketches
before engine code. EXECUTED: vision amended; **sketch v3** composed from the
true A3 score (5 movements — Polaris/Cygnus · Still Night · Andromeda ·
Bloom-build with Zimmer additive layers peaking at Aldebaran 449 s · Gemini/
Return — 12–16 s crossfade transitions with breath swells, real motifs replayed
as section grooves, v2 mix law); **UX bar sketch** rendered (all 4,279 true
stars above Bengaluru at the birth moment, B–V-coloured, magnitude-sized,
sounding stars haloed — feasibility answer to the NASA-crisp requirement).
Both delivered. Confidence caveat logged at Shambu's prompt: two of three
musical hypotheses failed before one landed; gates remain the only authority.
NEXT: his v3 ear verdict (form) + visual verdict (bar) → then A4 movement-
planner spec from the approved sketch → then Slice B instruments + mix law.

---

## Living Sky — Slice A4: the Movement Planner (Form Layer) · 2026-08-06 · ✅ complete, awaiting review

The night is a setlist. `src/engine/mapping/movement.ts` partitions a session
into movements anchored to real structures — constellation prominences, the
bloom, and the unanchored still stretches that are themselves a fact about the
night — each with its own figuration pattern, register and density, joined by
transition zones. The plan is computed **once in `prepareSession`** and stored on
the `SessionPlan`, so `renderWindow` only ever reads it: partition invariance is
now structural rather than careful, because a window derives no form at all.
This inverts A3's doctrine as §6b instructs — **repetition at the meso scale**
(inside a movement the rhythm mask is *identical* cycle after cycle, so a groove
can be learned) and **non-repetition at the macro scale** (every adjacent pair of
movements differs in pattern or register, asserted). What still breathes within a
movement is the tone assignment, at most one slot per cycle. **Evidence:**
`tsc --noEmit` clean, **351 tests pass** (up from 330), build succeeds, boundary
guard green. Score exported to `docs/a4-score.json` (397 KB) by
`test/a4ScoreExport.test.ts`, now carrying the movement plan alongside the events
so HQ's renderer can mix each section on its own terms and the boundaries are
auditable without re-deriving them.

**The Bengaluru session** — κ 66.40×, A dorian, bloom = Aldebaran at 449 s:

| # | body | seam | pattern | reg | anchor | fig. notes | ostinato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0–124 | 12 s | `sparse-low` | −1 | opening / Polaris | 56 | — |
| 1 | 136–219 | 16 s | `mid-weave` | 0 | constellation / Peg | 71 | 5 |
| 2 | 235–377 | 22 s | `half-time-still` | −1 | constellation / Cas | 32 | 8 |
| 3 | 399–480 | 12 s | `dense-build` | +1 | **bloom / Aldebaran** | 273 | — |
| 4 | 492–551 | 16 s | `mid-weave` | 0 | constellation / Aur | 53 | 4 |
| 5 | 567–660 | — | `thinning-return` | 0 | return / Polaris | 55 | 6 |

**Against v3's hand-composed boundaries** (0/88/104/252/268/384/398/556/572):
M0 starts at **0 (Δ 0 s)** and the bloom movement at **399 against v3's 398
(Δ 1 s)**. Those two are the pillars the sky itself dictates — the session origin
and the true climax — and the engine finds them independently of the sketch. The
middle boundaries differ by 32–80 s because v3's were placed by ear over the same
score while the engine anchors them to prominences (Pegasus, Cassiopeia,
Auriga), and it draws six sections where the sketch drew five. Density carries
the contrast the sketch was reaching for: **273 figuration notes in the bloom
movement against 32 in the still one**, an eightfold swing. The bloom's Zimmer
stack ramps `1 1 2 2 3 3 3 3 3 3 3` into the climax and strips `2 2 1 1` after —
octave doubling, then off-beat echo, then high sparkle, every layer a whole-octave
transposition so the on-scale guarantee is untouched.

**Four real bugs the tests caught, two of them structural:**

- **The bloom got no movement of its own.** Candidates were taken in time order,
  so Taurus claimed the boundary just before the climax and the bloom then failed
  the minimum-length test — the additive build had nowhere to happen and
  `bloomLayersAt` returned zero for the whole session. The climax is now placed
  first and is mandatory; everything else fits around it.
- **Partition invariance broke.** The off-beat echo sits half a slot after its
  base note and was gated on the *base* note's window membership, so an echo the
  far side of a window edge was dropped by both windows — the same shape of bug
  the phrase grammar hit in A1b. Every layer is now filtered by its own onset.
- **The crossfade could not reach its target count.** Every pattern in the
  vocabulary sounds slot 0, so the outgoing and incoming passes can claim the
  same slot and fall short; the ramp stalled and then jumped two slots. A top-up
  pass fills from whatever remains, incoming first.
- **Seams were too short for their own density gap.** A mask is integer-valued,
  so it cannot move more than one slot per cycle without an audible step — five
  slots cannot be crossed in four cycles whatever the *average* rate says. Seams
  now run `max(12–16 s, gap × cycle)`, which makes the widest change (1 slot to 6)
  a 22 s mix. **This deviates from the specified 12–16 s band, deliberately**: the
  band is right for an ordinary change and arithmetically impossible for the
  widest one, and a bigger change earning a longer mix is what a DJ would do.

**A distinction worth recording, found while writing the tests:** the LEAD and
the FIGURATION both state constellation motifs, and they do it differently. The
lead speaks the figure melodically in its own register, from the anchor degree
plus the contour; the figuration grooves it on the **nearest currently-sounding
chord tone**. Both are on-scale, but only the figuration promises to double a
live tone. My first test applied the figuration's rule to lead notes and
correctly failed. The tests now keep them apart, and so does the LLD.

**Superseded A3 tests, restated rather than deleted.** A3's "≤1 slot changes per
cycle" assumed a continuously drifting pattern. Under A4 the guarantee inside a
movement is *stronger* — zero rhythmic change — so the test now asserts the mask
is identical across a movement body, that tone assignments still move at most one
slot per cycle, that adjacent movements contrast, and that a seam ramps the note
rate monotonically within the bound. The note-rate measure also changed to count
active slots rather than notes emitted: a slot briefly without a tone (its star
has set, and it waits for its own change cycle) is a fact about the sky, not a
step in the form, and folding it in made a smooth ramp look jagged.

**Territory respected:** only `src/engine/mapping`, `test/` and `docs/`. No audio
files and no `public/samples` were touched. Committed locally; no remote exists
and nothing has been pushed.

**Not done, deliberately:** no audio-layer work — the figuration voice is still
A3's soft synth pluck, and the movement plan carries pattern/register/density
that Slice B's instruments and mix law will read. HQ renders the audition.

**Blockers:** none.

**Housekeeping note.** `test/a3ScoreExport.test.ts` is removed, superseded by the
A4 export. It had a side effect worth naming: every full test run silently
rewrote `docs/a3-score.json`, so the A3 artifact HQ actually rendered from was
being overwritten with A4 output under an A3 name. That file is restored to what
HQ rendered. The parallel stream's `public/samples/` and sample-fetch scripts
appeared in the tree during this slice and are deliberately left untracked — they
are not this slice's to commit.

**◆ SLICE B0 — SAMPLED INSTRUMENTS + THE FAST RENDERER — 2026-08-07.** The
30-minute browser bake is dead: `scripts/render-score.mjs` reads
`docs/a3-score.json` and the bundled samples and prints a finished stereo WAV in
Node — no browser, no Web Audio, no Tone — at **15–19× real time** (a 60 s
audition in ~4 s; the whole 510 s steady state in ~25 s). It seeds Phase 5's
share export. **SOURCING, all verified from the authoritative source before
anything was bundled** (`docs/ATTRIBUTION_AUDIO.md`: 133 notes, every one with
source URL, pinned version, licence, SHA-256, access date 2026-08-06): VCSL and
VSCO 2 CE, both CC0, pinned to commit SHAs with their in-repo `LICENSE` read;
Salamander Grand Piano V3 — **and here the sources disagree**, the author's own
page declaring it public domain as of 2022-03-04 while the FreePats distribution
we actually downloaded still says CC BY 3.0, so we take the stricter and carry
the credit line; two individually-verified CC0 Freesound sounds for the handpan.
Freesound's API needs a token and its originals need an account, so those two are
public preview renditions and the only lossy-sourced material in the bundle —
stated plainly rather than papered over. **Singing bowls are a genuine gap**: no
CC0 set with a usable note map was found, so the bowl slot is filled by Nepalese
hand bells and hand chimes and *named as such* instead of mislabelled. Pitch is
measured, not assumed — seven sources are unnamed or misnamed, including a
Freesound upload titled "F3" whose strike measures **F4** with no energy at all
at 175 Hz. Encoded mono 44.1 kHz, Opus 64k (`.ogg`) + LAME V5 (`.mp3`); the ogg
slot is **Opus, not Vorbis**, because the pinned ffmpeg has no libvorbis, and the
runtime asks the browser which it can play. Per-lens payload **1.30–2.33 MB
primary, 2.14–2.97 MB full chain**, all inside the ≤3 MB target; 4.44 MB for all
five. **THE LENS CONFIG** lives in `public/samples/lenses.json` — data, not code,
because the live app and the Node renderer must make identical instrument
choices and only one shared file keeps them honest; `samplerLenses.ts` types and
validates it, `samplerBank.ts` does lazy per-lens `Tone.Sampler` loading
(primary tier first, fall-throughs in the background). **Infra only — nothing is
wired into the running app, and `engine/audio/index.ts` is deliberately
untouched; that is B1's, and it is the parallel stream's file.** **THE MIX LAW is
implemented and asserted**: stems are measured over the steady state (the section
minus its opening bloom and closing return) and trimmed to the ratified targets,
and `npm run check:mix-law` **PASSES on all five lenses** — figuration −19.0,
lead −21.0, ground −23.0, chord −25.0, weather −34.0 dBFS, every lens, exactly.
**The checker earned its keep by failing three times on real defects**: (1)
concurrency was normalised by the section's *maximum* voice count, so the chord
bed ran 6 dB hot as the sky filled — now normalised against the *instantaneous*
count, slewed; (2) peak-normalised samples still spanned a **19 dB** loudness
range, so a role falling through from one instrument to another lurched — each
instrument now carries a measured `levelDb`; (3) the TX81Z Clavisynth, bundled as
the Pulse pad, **decays 50 dB in three seconds** — looping it to hold a chord
loops silence. It is dropped, Pulse's sustained roles moved to bowed vibraphone,
and `fetch-samples.mjs` now refuses any `sustained` instrument whose loop region
sits >12 dB under its attack. **Two things for Shambu's judgement, measured and
reported rather than quietly resolved:** the law's prose says figuration sits
"3–5 dB ABOVE the combined bed", but read as a power sum its own numbers give
**1.9 dB** (−23 and −25 sum to −20.9; −19 is 1.9 over) — the absolute stem
numbers are asserted exactly and the combined-bed margin is reported, because
tightening it means re-ratifying the targets, which is not the tool's call. And
**the A3 score still voices ground and weather both on midi 45** — the 2026-08-07
defect, live in the artifact; the renderer lifts weather an octave and the
checker asserts the separation, but the engine-side fix (a register hint on
weather events) is the mapping stream's. **EVIDENCE, committed:** five 60-second
clips, `docs/b0-{aurora,embrace,sonata,pulse,ground}-60s.mp3`, all printed from
the same window — t=360–420 s, the densest minute of the birth session (82
figuration onsets, 7 lead phrases, 30 chord voices, all five roles present) —
through one **shared** master fader of −11.8 dB, so the five can be A/B'd
honestly: per-clip peak normalisation would have printed them 9 dB apart, which
is crest factor talking, not music. They are quiet on purpose; turn it up. Plus
`docs/b0-mix-law.json` (measured stems, the per-window arc, headroom) and
`docs/b0-*-render.json`. Lens invariance holds — all five play the same notes at
the same times. 351 existing tests pass, typecheck clean. **NEXT: Shambu's ear
verdict on the five lenses — that gate decides B1 (wiring the bank into the
stream engine).** HALT.

**◇ DOUBLE REVIEW GATE — Atlas HQ · 2026-08-09 · A4 PASSED + B0 PASSED (incl.
grounding gate) → and the MUSIC GATE IS PASSED BY SHAMBU.** A4: 351/351 tests
(suite 8 s); movement table verified — the sky-dictated pillars match the v3
sketch (origin Δ0 s, bloom 399 vs 398 s), six movements anchored to real
prominences the sketch's ear missed (Peg/Cas/Aur), 8× density swing (273 vs 32
figuration notes), Zimmer stack ramps/strips cleanly, on-scale preserved via
whole-octave layers; the a3-score overwrite corruption caught+restored is
endorsed. B0: all 133 notes carry URL/version/licence/SHA-256/date; Salamander
stricter-of-two accepted; bowls→hand-bells honesty accepted; measured-pitch
catch (mislabelled "F3"=F4) noted; per-lens ≤3 MB; mix law asserted and passing
on all five lenses; renderer 15–19× real time (full session ~80 s on-device,
rendered as two halves + HQ crossfade join at 330 s due to tool timeout).
*Rulings:* (1) the mix law's ABSOLUTE stem targets are the ratified law — the
"3–5 dB above bed" prose was HQ's imprecise gloss; measured +1.9 dB margin
stands; future separation adjustments lower the bed. (2) ground/weather midi-45
unison → engine-side registerHint fix is B1 task #1 (narrow, documented mapping
exception for the audio stream). **SHAMBU'S VERDICT on the A4×Aurora full
session + five lens clips: "The tunes are really good now. I am satisfied."**
After three failed ear gates (static chord → events-over-drone → figuration-
without-form), the composition + instruments stack has passed the only gate
that matters. Defaults hold (Aurora birth / Ground endless) until he says
otherwise. **ASSEMBLY PHASE OPEN: B1 (live instrument wiring) ∥ Phase 4 (the
face) in parallel territories → then Phase 5 (PWA/share/GEO) → Slice C entry →
Capacitor → App Store.**

**◆ PHASE 4 — THE CALM FACE — 2026-08-07.** The app is no longer a placeholder:
open it and your real sky is already drawn, press once and it sings, and the
stars that are sounding glow. **THE STARFIELD is Canvas 2D, deliberately.** The
load is ~4,400 stars above the horizon drawn as pre-rendered sprites, measured
at **8.9 ms/frame on desktop (1440×900, 4,489 stars) and 1.7 ms on an iPhone 13
viewport** — comfortably inside the 16.7 ms budget, with the honest reason to
reach for WebGL (tens of thousands of points) an order of magnitude away. What
staying in 2D buys is worth more than the headroom given up: no shader
pipeline, no context-loss path, no driver variance, and it works in every
browser the Capacitor ship path ends in. Deep-sky objects or the century
time-scrub are the moment to switch, and projection/colour/glow are kept
renderer-agnostic so the swap costs one file. **Projection is stereographic
azimuthal** (zenith centre, horizon on the rim) rather than the simpler
equidistant fisheye because it is conformal — constellations keep their real
shapes to the horizon, and shape is precisely what §2.1 teaches the ear to
recognise. North up, east LEFT: a view looking up, with the cardinal marks
saying so. **Colour is the truth covenant applied to pixels:** catalogue B–V →
effective temperature (Ballesteros 2012) → Planckian locus (Kim 2002) → sRGB.
Blue stars are blue because they are hot. The one taste number on the screen is
the *saturation* (0.68), pulled back from raw chromaticity because a real sky is
nearer white than a bag of confetti — and it is labelled as taste in the source.
**GLOW-SYNC works off two crossed sources:** the engine's meters give the true
per-voice level, the app's own `renderWindow` says which stars the score intends
to be sounding, and a level is only believed when both agree. That cross-check
closes a real hole — `getLevelSources()` is only rebuilt when the voice *count*
changes, so two different voice sets of equal size can leave the names stale;
crossed, a stale name simply fails to match instead of lighting the wrong star.
The current LEAD gets the strongest halo, a 2.5 s afterglow so the eye can find
what the ear just heard, and its name in serif. **THE ONE PRINCIPLE IS ENFORCED
STRUCTURALLY, not by discipline:** `gestures.ts` and `projection.ts` import the
camera and nothing else — there is no path from a pan to the engine — and a
Playwright test drags and pinches mid-session and asserts the piece's clock
neither jumps nor resets. **THE SCREEN** is the walkthrough's list and nothing
else: Tonight (geolocation optional, endless, Ground default) / Birth Sky (city
autocomplete over the bundled 1,500, date, optional time, 11 minutes, Aurora
default), five lenses, play/pause, the honesty label, and the time-compression
line carrying **this session's own κ** ("about 45 minutes of real sky" for
endless, 63 for the birth sky measured here) because κ is solved per session and
a fixed figure would be a lie. No onboarding, no settings, no account. **States:
loading / ready / playing / complete / no-geolocation / no-stars-up — never a
crash, always a sentence and a way forward.** *Six defects found by looking at
the screenshots rather than at the code:* `[hidden]` losing to `display: grid`,
which left the Birth Sky fields showing in Tonight mode; the background wash
scaling with zoom so the sky got *lighter* the closer you looked; the dome
centred in the full viewport so the phone's panel buried its southern half (now
the dome is fitted to the unoccluded area, measured, not guessed); the mode's
default lens not being adopted on a switch; a translucent city dropdown that let
the form ghost through it; and an endless session showing a full progress bar,
which reads as "finished". **HONEST LIMIT:** the lens picker is fully wired as
UI and state, but the live engine's only timbral dial is still `AudioStyle`
('lush' | 'subtle'), so that is the whole of what a lens currently changes.
B0's sampled instruments reach the stream in B1; the seam is one named function
(`audioStyleForLens`) and it says so out loud. Also noted: the
`ux-bar-birthsky.png` sketch is not in the repo — the quality floor was taken
from this log's own description of it (all true stars above Bengaluru, B–V
coloured, magnitude sized, sounding stars haloed), and the screenshots below are
against that. **EVIDENCE:** 16 screenshots — every state at desktop 1440×900
(Chromium) and iPhone 13 (**mobile WebKit**, the engine iOS actually ships) —
`docs/phase4-*.png`; 14 Playwright tests green across both, covering load →
session → canvas-keeps-animating (asserted by pixel diff, not by a single
frame), the camera invariant, and a refused location; **Lighthouse on the
production build: 100 desktop / 98 mobile, 297 KiB transferred, FCP 0.3 s /
1.9 s, CLS 0.01**. The first Lighthouse run scored 63 and was thrown away — it
had hit a dev server serving a 3 MB unminified Tone.js, which is a measurement
of the harness, not the app. 385 unit tests pass; typecheck clean. **NEXT:
Shambu's eye on the sixteen screenshots — that gate decides whether Phase 4 is
done or the face needs another pass.** HALT.

---

## 2026-08-07 — Slice B1: the sampled instruments reach the live app

**WHAT LANDED.** The app now plays the real instruments. `sampledStream.ts` is
the live player: it reads the score from the mapping layer, voices it through
the mood lenses, and mixes it under the mix law and a new mastering law. Six
tasks, and the two that mattered most turned out to be the ones nobody asked
for.

**1 — THE UNISON DEFECT, FIXED AT SOURCE.** `MusicalEvent` gains
`registerHint`, weather carries `+12`, and `stream.ts` emits it. On 2026-08-07
stem forensics found ground and weather both on midi 45 for a whole session —
two roles stacked on one pitch is the "continuous note" Shambu heard and their
mutual detune-beating is the "noise". The renderer had patched it by transposing
weather itself, but a patch in one renderer is not a fix; the next renderer
repeats it. Carrying the hint on the event means the separation travels with the
score. Four tests, including the gate: voiced with its hint, weather can never
land within 12 semitones of a concurrent ground note. `docs/a4-score.json` now
exports the hint; `render-score.mjs` supplies it to the pre-hint `a3-score.json`
and leaves any event that already has one alone, so the score always wins where
it has an opinion.

**2 — ONE SCHEDULE, TWO PLAYERS.** `scripts/lib/schedule.mjs` decides which
instrument voices which note, at what pitch, velocity, pan, tilt and twinkle.
Both the live Tone graph and `render-score.mjs` import it. The alternative — two
implementations plus a parity test — was considered and rejected: **a parity
test only tells you the day they diverged; one function means they cannot.** The
options argument was then deleted from both call sites, because a knob two
consumers can set differently is the same failure wearing a different hat. What
`test/schedule.test.ts` guards is therefore structural: both files must import
the shared module, neither may call `sampler.pick` or `chooseVoice`, neither may
pass `roleShaping`, and neither may add `WEATHER_OCTAVE_SHIFT` to a midi number.
Lens invariance is asserted on the schedule all five lenses actually play, and
also **live** — mid-session, `scheduleFor(80,140)` before and after a lens
change is byte-identical while the instrument sets genuinely differ.

**3 — THE MASTERING LAW.** The mix law levels the stems; it says nothing about
where they sit in the spectrum, and a musician's review found exactly that — every
fader right, the result still muddy. So each lens declares per-role EQ lanes
(documented per lens in a `_curve` string): the pads are carved where the moving
parts sing rather than the moving parts being pushed louder. Figuration alone
gets glue, and `maxReductionDb` is **enforced in the compressor, not implied by
its settings** — threshold −26/ratio 2 was chosen to "usually" stay under 2 dB
and reached **7.4 dB** the moment the stem was correctly trimmed onto its target.
Settings that satisfy a law at one level do not satisfy it at another; a clamp
does. Loudness is normalised to **−18 LUFS** (BS.1770-4, K-weighted, two-stage
gated) instead of to peak. The checker gained four assertions and a first
measurement that had to be thrown away: "how much of a pad's energy sits in the
motion band" is unanswerable — a violin section genuinely lives at 700–5000 Hz —
so it now measures the comparative claim the lanes actually make, that
**figuration leads each pad inside the band where figuration sings** (+17.9 dB
over ground, +4.8 dB over chord on aurora).

**4 — WHAT THE LIVE GRAPH MAY NOT DO.** It may not measure its own output. The
mix law is stated as measured steady-state stem levels; the renderer can satisfy
that directly, and a live graph metering its bus to chase a target is a
compressor wearing a disguise that would flatten the very macro arc Slice A4
exists to shape. So `npm run calibrate` renders each lens's steady state, and
`public/samples/calibration.json` carries the measurement the live graph applies
as static faders. One measurement, two consumers — the same arrangement
`schedule.mjs` makes for the notes. An uncalibrated lens falls back to a
documented approximation and the harness says so on screen rather than quietly
playing an unlevelled mix.

**FIVE DEFECTS THE BUILD FOUND, EACH ONLY FINDABLE BY RUNNING IT.**
*(a)* A `Tone.Sampler` is ONE node, so connecting it to a per-note panner fans
its whole output there and every note of a role lands wherever the most recent
star happened to be. Azimuth panning is how the sky has a shape, so each voice
now builds its own source from the bank's buffers; the bank still owns the
download, the format choice and the lens plan.
*(b)* Web Audio caps `DynamicsCompressorNode.release` at one second and throws
above it — the ratified 1.2 s was unbuildable live while the offline glue would
have run at 1.2 quite happily. **A law the two paths implement differently is
not one law**, so the number moved to 1.0.
*(c)* Starting mid-piece played ground and weather over silence: every span
starts only the notes that BEGIN inside it, so a chord voice that began at t=100
and holds for six minutes never begins inside any span the player sees. The
first span after `play(from)` now resumes already-sounding notes at the right
point in their recording, at the amplitude their arc had already reached, with a
short fade instead of a re-attack.
*(d)* A shared reverb bus put chord 6 dB and lead 5 dB under target while ground
and weather sat exactly on theirs. The law is stated on stems and the renderer's
stems each carry their own reverb, so a shared return is not the same thing —
each role now has its own space, and `SEND_LEVELS` was corrected to the
renderer's numbers digit for digit (they had been written out from memory).
*(e)* The harness meters lied. `Tone.Meter` at 0.9 smoothing reads a continuous
drone accurately and a bursty role about 5 dB low, which made the chord bed and
the lead look under the law when they were not — a meter that lies in one
direction for one kind of signal is worse than none, because it invites a fix to
a problem that is not there. Smoothing is 0.4 and the panel says it is a display,
not the instrument.

**EVIDENCE.** 385 tests green (30 new in `test/schedule.test.ts`), boundaries
included — that guard caught a debug `import * as Tone` I had put in the harness
and it was right to; typecheck clean. `check-mix-law.mjs` across all five lenses:
stem targets, the arc, hierarchy, unison guard, headroom, EQ lanes, glue,
loudness, and limiter engagement, written to `docs/b1-mix-law.json`. Every stem
lands on its target within the ±1 dB tolerance on every lens, figuration leads
both bed layers in every window, the unison guard holds, and the limiter never
engages.

**THE CHECK DOES NOT FULLY PASS, AND I HAVE NOT MADE IT.** One assertion fails:
on the **sonata** lens the chord bed's quietest minute (t=210 s) sits **−5.01 dB**
from its own gated average, against a ±5.00 bound. Embrace is −4.94 at the same
minute, aurora −2.54. The chord carve is what moved them — a dip in the motion
band costs proportionally more in the minute where the bed is thinnest. One
hundredth of a dB over a bound B0 set from an observed ~4.3 dB spread is inside
the noise of the measurement, and there are two ways to clear it: shallow
sonata's chord dip, or widen `WINDOW_TOLERANCE_DB`. **Both are tuning a ratified
number to make my own change pass, so I did neither.** It is reported here and in
`docs/b1-mix-law.json` for Shambu to rule on.

**LIVE PLAYBACK, ACTUALLY RUN.** `npm run dev` → `harness.html`, played through
the browser: instruments load, the piece plays, the star field's per-voice levels
name real stars, the lens swaps mid-session without stopping the music, and the
safety limiter's worst gain reduction over a 27-second watch was **0.00007 dB** —
the law's 0% holds on the live path too. Tapping the live master with an analyser
over t=322–345 s gave **−22.23 dBFS RMS / −6.40 peak**; the offline renderer
printing that identical window gave **−21.3 / −5.31**. Two different resamplers
and two entirely different reverbs, agreeing within ~1 dB.

**I DID NOT LISTEN, AND CANNOT.** Two clips are committed for the ear that can:
`docs/b1-live-aurora-to-embrace.mp3` is 150 seconds captured from the LIVE graph,
including the aurora→embrace change at ~41 s in, and `docs/b1-aurora-steady.mp3`
is 120 seconds of the steady state from the offline renderer. The ear gate is
Shambu's.

**ONE THING FOR RATIFICATION, NOT A TOOL DECISION.** Three of five lenses cannot
reach −18 LUFS with the limiter idle. Figuration's crest factor after RMS
matching is about 29 dB — the `ground` lens falls through to kalimba 525 times
and its figuration stem, correctly trimmed to −19 dBFS RMS, peaks at **+10 dBFS**
— so the peak guard, not loudness, sets the fader and the master lands 8.9 dB
under target. The master fader takes the lower of the two, the checker fails on
too-loud always and on too-quiet unless the peak guard was demonstrably the
cause, and the shortfall is reported per lens rather than passed in silence.
Closing it needs either limiter headroom (the law says 0% — Shambu's own
instruction) or peak-aware stem trims (the law is stated in RMS). Both change a
ratified number, so both are Shambu's call. **An 8 dB spread between lenses is
exactly what normalising to loudness was introduced to remove, so this should not
sit unratified for long.**

**ALSO OPEN.** Phase 4's `audioStyleForLens` seam in `src/app/` is still the
synth path; the engine now exports `createSampledStreamFromUrl`, so closing that
seam is one call in the app layer, which a parallel stream owns. Not touched here.

**NEXT:** Shambu's ear on the two clips, and a ruling on the LUFS/peak conflict.
HALT.

**◇ REVIEW GATE — Atlas HQ · 2026-08-10 · B1 + Phase 4 ENGINEERING PASSED; two
rulings.** B1's rigor endorsed: 385 tests green, five real mix defects found and
fixed (shared-reverb bus, lying meters, digit-for-digit SEND_LEVELS), live⇄
offline parity within ~1 dB across two different resamplers and reverbs,
limiter at 0.00007 dB on the live path, and — especially — the refusal to tune
ratified numbers to make its own change pass. That refusal is the culture this
project runs on. **RULING 1 (HQ):** the sonata −5.01 vs ±5.00 window bound is
measurement noise against a bound derived from an observed ~4.3 dB spread;
WINDOW_TOLERANCE_DB widens to ±5.5 — the chord carve (which serves the ratified
EQ lanes) stands untouched. **RULING 2 (proposed to Shambu, amends his own 0%
instruction):** the LUFS/peak conflict is real — figuration crest ~29 dB means
peak-guarding alone leaves lenses up to 8.9 dB under the −18 LUFS target. HQ's
read: the 0%-limiter law was written to protect the SUSTAINED bed's breathing,
not to forbid transient control — that is what limiters are for. Proposed
amendment: transient-only limiting permitted (≤3 dB gain reduction, engaged
≤1% of samples, and ZERO engagement asserted on ground+chord stems), target
−18 LUFS ±1; any residual shortfall still reported per lens. Also: the ground
lens's 525 kalimba fallthroughs at +10 dBFS peak flag a fallback-chain quality
issue for the tuning pass. Phase 4's remaining audioStyleForLens synth seam →
one-call fix, queued with CI/deploy. Shambu's ear gate: the two b1 clips
(noise diagnosis A/B) + live app test.

---

## 2026-08-10 — Slice B1.1: the live artefacts diagnosed, and the name

**THE HYPOTHESIS WAS WRONG, AND THE LOG SAYS SO.** HQ's read was a lazy-load
race: notes voiced through a fall-through instrument or a distant pitch-shift
while their proper samples were still downloading. The live graph was
instrumented for exactly that (`liveDiagnostics.ts` — every fall-through, every
shift beyond ±3, every unloaded sample, every voice steal, every instrument
arrival, all with piece timestamps) and the B1 capture reproduced note for note.
**Not one note was dropped for an unloaded sample**, across two full 220-second
runs including the lens change; every tier of both lenses was ready at t=0.0 and
t=69.2. The original capture came from this same localhost harness, so no sample
was ever late there either. The limiter was not it either — worst gain reduction
over the whole run, **0.072 dB**. Full report and raw log:
`docs/B11_CORRELATION.md`, `docs/b11-live-diagnostics.json`.

**WHAT IT ACTUALLY IS.** The far shifts were not scattered; they were the same
handful of structural cases repeating — `weather/wine-glass −6` seven times,
`chord/strings-violin +4/+5` thirteen times, `lead/wine-glass +4/+5` three times.
Permanent properties of the lens config, not races: `wine-glass` has four samples
across midi 63–74 and the score asks it for weather six semitones below. **And
the two paths resample differently** — the offline sampler uses 4-point Hermite
interpolation, the live path uses `ToneBufferSource.playbackRate`, which is the
browser's linear interpolation. At ±1–2 semitones they are indistinguishable; at
+5 the linear one images badly, bright and sharp. *That* is why the same score is
clean offline and defective live. Two of Shambu's three windows correlate with far
shifts. **The first (clip 13–18 s) correlates with nothing at all, and I have not
explained it** — the next thing to measure is `MediaRecorder` itself, since a
burst of distortion can live in the recording rather than the playback.

**THE FIX, IN THE PLACE THAT KEEPS THE INVARIANT.** A ±3 semitone cap in the
shared schedule, so both paths obey it. A **lens-independent** playable range
(midi 24–96) applied *before* any instrument is chosen, so pitches fold by whole
octaves, pitch class survives, and every lens folds identically — folding per
instrument was tried first and is wrong, because each lens has a different
ceiling and the same event would sound an octave apart in two lenses, breaking
"a lens changes what a note sounds like, never which note it is". Then the real
repair: **the fall-through chains simply stopped too low.** Figuration topped out
at midi 71–84 while the score reaches 90. Adding `glockenspiel` (67–96) to four
lenses' chains, and to the fifth after `hand-bells` was tried and left a hole at
72–81, took the residual from 608 over-cap notes to **0 of 3665, across all five
lenses, with lens invariance still exact.** The post-fix live run logs **zero**
far shifts where the pre-fix run logged nineteen.

**THE OTHER THREE FIXES.** *(a)* `ready()` now awaits the fall-through tier as
well as the primary, so no note can sound before its instrument exists, and the
app shows a **"Tuning the sky"** veil while it waits — named for what it is,
because "loading" invites "loading what?". *(b)* A lens swap fully preloads the
target before it is armed; nothing is gained by starting a crossfade a second
earlier and landing in a half-loaded lens. *(d)* Voices now `release(seconds)`
rather than being disposed: stealing (at a 96-voice backstop) and stopping both
fade over 120 ms, because a buffer source stopped at an arbitrary sample leaves a
step, and a click in a piece like this is louder than anything in the score.

**THE RATIFIED LIMITER AMENDMENT, IMPLEMENTED — AND IT WORKED.** Transient
limiting moved **off the master and onto the stems that carry transients**, which
is what makes the bed's zero engagement structural rather than asserted: ground
and chord have no limiter to engage. Two bugs on the way. The look-ahead was
written as `gain[i] = min(gain[i], gain[i+lookahead])`, which is a running
minimum over the whole tail — one loud sample propagated its reduction back to
the start of the buffer and pinned the limiter at maximum for **99.8%** of the
render, which is not a limiter, it is a fader; replaced with a proper sliding-
window minimum. And the 150 ms release meant the limiter was still recovering
when the next chime landed, so it read as engaged a quarter of the time; 50 ms is
inaudible on percussive material and makes the measurement mean what it says.
**Result: all five lenses now land at −18.0/−18.1 LUFS.** The 8.9 dB spread that
prompted the amendment is gone — and much of that came free from the shift cap,
because a kalimba resampled +19 semitones *is* a 3× time-compressed transient.

**WHAT STILL FAILS — 14 CHECKS, NOT ONE.** *(Corrected. The first version of
this paragraph said "everything else passes" and named only the limiter
engagement. That was wrong, and it was wrong in the flattering direction.)*

The CI run reproduced the local run line for line, identical numbers on a Linux
runner and on macOS, which at least says the measurement is deterministic:

```
lead        -22.6 dBFS            (target -21, ±1)     aurora
lead        -22.2 dBFS            (target -21, ±1)     pulse
figuration  -20.1 dBFS            (target -19, ±1)     ground
figuration over ground  +2.9 dB   (law: +4)            ground
figuration over chord   +4.9 dB   (law: +6)            ground
chord  worst window -7.8 dB @210s (±5.5)               embrace
chord  worst window -7.7 dB @210s (±5.5)               sonata
limiter active 0.05%, worst catch 3.3 dB (max 3 dB)    pulse
+ six × limiter engagement 1.16-8.65%  (max 1%)
```

**They share one cause, and it is mine.** The stem trims are calibrated on the
RAW stems and applied before the transient limiter runs. Limiting removes peaks,
which lowers RMS — so figuration and lead now measure 1–1.6 dB under the targets
the trims were computed to hit, and the hierarchy margins that are derived from
those levels collapse with them. The chord windows at t=210 s widened for the
same reason from the other side. **The calibration pass needs to measure the
stem AFTER limiting and re-trim**, which is one more iteration in
`trimsForTargets`; I have not made that change, because the slice was at its
halt and re-ordering calibration touches ratified semantics.

The limiter-engagement bound is still a genuine ratification question on its own
merits — 1% was proposed before anyone had measured struck figuration, and ≤3 dB
on 2–9% of samples is glue rather than squash with the bed untouched — but it is
**six of fourteen**, not the whole story.

One more real inconsistency the failure list surfaced: `render-score.mjs` still
runs a **master** limiter (`limitStereo`), which the live graph no longer has now
that limiting moved to the stems. The two paths diverge there and the offline one
is catching 3.3 dB on the pulse lens. That wants deleting, not tuning.

**THE SEAM IS CLOSED.** `src/app/session.ts` now builds
`createSampledStreamFromUrl` instead of the Phase 3.5 synth, and `setLens` hands
straight to the player rather than tearing the engine down and rebuilding it —
so a lens change no longer even pauses. `audioStyleForLens` is deleted.

**CI/CD.** `.github/workflows/ci.yml` runs typecheck, 386 tests and a production
build on every push, with the mix law as a separate job so a red mix reads as a
mix problem rather than as "CI is broken". `.github/workflows/deploy.yml`
publishes the Vite build to GitHub Pages on push to `main`, built with
`--base=/Stellune/`. One defect found while writing it: the sampler fetched
`/samples` **absolutely**, which 404s under a project path — the kind of thing
that only appears after the deploy, on the URL you just sent a friend. There is
now one `assetBase()` reading `import.meta.env.BASE_URL`.

**THE NAME.** The product is **Stellune**. Title, meta description, no-script
copy, `<h1>`, error prefixes, README heading, `package.json`, a new installable
PWA manifest (relative `start_url`/`scope`, so it works at a domain root and
under a project path alike), and a "Made with Stellune — your sky, as sound."
line on the completion card. Historical BUILD_LOG entries keep the old name,
because they are a record of what happened.

**EVIDENCE.** 386 tests green, typecheck clean, production build clean.
`docs/b11-live-aurora-to-embrace.mp3` — a NEW 150-second capture of the same
segment from the live graph, aurora → embrace at ~41 s in, with the fixes in:
**0 far shifts, 0 dropped notes, 0 voice steals, 0 dB on the bed limiters.**
Correlation report in `docs/B11_CORRELATION.md`, measurements in
`docs/b11-mix-law.json`.

**NEXT:** Shambu's re-listen on the new capture — especially whether window A
(13–18 s) survives, since nothing in the log explains it — and a ruling on the
limiter engagement bound. HALT.

**◇ DEPLOY, 2026-08-10.** Pushed to `dshambuprasad/Stellune`; Pages is live at
**https://dshambuprasad.github.io/Stellune/**. CI: types/tests/build green, the
mix law red on the 14 checks above. The deployed site immediately found a defect
no local run could have: **the first sound was gated behind ~100 simultaneous
sample requests** — `ready()` awaits every tier since B1.1, a lens is about eight
instruments of a dozen notes each, and a cold GitHub Pages CDN dropped some of
them. `curl` returned HTTP 200, the right MIME and the right byte count for every
file I checked, including the one the browser reported as unloadable, so the
files were never the problem; the burst was. Loading is now pooled three
instruments at a time with one delayed retry. *Also corrected in this session: I
first reported "the audio doesn't load" from a single probe taken seconds after
the deploy, before the CDN had propagated — all fifteen instruments serve.*
