# Living Sky — technical realization plan (Slice A0)

**This is the engineering plan for `docs/MUSICAL_VISION.md`.** The Vision sets the
creative direction; this document says how the mapping layer produces it — purely,
deterministically, and testably. Where the Vision over-constrains something that
does not survive contact with the data, §1 pushes back explicitly rather than
quietly complying.

Nothing here is implemented. This is Slice A0; A1 begins after Atlas HQ review.

Every number below that describes the sky was measured against the bundled
catalogue (`public/data/stars.hyg.subset.json`, 8,849 stars) during this design
pass, not estimated. Where a figure is a proposal rather than a measurement, it
says so.

---

## 1. Push-backs — where the Vision meets the data

These are raised first because three of them change what we can honestly claim.

### P1 · We do not have stick-figure data, and should not claim we do

The Vision (§2.1) derives a constellation's motif by "tracing its stick-figure —
its brightest stars in a fixed canonical order (the asterism path)". **The
bundled catalogue has no asterism lines.** It carries `id, name, ra, dec, mag,
bv, constellation` and nothing about which star joins which. No free asterism
line-set has been licence-verified for this project, and the obvious candidate
(Stellarium's `constellationship.fab`) is GPL, which is a poor fit for bundling
into an MIT app — that needs the grounding rule applied properly before anyone
relies on it.

**Proposal:** derive the path from the geometry we *do* have — the **exact
shortest open path** through the constellation's brightest ≤5 stars (§7). This
needs no new data, is identical from every place on Earth (it is computed in
RA/Dec, not alt/az), and empirically produces good contours. Measured on the real
catalogue:

| Constellation | Derived path | Contour (scale degrees) |
|---|---|---|
| Orion | Rigel → Alnitak → Alnilam → Bellatrix → Betelgeuse | −3 −1 −1 2 3 (a clean rise through the belt) |
| Cassiopeia | Caph → Schedar → Cih → Ruchbah | 0 −4 2 2 (the W zigzag) |
| Canis Major | Mirzam → Sirius → Wezen → Adhara → Aludra | 3 3 −1 −2 −3 (a fall from Sirius) |
| Crux | Acrux → Mimosa → Gacrux → Imai | −3 0 3 1 |

Orion's path genuinely walks up through the belt; Cassiopeia genuinely zigzags.
This is good enough to carry the idea.

**But the wording must change.** We can say *"a path through Orion's brightest
stars"*. We cannot say *"Orion's stick figure"* — the stick figure is a cultural
artefact we did not use. The truth covenant (Vision §7) is exactly the thing that
makes this project worth doing, so the UI copy should be corrected now rather
than after someone notices. Sourcing a permissively-licensed asterism set later
is a clean upgrade (a Slice B0-style grounding task); the mechanism does not
change, only which ordering feeds it.

### P2 · Motifs are rarer than the Vision implies — which is fine

Measured: of 89 constellations present, **20 have four or more stars brighter
than magnitude 3, and 31 have three or more.** So roughly a third of
constellations can carry a motif at all, and only when they are up and prominent.

This is not a problem — the Vision asks for "a *little* signature", Beethoven
dose. But it means motifs are an occasional event, not a constant presence, and
the design should not lean on them for continuity. The LEAD's backbone is
single-star events (§6); motifs are the special guest.

### P3 · Proper motion is not in our data (yet)

Vision §6 rung 3 says precession and proper motion can be switched on because
"the data already carries it". True of HYG upstream; **not true of our bundled
subset** — the Phase 1 prep script kept seven fields and dropped `pmra`/`pmdec`.
Re-adding them is a two-line change to `scripts/build-data.mjs` plus a re-run.
Not needed for Slice A; flagged so nobody plans a century-scrub on an assumption.

### P4 · A steady PULSE fights "unhurried"

PULSE (Vision §3.3) is honestly labelled as artistic, which is fine. But a
metronomic layer is the fastest way to make an ambient piece feel like it is
*going* somewhere, which is the opposite of the handpan bar ("leave it on and
forget it"). **Proposal:** PULSE defaults OFF, is available only in the `Pulse`
and `Ground` lenses, and even there its period is derived from the sky (§10)
rather than being a fixed BPM, so it drifts and never becomes a click track.

### P5 · The scale must not change mid-piece

Vision §2.3 wants emotional weather to select "minor colour" vs "brighter modes"
on a continuous blend. Changing the *scale* under a sustained drone mid-session
would either force a key change (jarring, and the GROUND bed would have to
re-root) or produce off-scale sustained notes during the crossfade — which
breaks the on-scale guarantee outright.

**Proposal:** the weather picks the scale and root **once per session**, from the
session's mean statistics, and thereafter modulates only *density, register span,
silence budget and layer count* — all of which are continuous and safe. This
keeps the promised emotional range (a lonely sky still gets minor colour, small
register, long silences) without a mid-piece modulation. If HQ wants audible key
movement later, the honest place for it is a scheduled arc boundary with a
prepared pivot, and that is its own slice.

### P6 · The bloom needs the *pace* to be solved, not the event moved

Vision §2.2 schedules the cathartic bloom at "that night's actual most dramatic
true event". The real event happens when it happens — it will not politely land
at the golden section of an 11-minute session.

**Proposal (§9): do not move the event — choose how fast the night flows so the
event arrives where the arc needs it.** Time compression is already declared
artistic, so this is a legitimate composer's dial. Verified against Shambu's own
birth sky (Bengaluru, 1993-08-01 00:00 IST), for an 11-minute session wanting its
climax at 68%:

| Candidate climax | culm. altitude | required compression |
|---|---|---|
| Fomalhaut (mag 1.17) | 47° | 21× |
| Achernar (mag 0.45) | 20° | 43× |
| Aldebaran (mag 0.87) | 86° | 66× |
| Rigel (mag 0.18) | 69° | 71× |
| **Sirius (mag −1.44)** | **60°** | **84×** |

Seven candidates fall inside a sane band. For this sky the piece can be paced so
that its climax *is Sirius crossing the meridian* — the brightest star in the
entire sky, at its highest point. That is a real event, and the music swells
because the sky genuinely does.

**The wart:** compression then varies per user (21× vs 84× is a visibly different
pace). Mitigation in §9.3 — optimise salience *and* closeness to a preferred
pace jointly, so pieces stay recognisably the same tempo of experience.

### P7 · At extreme latitudes there are almost no events — and that is the point

Measured, for stars brighter than magnitude 2.5 (92 of them):

| Latitude | rise & set | circumpolar | never rises |
|---|---|---|---|
| 0° (equator) | 92 | 0 | 0 |
| 12.97° (Bengaluru) | 91 | 1 | 0 |
| 51.5° (London) | 45 | 21 | 26 |
| 78° | 13 | 38 | 41 |
| 89.5° | **1** | 44 | 47 |

At 89.5° the rise/set vocabulary essentially vanishes. **The LEAD must therefore
not depend on horizon crossings alone** — culminations still occur for every
circumpolar star (44 per sidereal day at 89.5°, about one per 65 s at 30×), so
culmination is the load-bearing event type and rise/set are the colour. §5 builds
it that way.

And the honest consequence is a *feature*: near the pole the sky really does
barely move, so the music really is more static and more solitary. That is the
Vision's "lonely sky should sound lonely", arrived at truthfully rather than
simulated.

### P8 · `loopSeconds` stops meaning anything

Phase 3.5's seamlessness trick — every LFO running a whole number of cycles per
`loopSeconds` — exists because the piece looped. A continuous stream never
repeats, so that constraint is not just unnecessary, it is harmful: it would
force the modulators onto a common period and make the texture recur.

**Proposal:** `loopSeconds` survives only as the **export window length** for
Phase 5's shareable clip (where looping genuinely matters). The live stream uses
mutually incommensurate periods (§10). The audio layer keeps the loop-aligned
behaviour only when rendering an export.

---

## 2. The time model

### 2.1 Sky time versus listening time

One number connects them:

```
skySeconds(t) = t × κ                    (κ = compression, sky-seconds per listening-second)
skyInstant(t) = t0 + skySeconds(t)       (t0 = the session's fixed origin instant)
```

`t0` is supplied by the **app layer** — it reads the clock (for "tonight's sky")
or the birth date/city form, and hands the engine a fixed instant. The engine
never reads a clock, so `boundaries.test.ts` stays green and the same input yields
the same piece forever.

Because everything downstream depends only on **local sidereal time**, and LST
advances linearly, the whole model reduces to:

```
lst(t) = lst0 + t × κ × 360 / 86164.0905     (degrees, mod 360)
```

That is exact, O(1), and pure. `lst0` comes from the existing, already-verified
`localSiderealTime(observer)`.

### 2.2 The two compressions, and why they differ

| | Endless mode | Birth-sky session |
|---|---|---|
| κ | **30×** fixed | **solved per sky**, clamped to [40×, 90×] |
| Sidereal day maps to | 47.9 min | 16–24 min |
| Purpose | hours of background | a composed 8–15 min arc |

**Why 30× for endless.** Measured at 30×: a bright star is above the horizon for
between 13.7 and 38.5 listening minutes (median ~24), so CHORD voices sustain for
tens of minutes — Stars of the Lid territory, exactly the unhurried bed we want.
True events (rise/culminate/set) for stars brighter than mag 2 arrive one every
20 s, which is more than the Conductor will ever use and gives it a rich menu to
choose from. And the sky's own repeat period — one sidereal day — maps to 48
minutes, long enough that the harmonic material does not obviously recur.

**Why faster for a birth-sky session.** At 30× an 11-minute session covers only
5.5 sky-hours and almost no voice completes its arc; the session would be a slice
of a texture rather than a piece. At 40–90× voices live 5–14 listening minutes,
so stars visibly rise, crest and go — the arc has something to be an arc *of*.
The exact value is solved so the climax lands correctly (§9.3).

**The honesty line gains a clause.** Something like: *"Time is compressed — about
half an hour of sky passes each minute you listen."* The number is per-session and
should be shown, not hidden.

### 2.3 Both entry paths, one engine

- **Birth sky:** `t0` = the birth instant. The night unfolds *from* that moment —
  we do not jump to "the interesting part". If the sky at `t0` is daytime-empty
  of drama, that is what the piece opens with, and the arc solve (§9.3) still
  finds its climax later in the same night.
- **Tonight's sky:** `t0` = the app's captured clock instant. Identical machinery.
  A literal 1× "real sidereal time" option is *possible* and conceptually lovely,
  but at 1× essentially nothing changes within a listening session (the sky turns
  15°/hour), so it is not the default. Park it as a Phase 4 toggle labelled
  "true time", with the honest warning that it is nearly static.

---

## 3. Stream architecture — how a non-repeating piece stays pure and testable

**Recommendation: a pure windowed generator.** The audio layer asks the mapping
layer for a slice of the piece and schedules it; before that slice runs out it
asks for the next one.

```ts
renderWindow(catalog, observer, fromSeconds, toSeconds, config): ScoreWindow
```

Why windows rather than a polled `skyAt(t)`: the audio layer needs *lookahead* to
schedule attacks and ramps, a windowed list gives it exactly that, and a window
is a value you can put in a test and compare.

### 3.1 The invariant that makes it work

> **Partition invariance.** For any split of `[0, T)` into consecutive windows,
> the union of those windows' events equals `renderWindow(0, T)` exactly.

Everything else follows from this. If it holds, then:
- the stream **cannot audibly restart** — there is no state to reset;
- window size is a free parameter (the audio layer can change it at runtime);
- a bug at a window boundary is a failing test, not a listening session.

It is achieved by one rule: **every event is computed from absolute piece time,
and no window carries state into the next.** An event belongs to the window
containing its `startSeconds`, where

```
startSeconds = max(trueEventTime, 0)
```

The clamp is what makes window 0 behave like every other window: stars already
above the horizon at `t = 0` get `startSeconds = 0`, which lies in `[0, W)`, so
they are emitted exactly once, by the first window, and never again.

### 3.2 Bounded lookback for the rules that need history

Two mechanisms are not purely local — the Conductor's minimum gap between phrases
(§6) and its recency penalty. Both are made window-independent the same way:
each has a **bounded** lookback `L`, and to render `[from, to)` the generator
internally evaluates `[from − L, to)` and then discards anything starting before
`from`. Deterministic, stateless, and partition-invariant, at the cost of a little
recomputation. `L` is a config constant (proposed: 3 phrase periods).

This is the single most important implementation constraint in the design. Any
rule that cannot be expressed with bounded lookback does not go in.

---

## 4. True-event detection — closed forms, no search

Rise, culmination and set have exact closed-form solutions in sidereal time. No
numerical root-finding, no sampling, no tolerance parameters:

```
cos H₀ = −tan(latitude) · tan(declination)

H₀ ≥ 1   → the star never rises          (no events)
H₀ ≤ −1  → circumpolar                   (culmination only, never sets)
otherwise:
    rise        at  LST = RA − H₀
    culmination at  LST = RA
    set         at  LST = RA + H₀
    maximum altitude = 90° − |latitude − declination|
    hours above horizon = 2·H₀ / 15
```

Converting an LST to piece time is the inverse of §2.1, and because LST is
periodic every event recurs every sidereal day — so listing all events in a
window is: for each candidate star, compute its three event LSTs once, then
enumerate the occurrences that fall inside the window. **O(stars) per window, no
iteration.**

```ts
starEvents(star: Star, latitude: number): StarEventTimes   // pure, O(1)
eventsInWindow(catalog, observer, from, to, config): SkyEvent[]   // pure
```

`maximum altitude` is the other thing this gives us for free, and §8 leans on it:
it is a fixed property of a star *for a given observer*, and it is the honest
answer to "how high does this star ever get from where you are".

**Cross-check available for testing:** every predicted rise time can be verified
against the existing, independently-derived `starsAboveHorizon()` — the star must
be below the horizon just before and above just after. That is a genuine
independent check, not a restatement of the formula.

---

## 5. What the LEAD may speak about

Event types, in the order the Conductor prefers them when salience ties:

| Event | Musical form | Why it is true |
|---|---|---|
| **Culmination** | the fullest statement, *augmented* (slowed) | the star is at its highest — its still moment |
| **Rise** | a short ascending announcement | it is coming up |
| **Set** | a farewell, *inverted* (descending), quieter | it is going down |
| **Constellation prominent** | its motif (§7), developed | its whole shape is up and high |

"Prominent" needs a definition that is pure and stable. Proposed: a constellation
is prominent when **all** of its motif stars are above the horizon *and* the mean
altitude of those stars exceeds a threshold (proposed 35°), with the event fired
at the moment the mean altitude peaks — which is itself a closed form (the mean
crosses its maximum when the group's brightness-weighted mean RA culminates).

Per P7, culmination is the backbone: it is the only event type that survives at
every latitude.

---

## 6. The Conductor

The Conductor's job is to say **almost nothing**, and to choose well.

### 6.1 Salience

Every candidate event gets a deterministic score:

```
salience = w_mag · brightness(mag)          // 10^(−0.4·mag), normalised
         + w_alt · (altitude / 90)          // how high it is happening
         + w_kind · kindWeight(event)       // culmination > rise > set
         + w_rare · rarity(star)            // a first-magnitude star is an occasion
         − w_recent · recency(star, t)      // bounded lookback (§3.2)
```

All weights are config constants. No randomness. Ties break on star id, so the
ordering is total and reproducible.

### 6.2 Note budget and silence budget

Both are set by the emotional weather (§8) and both are hard limits, asserted in
tests rather than hoped for:

| | lonely sky | grandiose sky |
|---|---|---|
| LEAD notes per minute (max) | 4 | 12 |
| silence budget (fraction of each phrase period with no LEAD) | 0.70 | 0.35 |
| phrase period | ~45 s | ~25 s |

The Conductor divides piece time into **phrase periods** on a fixed grid (so the
grid is the same regardless of window boundaries), and in each period emits **at
most one phrase**. Measured justification: at 30× and magnitude ≤ 2.5 the sky
offers a true event every 10.5 seconds. The Conductor will use roughly one in
four of them. Restraint is the whole feature.

### 6.3 Phrase grammar: statement → answer → rest

```
STATEMENT   the chosen event's figure (a chime, or a motif if a constellation)
ANSWER      the same material, transposed down one scale DEGREE, shortened to
            its first 2–3 notes, quieter — a reply, not a repeat
REST        silence, length = silenceBudget × phrasePeriod
```

The answer is what makes it feel composed rather than triggered, and it costs
almost nothing: it is the statement's own degree sequence, transformed. Because
every transform happens in scale-degree space (§7.3), the answer is on-scale by
construction.

---

## 7. Motifs from constellation geometry

### 7.1 Choosing the notes

1. Take the constellation's stars brighter than magnitude 3, sorted by magnitude
   then id.
2. Keep the brightest **≤ 5** — the Vision's Beethoven cell. (This also fixes a
   problem: Scorpius has 13 such stars and a greedy path through all of them
   contains a 26° jump. Capping at 5 removes it.)
3. Order them by the **exact shortest open Hamiltonian path** (great-circle
   distance). At ≤5 nodes that is ≤60 orderings — brute-forced exactly, no
   heuristic, fully deterministic. Orient the path to start at the brighter end.

Measured on the real catalogue, this yields max hops of 4–15° and the contours in
§P1. Ordering is computed in RA/Dec, so **the motif is identical from every place
on Earth** — which is the property the Vision's identity claim rests on.

### 7.2 Notes from shape

```
pitch degree_i  = round( (dec_i − dec_centroid) / halfSpan × contourRange )
onset gap_i     = angularSeparation(star_{i−1}, star_i) × timeScale
```

Higher in the figure → higher note; wider apart on the sky → longer gap. Both are
place-invariant. `contourRange` (proposed ±3 degrees) and `timeScale` are config.

### 7.3 Development transforms — and the on-scale guarantee

**The key decision: every transform operates on scale-degree indices, never on
semitones.** A motif is stored as `number[]` of degree indices on the configured
ladder. Then:

| Transform | Operation on degrees | When |
|---|---|---|
| transposition | `d → d + n` | the answer (n = −1) |
| **inversion** | `d → 2·pivot − d` | a star or constellation is **setting** |
| augmentation | multiply all gaps by k > 1 | at **culmination** |
| diminution | multiply all gaps by k < 1 | rarely, for urgency |
| octave shift | `d → d ± degreesPerOctave` | register placement |

Because a degree index maps to a pitch only at the very end, through the existing
quantiser, **no transform can produce an off-scale note — it is unrepresentable,
exactly as in Phase 2.** Inversion in semitone space would break this instantly
(inverting a minor third gives a major sixth, which need not be in the scale);
inversion in degree space cannot. This is the single most important structural
answer to "how does the on-scale guarantee survive the grammar", and it should be
stated in the LLD.

---

## 8. Emotional weather

### 8.1 The statistics (all real, all measured per scene)

```ts
interface SkyWeather {
  visibleCount: number;        // stars above the horizon
  integratedBrightness: number;// Σ 10^(−0.4·mag) over visible stars
  brightestMag: number;
  spread: number;              // mean angular distance from the brightness centroid
  clustering: number;          // fraction of visible stars in the densest sky cells
}
```

`clustering` is the honest proxy for "the Milky Way is up" that we can compute
from a star catalogue without new data — the galactic band genuinely shows as a
concentration of naked-eye stars.

### 8.2 The mapping

Three normalised dials, each a smooth function of the statistics — no hard
categories, per the Vision:

```
density   = f(visibleCount, integratedBrightness)   → layer count, chord size, note budget
luminosity= f(integratedBrightness, brightestMag)   → register span, mode choice, WEATHER swell
solitude  = 1 − density                             → silence budget, solo LEAD, narrower register
```

Per P5 the **scale and root are chosen once**, from the session mean, on a small
ordered ladder from most solitary to most grandiose (proposed: `minor-pentatonic`
→ `aeolian` → `dorian` → `major-pentatonic` → `lydian` — all already implemented
and all drone-safe). Within the session only the continuous dials move.

Sanity check that this produces the Vision's promise: a polar winter sky scores
low density and low luminosity, so it gets minor colour, one voice, a 0.7 silence
budget and a two-octave register — a lonely sky that sounds lonely, arrived at
from its own statistics.

---

## 9. The arc engine

### 9.1 Additive layers

The Zimmer mechanism, run on the real sky. A layer schedule as a function of
normalised session position `u`:

| u | Stage | Layers sounding |
|---|---|---|
| 0 – 0.08 | **OPENING** | GROUND (bare) + one CHORD voice |
| 0.08 – 0.35 | GATHERING | + the rest of CHORD, blooming in brightness order |
| 0.35 – φ | BUILDING | + WEATHER, then LEAD, then PULSE (if the lens has one) |
| φ ± 0.06 | **BLOOM** | everything; widest register; longest reverb |
| φ – 0.90 | RELEASE | layers removed in reverse order |
| 0.90 – 1 | **CLOSING** | back to GROUND + the one opening star |

with φ ≈ 0.68. The *content* of each layer is entirely sky-driven; only the
envelope of the arc is composed.

**In endless mode there is no `u`.** The arc instead follows the sky's own
richness — layer count tracks a smoothed `density` as rich fields rotate through
and out. This is better than an artificial cycle: it is true, and it breathes on
the sidereal period without a composer having to invent one.

### 9.2 The opening and closing gesture

Vision §4, and the cheapest emotionally-expensive thing in the whole design:

1. **One star, alone.** The brightest star above the horizon at `t0` sounds by
   itself into silence — GROUND only, no chord. Its `origin.kind = 'gesture'`.
2. **The sky answers.** Remaining CHORD voices enter in brightness order over
   ~60–90 s (the Phase 3.5 staggered bloom, already built, re-pointed at this).
3. **The mirror.** In CLOSING, voices leave in reverse brightness order until
   that same star is the last thing sounding.

Testable precisely: the first event in window 0 is the brightest visible star;
the last event in the final window has the same `sourceId`.

For endless mode the gesture still plays at session start, then the arc
free-runs — a session has a beginning even if the piece has no end.

### 9.3 Scheduling the bloom (and solving κ)

```
1. List every culmination of stars brighter than `bloomMagLimit` within the
   session's reachable sky span, for κ across the allowed band.
2. Score each candidate: salience(event) × paceComfort(κ)
      where paceComfort peaks at a preferred κ (proposed 60×) and falls off
      toward the band edges — this is P6's mitigation, keeping pieces
      recognisably the same tempo of experience.
3. Choose the best; set κ so that event lands at u = φ.
4. If no candidate scores above a floor, fall back to κ = 60× and place the
   bloom at the highest-salience event nearest φ.
```

Verified feasible on Shambu's own sky (§P6): seven candidates in band, the best
being Sirius. Step 4 exists because a sky with no bright culmination in range
must still produce a valid piece — it simply blooms less dramatically, which is
honest.

---

## 10. CHORD: pitch, register and voice-leading

### 10.1 Where a chord voice's pitch comes from

Phase 2 mapped **current altitude → pitch**. That cannot survive an advancing
sky: every star rises through altitude 0, so under an advancing sky *every voice
would enter on the root*, and every sustained voice would re-quantize as it
climbed — a seasick, harmonically unstable choir.

**Proposal, and it is a genuine improvement in truthfulness:**

```
pitch class  ← the star's MAXIMUM altitude (90° − |lat − dec|)   — fixed, its identity
register     ← its CURRENT altitude, in whole octaves            — moves as it climbs
amplitude    ← magnitude × a smooth horizon fade                 — swells in and out
```

Measured: for stars brighter than magnitude 2 at Bengaluru, culmination altitudes
run 7.3° to 89.0° and populate 14 of the 15 available scale steps — a well-spread
chord, not a cluster.

This gives each star a **stable harmonic identity** ("how high this star ever
gets from where you are" — a real quantity), while the audible sense of the star
*climbing* comes from octave motion. And because octave shifts preserve pitch
class, the harmony is untouched and the on-scale guarantee is preserved by
construction — the same trick that made the Phase 3.5 shimmer safe.

### 10.2 Voice-leading

Sustained voices never move, so common tones are kept automatically. The
voice-leading decision is only ever: **which octave should a newly entering voice
take?** Rule: the octave, within the weather's register span, that minimises
distance to the centroid of the currently sounding voices.

Testable as a bounded quantity: *no entering voice sits more than N semitones
from the sounding centroid*. That is the Cigarettes After Sex "smallest possible
step" made into an assertion.

---

## 11. Non-repetition

Three sources, in order of importance:

1. **The sky.** The dominant one. Its true period is the sidereal day — and it is
   worth saying plainly that **the real sky repeats every sidereal day too**, so
   the harmonic material recurring on that period is not a defect, it is the
   thing being modelled. At 30× that is 48 minutes.
2. **Incommensurate modulators.** GROUND breath, WEATHER swell, PULSE cycle and
   register drift run on mutually incommensurate periods (proposed 1123 s, 1811 s,
   2417 s, 3299 s — primes, and none a rational multiple of the 2872.1 s sidereal
   day at 30×). Their combined pattern recurs on a timescale far beyond any
   listening session. These are artistic and labelled as such.
3. **The Conductor's recency penalty**, which prevents the same star speaking
   twice in quick succession even when it stays the most salient.

---

## 12. Score schema

The changes are additive; nothing existing is removed.

```ts
export type VoiceRole = 'ground' | 'chord' | 'pulse' | 'lead' | 'weather';

/** What real thing caused this note. The truth claim, made auditable. */
export interface EventOrigin {
  kind: 'rise' | 'culmination' | 'set' | 'visible' | 'constellation' | 'ground' | 'gesture';
  starId?: string;
  constellation?: string;
  /** When it happened in SKY time — so a reviewer can re-derive it by hand. */
  skySeconds: number;
}

export interface AmplitudeBreakpoint { atSeconds: number; amplitude: number }

export interface MusicalEvent {
  sourceId: string;
  role: VoiceRole;                        // NEW
  midi: number;
  amplitude: number;
  pan: number;
  timbre: TimbreParams;
  twinkle: number;
  startSeconds: number;                   // NOW REQUIRED, absolute piece time
  durationSeconds: number;                // NOW REQUIRED
  envelope?: AmplitudeBreakpoint[];       // NEW — long CHORD swells
  phraseId?: string;                      // NEW — groups statement + answer
  motifId?: string;                       // NEW — which constellation motif
  origin: EventOrigin;                    // NEW
}

export interface ScoreWindow {
  fromSeconds: number;
  toSeconds: number;
  events: MusicalEvent[];
  key: string;
  scale: ScaleName;
  rootMidi: number;
  weather: SkyWeather;                    // sampled at window start
  arc: { stage: ArcStage; u: number; kappa: number };
  meta: { objectCount: number; visibleCount: number; label: string };
}
```

`MusicalScore` is retained for the bounded/static case (the Phase 6 orrery builds
one), gaining the same required fields on its events. `ScoreWindow` is what the
stream produces. `loopSeconds` moves to export-only semantics (P8).

`origin` deserves a note: it costs a few bytes per event and buys three things —
Atlas HQ can re-derive any note by hand at review time, Phase 4 can glow exactly
the star that is speaking, and the honesty claim stops being a promise and becomes
a queryable property of the output.

---

## 13. Config additions

```ts
interface LivingSkyConfig extends MappingConfig {
  mode: 'birth-sky' | 'endless';
  sessionSeconds?: number;          // birth-sky: 480–900, default 660
  kappa?: number;                   // endless: 30. birth-sky: solved, band [40,90]
  preferredKappa: number;           // 60 — the pace-comfort peak
  bloomFraction: number;            // φ = 0.68
  chordMagLimit: number;            // 2.0 — the CHORD pool
  leadMagLimit: number;             // 1.5–2.5, weather-modulated
  bloomMagLimit: number;            // 1.5 — climax candidates
  motifMaxStars: number;            // 5
  motifMinStars: number;            // 3
  constellationAltitudeThreshold: number;  // 35°
  phraseSeconds: number;            // 25–45, weather-modulated
  lookbackPhrases: number;          // 3 — the bounded lookback (§3.2)
  horizonFadeDegrees: number;       // 25 — the CHORD swell
  registerSpanOctaves: [number, number];   // weather-modulated
  modulatorPeriods: number[];       // [1123, 1811, 2417, 3299]
}
```

---

## 14. Test plan

The invariants that must hold, and how each is proven:

**Structural**
1. **Partition invariance (§3.1)** — for several random-but-fixed partitions of
   `[0, 3600)`, the union of windows deep-equals the single window. *This is the
   headline test; it is what "never audibly restarts" means operationally.*
2. Determinism — identical inputs deep-equal across repeated calls and across a
   JSON round-trip.
3. Window size independence — 30 s, 120 s and 600 s windows produce identical
   unions.

**Astronomical truth**
4. Predicted rise/set times cross-checked against `starsAboveHorizon()`: below
   the horizon 1 s before, above 1 s after (independent derivation).
5. Culmination altitude equals `90 − |lat − dec|`, checked against `toHorizon()`.
6. Circumpolar stars emit culminations and never rises or sets; never-rising
   stars emit nothing.
7. All three latitude regimes from P7 produce valid, non-empty pieces.

**On-scale (the covenant)**
8. Every `midi` in a full hour of piece time, across all five roles and all
   development transforms, is a member of the configured scale.
9. Property test: inversion, transposition and octave shift of arbitrary degree
   sequences never leave the ladder.

**Conductor**
10. Note budget never exceeded in any 60 s sliding window.
11. Silence budget honoured: every phrase period contains a rest of at least the
    required length.
12. No star speaks twice within the recency window.

**Composition**
13. Opening gesture: the first event is the brightest visible star, alone, and no
    CHORD voice starts before it.
14. Closing gesture: the final sounding `sourceId` equals the opening one.
15. Bloom lands within ±5% of `φ × sessionSeconds`.
16. Voice-leading: no entering CHORD voice exceeds N semitones from the sounding
    centroid.
17. Motif stability: the same constellation from 6 different observers on 4 dates
    yields the identical degree sequence.

**Edge**
18. Empty sky, single-star sky, `maxVoices = 0`, session shorter than the opening
    gesture — all produce valid windows, none throw.

---

## 15. What I would cut if this is too much for one slice

In the order I would drop them, and my honest read of the cost:

1. **PULSE** — the least truthful layer and the one most likely to hurt calm (P4).
2. **Constellation motifs** — the most code (path solving, transforms, prominence
   detection) for the rarest event (P2). The LEAD works on single-star events
   alone. This is the biggest *story* loss, though, so I would cut it last among
   the musical features.
3. **The solved κ** — fall back to a fixed 60× for birth-sky and place the bloom
   at the best available event. Loses "the climax is Sirius"; keeps the arc.

What I would **not** cut, at any size: partition invariance, degree-space
transforms, the opening gesture, and `origin` on every event. The first two are
load-bearing for correctness, and the second two are load-bearing for the point
of the product.

---

## 16. Open questions for Atlas HQ

1. **P1 wording.** Confirm we drop "stick figure" from the copy and say "a path
   through its brightest stars" until a permissive asterism set is verified.
2. **P5.** Agreed that the scale is fixed per session rather than blending
   continuously?
3. **P6.** Is a per-session pace (40–90×) acceptable, given the mitigation? The
   alternative is a fixed pace and a less well-placed climax.
4. **§10.1.** This changes Phase 2's pitch mapping from *current* altitude to
   *maximum* altitude plus octave motion. It is a real change to a reviewed
   contract, and I think it is both more musical and more meaningful — but it is
   HQ's call, and the review will want to re-derive it.
5. **Session length.** Default 11 minutes (Vision says 8–15). Confirm.
