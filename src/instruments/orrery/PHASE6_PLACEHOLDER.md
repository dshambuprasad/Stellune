# `instruments/orrery/` — reserved for Phase 6

Intentionally empty of code. Phase 6 drops the TRAPPIST-1 orrery in here as an
**interface stub**: seven-planet data plus a `buildScore` that maps the preserved
orbital-period *ratios* to a rhythmic loop, written against the same
`instruments/types.ts` contract and the same `engine/` mapping and audio layers.

The whole point of the exercise: it must compile and produce a valid
`MusicalScore` with **zero edits to `engine/`**. If Phase 6 has to change the
engine, the architecture was wrong and this folder is the evidence.

Nothing here yet — the folder exists so the boundary is visible from Phase 0.
