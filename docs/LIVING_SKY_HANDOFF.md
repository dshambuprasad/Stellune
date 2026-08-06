# Cosmophony — "Living Sky" milestone handoff (for Claude Code)

**Read first, every session:** `docs/BUILD_LOG.md` (where we are),
`06_Claude_Handoff/POC5_Cosmophony_Build_Plan.md` (the original contract + engine
type spine), `docs/SPEC.md`, `docs/HLD.md`, `docs/LLD.md`. Then this.

> **2026-08-05 AMENDMENT — read `docs/MUSICAL_VISION.md` BEFORE Slice A.**
> The Musical Vision is now the authoritative creative direction (set by Shambu
> + Atlas HQ): the reference palette decoded into mechanisms, the
> constellation-shape-as-motif identity model, the real-night arc + additive
> engine, emotional weather from true sky statistics, the five performance
> roles (GROUND/CHORD/PULSE/LEAD/WEATHER), the opening gesture, and the five
> mood lenses (which SUPERSEDE this file's earlier 4-mood working set). Slice
> A0 is the technical realization plan for that document — do not re-derive
> creative direction here.

This milestone sits **between the finished Phase 3.5 (audio beauty) and Phase 4
(visual UI)**. It reshapes what the original plan called Phase 2/3: the music was
a *static held chord* and Shambu's verdict was that it's beautiful but monotonous
— "like a single note." This milestone turns it into **evolving, harmonious,
all-day background music**, still true to the real sky.

## Why (the diagnosis, agreed)
We built a **drone**: every star sustains for the whole loop. We have the right
*notes* (consonant, on-scale) but no *time* — nothing arrives, moves, or rests.
Music is movement in time. The fix is to let the sky **advance**, so stars rise,
climb and set and their notes enter and fade across a long, non-repeating arc —
plus a gentle melodic lead and generative layering over the drone bed. (An
astrophysics installation, SYSTEM Sounds' *One Sky*, does almost exactly our
mapping and evolves it "slowly over the night" — the approach is validated.)

## Locked decisions (from the strategy discussion, do not re-litigate)
- **v1 becomes an evolving generative piece**, not a static chord. It should be
  something you leave on in the background and forget — calm, non-tiring, and a
  quiet reminder of our place in a vast universe.
- **Instrument moods:** 3–4 curated presets (not a build-your-own). The user
  picks a *feeling*. Working set: **Celestial** (harp + glass + pad),
  **Contemplative** (felt piano + strings), **Meditative** (handpan + bowls +
  drone), **Cosmic** (wordless choir + deep pad).
- **Sampled real instruments, free/openly-licensed.** Confirmed sources:
  **VSCO2 Community Edition = CC0** (strings, flute, piano, percussion),
  **Salamander Grand Piano = CC-BY** (attribution), **University of Iowa MIS =
  public domain**, **Freesound** for CC0 handpan / singing bowls / harp / glass.
  Start free; we never pay. **Per-pack licence is verified from its authoritative
  source before bundling** (the grounding rule — see below), CC0 preferred.
- **"Now" or "birth date" entry.** Two ways in: *tonight's sky here* (clock +
  optional browser geolocation) or *my birth sky* (date + city). Both resolve to
  a concrete instant handed to the pure engine.
- **PWA-first** stays the platform (one build = web + installable mobile). No
  native, no accounts, no backend. YouTube channel is a *later* distribution
  experiment, not in scope here.
- **Honesty line holds.** Structure is true (real stars, real positions, real
  motion); timbre, scale, instrument and time-compression are artistic choices,
  and the UI says so. The evolving version does not change what's true — it just
  lets the true sky move.

## Non-negotiable constraints (carried from the build plan)
- **Layer boundaries + determinism.** The mapping layer stays pure: no Tone, no
  DOM, no clock, no unseeded randomness — `test/boundaries.test.ts` must stay
  green. "Now"/geolocation live in the **app layer**, which reads the clock/
  location and passes a fixed instant + lat/long into the engine, so the engine
  stays deterministic (same instant → same evolving music, forever).
- **Tone only in `engine/audio`.** Sampled instruments load through Tone.Sampler
  inside the audio layer.
- **On-scale guarantee survives.** Every pitch (including the new melodic lead)
  stays a member of the configured scale — keep it unrepresentable to go
  off-scale, and keep the off-scale spectral probes in the render checks.
- **$0 / open assets only.** CC0/CC-BY samples, licences verified and recorded in
  `public/data/ATTRIBUTION.md` (or a sibling `ATTRIBUTION` for audio). CC-BY packs
  get attribution; CC0 preferred to avoid even that.
- **Grounding rule (project standard):** every factual claim in a handoff or the
  code — especially a sample-pack licence or a data source — is verified against
  its primary source before it's committed, and version/licence are pinned to what
  is actually on disk. No "it's probably free."
- **PWA weight.** Sampled instruments add megabytes. Keep packs lean (few velocity
  layers, compressed ogg/mp3), and **lazy-load per mood** so the app opens light;
  Phase 5's service worker precaches the chosen mood.

---

## The slices (build in order; HALT for review after each)

### Slice A — Evolving score + melody (mapping layer)
This is the heart of the fix and an architectural fork, so it has two steps.

**A0 — DESIGN NOTE FIRST, then halt (no implementation yet).** Write
`docs/LIVING_SKY_DESIGN.md` as the technical realization plan for
`docs/MUSICAL_VISION.md` — covering, concretely and testably: the sky-advance
model + time-compression; **true-event detection** (rise/culmination/set as pure
functions); the **Conductor** (salience ranking, note budget, silence budget,
statement→answer→rest phrasing); **motif derivation from constellation
geometry** + its development transforms (inversion on setting, augmentation at
culmination) with the on-scale guarantee preserved; the **additive-layer arc
engine** and how each night's bloom is scheduled from real sky data; **CHORD
voice-leading** (minimal-motion revoicing); the **emotional-weather statistics**
and their deterministic mapping; and the score-schema changes. Where the vision
over-constrains something technically unreasonable, push back explicitly.
In addition, address the original design questions:
- **How the sky advances.** How sidereal time moves across the piece so stars
  enter/climb/fade. Address the birth-sky case (a fixed past moment — the night
  unfolds *from* it) and the "now" case (may track real sidereal time). Pick a
  compression (how much sky-time per listening-minute) and justify it.
- **Continuation vs looping.** Strong preference for a **continuous, genuinely
  non-repeating stream** (the Eno/Endel model) over a short repeating loop — it
  must never audibly "restart." Say how you keep it deterministic and testable
  (e.g. a pure `skyAt(observer, elapsed, config)` the audio layer schedules from,
  or a deterministic long evolving score regenerated per window). Recommend one.
- **The melodic lead.** How a sparse, moving, scale-locked lead is derived
  *truthfully* from the sky (e.g. stars chiming as they culminate/cross the
  meridian, or stepping through currently-visible chord tones ordered by
  altitude/azimuth), with rests and space. Composed, not random.
- **Generative layering.** How a few incommensurate cycles keep the texture from
  repeating.
- **Score schema changes** to `MusicalScore`/`MusicalEvent` (real use of
  `startSeconds`/durations, a voice `role` like pad/lead/chime/bass, layers).
**Halt.** Atlas HQ reviews the design before you write mapping code.

**A1 — Implement (after the design is approved), then halt.** Build it in the
pure mapping layer: deterministic, unit-tested (same input → identical evolving
score/stream; on-scale across the whole evolution incl. the lead; stars enter/
leave at the right sidereal times; the birth-sky and now cases; empty/edge skies
still valid). Update `docs/LLD.md`. **Halt** for the deep review (I'll re-derive
timings independently, as with Phase 2).

### Slice B — Sampled-instrument moods (data + audio layer)
**B0 — Source & licence-verify the sample packs, then halt.** Fetch the chosen
instruments (VSCO2 CE strings/flute/piano/percussion; a piano; Freesound CC0
handpan/bowls/harp/glass; a wordless-choir pad if a CC0/CC-BY one exists — else
synth-pad it). For **each** pack record in the attribution file: source URL,
exact pack/version, licence (verified from the authoritative source), SHA-256 or
equivalent, and access date. Prefer CC0. Add a lean, lazy-loading Tone.Sampler
setup. **Halt** — I verify the licences match what's bundled (grounding gate).

**B1 — Wire the moods, then halt.** Map the evolving score's roles to instruments
per the 3–4 mood presets; keep the drone bed + octave shimmer from Phase 3.5. A
test asserts **switching mood changes no pitch/pan/gain/timing** — only timbre
(as the Phase 3.5 style test does). Render a short clip **per mood** of the same
sky (committed under `docs/`), re-measure (level, clipping, on-scale + off-scale
probes), note it honestly in BUILD_LOG. **Halt** — ear gate: Shambu chooses/tunes
the moods.

### Slice C — "Now" / birth-date entry (app layer)
In the app/harness layer (not the engine): a toggle between **"tonight's sky
here"** (read the clock + optional `navigator.geolocation`; fall back to a chosen
city if declined — no data leaves the device) and **"my birth sky"** (date +
optional time + city, as already specified). Resolve either to an `ObserverInput`
and drive the engine. Keep the full calm UI for Phase 4; this slice just needs
enough to demonstrate both entry paths. **Halt.**

---

## After the milestone
Update `docs/BUILD_LOG.md` per slice; when the milestone lands, update
`../../05_Portfolio/Idea_Pipeline.md`, add Web-Audio/generative-music +
sampled-instrument-licensing lessons to `../../00_Governance/Engineering_Learnings.md`,
and a Decision Log line. Then Phase 4 (the calm visual star-field showing stars
appear/move in time with the evolving sound) and Phase 5 (PWA + share) wrap it.

## Roadmap parked behind this (each a drop-in instrument — do NOT build now)
Constellation focus → **century past/future time-scrub** (turn ON precession +
proper motion — HYG carries proper motion — so long spans stay true) → deep-sky /
galaxy (OpenNGC, CC0) → black-hole *mood* (darker/heavier, labelled as an artistic
mode, not literal positional truth). These are why the pluggable instrument engine
exists; they slot in without touching the engine core.
