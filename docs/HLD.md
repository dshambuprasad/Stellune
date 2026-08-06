# HLD — Cosmophony

## Problem

The real sky above the moment you were born is a knowable, specific thing that
nobody has ever heard. Turn it into calm ambient music without lying about it.

## Users & the one job

One user, one job: enter a birth date + city, see that sky, hear it as a drone
worth leaving on.

## Architecture sketch

```
                          ┌──────────────────────────────┐
                          │  app/  (the shell)           │
                          │  UI · canvas · export · PWA  │
                          └──────────────┬───────────────┘
                                         │ depends on everything
                          ┌──────────────▼───────────────┐
                          │  instruments/                │
                          │  birthSky · orrery (P6)      │
                          │  Instrument<TInput> contract │
                          └──────────────┬───────────────┘
                                         │ depends on engine surface only
   ┌─────────────────────────────────────▼─────────────────────────────────────┐
   │  engine/                                                                  │
   │                                                                           │
   │   ┌──────────────┐      ┌───────────────────┐      ┌──────────────────┐   │
   │   │ model/       │◀─────│ mapping/          │◀─────│ audio/           │   │
   │   │ Star         │      │ starsAboveHorizon │      │ AudioEngine      │   │
   │   │ ObserverInput│      │ sonify            │      │ Tone.js graph    │   │
   │   │ HorizonStar  │      │ MusicalScore      │      │ (P3)             │   │
   │   │ City         │      │                   │      │                  │   │
   │   │ deps: NONE   │      │ PURE · NO Tone    │      │ the ONLY Tone    │   │
   │   │              │      │ NO DOM · NO clock │      │ importer         │   │
   │   └──────────────┘      └───────────────────┘      └──────────────────┘   │
   └───────────────────────────────────────────────────────────────────────────┘
```

Arrows point the way dependencies go. **Nothing flows upward.**

## Data flow

```
city + date + optional time
        │
        ▼  (app/ resolves the city record → lat/lon/tzOffset)
  ObserverInput ────────────┐
                            ▼
  stars.hyg.subset.json → starsAboveHorizon(catalog, obs) → HorizonStar[]
                                                                 │
                                          MappingConfig ─────────┤
                                                                 ▼
                                                    sonify(...) → MusicalScore
                                                                 │
                          ┌──────────────────────────────────────┤
                          ▼                                      ▼
              AudioEngine.load(score)                  canvas star-field
              AudioEngine.play()                       (alt/az · mag · B–V)
                          │                                      ▲
                          └──────── getLevels() ─────────────────┘
                                    (glow in time with the tones)
```

The `MusicalScore` is the seam. It is plain JSON: snapshot-testable, diffable, and
transportable. Everything upstream of it is pure; everything downstream is
side-effectful.

## Key decisions + why

| Decision | Why |
| --- | --- |
| Three engine layers with a strict downward dependency rule | The mapping layer is the expensive-to-change part and the only part worth unit-testing hard. Isolating it from Tone and the DOM is what makes the astronomy provable. |
| `MusicalScore` as a serializable seam | Determinism becomes checkable with `toEqual`. Also lets a future recorder, exporter, or native shell reuse the same scores. |
| Boundary rule enforced by a test, not a convention | `test/boundaries.test.ts` scans source text and fails the suite on a forbidden import or a `Math.random()` in mapping. Conventions decay; tests don't. |
| Vite + TypeScript, no framework | The shell is genuinely simple. A framework would be the largest dependency in the project and buy nothing. |
| Tone.js confined to `engine/audio` | Web Audio is the least portable, least testable part. Quarantine it. |
| Bundled static JSON, no runtime network | $0 hosting, works offline, and the user's birth data provably never leaves the browser. |
| Pitch always quantized to a scale | The single biggest lever between "data beeps" and "music." |
| Fixed per-city UTC offset, no DST library | A DST database is a large dependency for an effect smaller than the ear can care about here. Stated in the UI rather than hidden. |
| `base: './'` in the Vite config | GitHub Pages project sites live under a sub-path; relative assets work anywhere without hard-coding the repo name. |
| Instruments as a plug-in contract | Instrument #2 is the exam that proves the boundary was real. |

## Non-goals

See `SPEC.md`. Structurally: no backend, no state management library, no
animation of the sky across the loop in v1, no AI in runtime logic.

## Risks / unknowns

- **The sound might just not be lovely.** The mapping can be correct and the
  result still dull. Phase 3 is explicitly an iterate-until-pleasant loop
  (quantize → timbres → drone bed → reverb), reviewed by listening.
- **Altitude→pitch may cluster.** Bright stars are not evenly distributed in
  altitude, so several voices could land on the same quantized pitch. May need
  spreading across octaves — a Phase 2/3 tuning question, resolved deterministically.
- **Azimuth→pan is a coordinate choice, not a fact.** Hard-panning by compass
  bearing can feel arbitrary; may need compression toward centre.
- **MediaRecorder support is uneven.** Safari's canvas+audio capture is partial;
  the branded-PNG fallback is planned from the start, feature-detected.
- **B–V is missing for some catalogue entries.** Timbre needs a sane, documented
  default rather than a crash.
- **Polar and edge cases** — nothing above the horizon, or an observer at ±90°
  latitude — must produce an honest empty-ish score, never an exception.
