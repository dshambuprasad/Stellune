# Slice B1.1 — the live-capture artefacts, correlated

**Question.** The B1 offline render is clean; the B1 *live* capture of the same
score has three defect windows. HQ's hypothesis was a **lazy-load race** — notes
voiced through a fall-through instrument, or stretched a long way from their
nearest recorded pitch, because the sample they wanted was still downloading.

**Method.** The live graph was instrumented (`src/engine/audio/liveDiagnostics.ts`)
to record, with piece timestamps, every fall-through voicing, every resampling
beyond ±3 semitones, every note dropped for an unloaded sample, every voice
steal, and every instrument arrival. The B1 capture was then reproduced exactly:
same score, same lens, `aurora` from t=0, swapped to `embrace` at t=69 s.

Shambu's timestamps are **clip** time. The B1 capture began at piece t=27.7 s, so:

| Ear report | clip | **piece** |
|---|---|---|
| A — "distortion" | 13–18 s | 40.7–45.7 s |
| B — "unidentifiable instrument" | 51–60 s | 78.7–87.7 s |
| C — "sharp note out of nowhere" | >117 s | >144.7 s |

Raw log: `docs/b11-live-diagnostics.json`.

---

## The hypothesis is FALSIFIED

**Not one note was dropped for an unloaded sample.** `not-loaded` = 0, across
two full 220-second runs including the lens change.

The loading timeline says why:

```
0.0  contrabass, strings-violin, hand-chimes, wine-glass, flute   (aurora, primary)
0.0  strings-cello, glockenspiel                                  (aurora, fall-through)
69.1 lens-requested  embrace
69.2 contrabass, strings-cello, wine-glass, vibraphone-soft, piano-felt  (primary)
69.2 strings-violin, flute · 69.3 kalimba                          (fall-through)
75.5 lens-committed  embrace
```

Every tier of both lenses was ready before a note needed it. **The original
capture came from this same localhost harness, so the race did not happen there
either.** No sample was ever late.

**The limiter was also not the cause.** Worst gain reduction across the whole
run: **0.072 dB**, with zero samples above the 0.1 dB engagement threshold.

**One candidate could not be tested.** Audio-thread underruns would produce
exactly what was described, so `AudioContext.renderCapacity` was wired in — but
this Chrome build does not expose the API, so that measurement is **inconclusive,
not negative**. It is left in place for a browser that does.

---

## What the log actually found

| Window | events | detail |
|---|---|---|
| **A** 40.7–45.7 s | **0** | nothing at all — no fall-through, no far shift, no drop |
| **B** 78.7–87.7 s | 1 | `far-shift lead wine-glass +4` at 79.1 s; lens committed at 75.5 s |
| **C** >144.7 s | 9 | 5 far shifts, 4 chord fall-throughs |

Across the run, far shifts were **not** scattered — they were the same handful of
structural cases, repeating:

```
 7 ×  weather / wine-glass   −6
 7 ×  chord   / strings-violin  +4
 6 ×  chord   / strings-violin  +5
 2 ×  lead    / wine-glass   +5
 1 ×  lead    / wine-glass   +4
18 ×  chord: strings-violin standing in for strings-cello
```

These are not races. They are permanent properties of the lens config: the
instrument simply has no recorded note near that pitch. `wine-glass` has four
samples spanning midi 63–74; the score asks it for weather six semitones below.

---

## The mechanism, and why offline is clean

The two paths resample differently.

- **Offline** (`scripts/lib/sampler.mjs`) uses **4-point Hermite interpolation**.
- **Live** uses `ToneBufferSource.playbackRate`, i.e. **the browser's own
  resampler**, which for an `AudioBufferSourceNode` is linear interpolation.

At ±1–2 semitones the two are indistinguishable. At +5 and beyond, linear
interpolation images badly — bright, thin, sharp. That is precisely the
difference between "offline clean, live defective **on the same score**", and it
is why the far shifts show up in the ear report and nowhere in the renderer.

**Confirmed:** pitch-shift distance, via the live resampler.
**Not confirmed:** anything about loading.
**Window A has no correlate of any kind** and remains unexplained by this
instrumentation. It is the one honest gap in this report.

---

## What was changed

1. **±3 semitone cap** (`MAX_SHIFT_SEMITONES`), applied in the shared schedule so
   both paths obey it.
2. **A lens-independent playable range** (`PLAYABLE_MIDI_RANGE`, midi 24–96).
   Pitches outside fold by whole octaves *before* any instrument is chosen, so
   pitch class is preserved and **every lens folds identically**. Folding per
   instrument was tried first and is wrong — each lens has a different ceiling, so
   the same event would sound an octave apart in two lenses, breaking the ratified
   "a lens changes what a note sounds like, never which note it is".
3. **High-register links added to the fall-through chains.** The chains exist for
   exactly this and simply stopped too low: figuration topped out at midi 71–84
   while the score reaches 90. `glockenspiel` (67–96) now covers the top in four
   lenses; the `ground` lens got it too after `hand-bells` was tried and left a
   hole at midi 72–81.

**Result: 0 of 3665 scheduled notes exceed ±3 semitones, across all five lenses —
and lens invariance is still exact.** The post-fix live run logs **0** far shifts,
where the pre-fix run logged 19.

## What this did NOT fix

Window A. There is no instrumented event anywhere near it. If it survives the
re-listen, the next thing to measure is the capture path itself — `MediaRecorder`
under load is a plausible source of a burst of distortion that exists in the
recording and not in the playback, and that hypothesis needs a listener on the
live output rather than a log.
