# SPEC — Cosmophony (POC-5)

Source of truth: `06_Claude_Handoff/POC5_Cosmophony_Sonify_Cosmos.md` (vision) and
`06_Claude_Handoff/POC5_Cosmophony_Build_Plan.md` (the executable contract). This
file is the condensed version that travels with the repo.

## Spirit

A **wonder-first joy build**. Not income-gated. Success is real, beautiful, *true*
sound from real cosmic data that gives someone — first, Shambu — a moment of awe.
**Honest beats impressive.**

## Problem

Astronomical data is beautiful and almost entirely invisible to most people. The
sky above the moment you were born is a real, specific, knowable thing, and
nobody has ever heard it. Existing "space sound" projects are mostly either
scientifically loose or musically unpleasant.

## The one job

Enter a birth date (and optionally a time) plus a city → see the real sky that was
above that place → hear it as a calm, consonant, evolving ambient drone that loops
pleasantly and can be left running.

## Scope (v1)

- **One instrument, done well: "Birth Sky."** Date + optional time + city →
  stars above the horizon → a sustained, scale-quantized chord that breathes.
- **Bundled static data.** HYG star catalogue subset (naked-eye, mag ≤ 6.5) and a
  public-domain GeoNames city subset (~1–2k cities) with a manual lat/long
  fallback. No network at runtime, no geocoding service.
- **A calm canvas star-field** in correct alt/az, sized by magnitude, tinted by
  B–V colour; sounding stars glow in time with their tones.
- **PWA** — installable, works offline, background audio.
- **A shareable artifact** — a ~15–20 s branded webm (canvas + audio via
  MediaRecorder) plus a WAV audio export, with a branded PNG fallback where
  MediaRecorder is unavailable (Safari). Everything carries
  `made with Cosmophony · <url>`.
- **A GEO-citable page** — semantic HTML, a one-line "what this does", a short
  honest FAQ, schema.org JSON-LD (`SoftwareApplication` + `FAQPage`).
- **Instrument #2 as an interface stub** (Phase 6): TRAPPIST-1 orrery, proving
  the plug-in contract holds.

## The mapping (physically honest, artistically dressed)

| Star property | Musical result |
| --- | --- |
| altitude above horizon | pitch (higher in sky → higher register), then **quantized to the scale** |
| apparent magnitude | amplitude (brighter = louder, gently compressed so faint stars still whisper) |
| B–V colour index | timbre (hot/blue → glassier; cool/red → warmer) |
| azimuth | stereo pan (east ↔ west → left ↔ right) |
| low altitude | twinkle / modulation depth (horizon stars really do scintillate more) |

Plus a low sustained drone bed on the root, gentle reverb, and stereo width.

## Non-goals (v1)

No backend, no accounts, no CMS, no payments, no native app, no live APIs, no huge
catalogues. No sky animation across the loop (stars rising/setting is roadmap, not
v1). No AI/LLM anywhere in runtime logic. No DST database — a single fixed UTC
offset per city, stated in the UI.

## Honesty commitments

- The UI says plainly: *"Structure is true — these are the real stars above
  &lt;place&gt; on &lt;date&gt;. Timbre, musical scale, and timing are artistic
  choices."* Never imply this is literally the sound of space.
- Simplifications are stated, not hidden: J2000 coordinates, precession skipped
  (negligible over birth-date ranges), fixed timezone offsets, no atmospheric
  refraction.
- Data sources, transforms, and access dates are recorded in
  `public/data/ATTRIBUTION.md` and `POC5_RESULT.md`.

## Constraints

- **$0 only.** Open-source libraries, free/public data, free static hosting.
- **Faceless & private.** No accounts, no PII, no tracking. All computation is
  client-side; the user's birth data never leaves the browser.
- **Deterministic core.** Same input → same score, always. Any randomness is
  seeded from `MappingConfig.seed`.
- **Minimal dependencies.** Vite + TypeScript + vitest, and Tone.js for audio.

## Success criteria

1. Enter a real birth date + city → see that sky → hear a calm, consonant,
   evolving drone that loops pleasantly.
2. The astronomy is correct: Polaris sits at the observer's latitude; a star with
   dec = latitude transits the zenith; far-southern stars are never visible from
   the north.
3. Every emitted pitch is a member of the configured scale.
4. Calling `sonify` twice on identical input yields deep-equal scores.
5. Engine layers stay separated — adding instrument #2 requires no engine changes.
6. **Shambu's reaction is the real test.**

## Roadmap (only if it delights)

Orrery → pulsar rhythms → "greatest hits" (LIGO chirp, CMB, asteroseismology) →
an accessibility mode (astronomy you can hear) → the ambient "cosmic radio"
player and library → PWA-to-native with personalized birth-sky keepsakes.
