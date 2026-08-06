# LLD — the mapping layer

Low-level design for the two modules that carry the project's truth claim:
`src/engine/mapping/astro.ts` (where the stars really were) and
`src/engine/mapping/sonify.ts` (what that becomes musically). Per the Playbook,
an LLD is written only for the part whose complexity warrants it — this is it.

Everything here is **pure and deterministic**: no Tone.js, no DOM, no Web Audio,
no clock, no `Math.random()`. `test/boundaries.test.ts` fails the build if any of
that appears.

---

## 1. `astro.ts` — the horizon reduction

### Inputs and outputs

```
starsAboveHorizon(catalog: Star[], obs: ObserverInput) → HorizonStar[]
julianDate(obs: ObserverInput)                         → number   (days)
greenwichMeanSiderealTime(jd: number)                  → number   (degrees, 0..360)
localSiderealTime(obs: ObserverInput)                  → number   (degrees, 0..360)
toHorizon(star: Star, latitude: number, lst: number)   → HorizonStar
```

Degrees in, degrees out. Radians exist only inside the trig calls.

### The approach

Standard alt/az reduction, following Meeus, *Astronomical Algorithms*
(ch. 7 Julian Day, ch. 12 sidereal time, ch. 13 coordinate transformation).

**Step 1 — resolve the UTC instant.** `timeMinutes` defaults to 0 (local
midnight). UTC minutes = `timeMinutes − tzOffsetMinutes`.

**Step 2 — Julian Date** (Gregorian branch; correct for every date after
1582-10-15, which is every birth date this will ever see). With January and
February counted as months 13 and 14 of the previous year:

```
a  = floor(y / 100)
b  = 2 − a + floor(a / 4)
JD = floor(365.25·(y + 4716)) + floor(30.6001·(m + 1)) + d + b − 1524.5
```

`d` carries the day fraction. **The formula is linear in `d`**, so a local time
that crosses midnight into the previous or next day resolves correctly with no
calendar-rollover logic at all — `d = 32.27` simply means the 1st of the next
month. This is why local midnight at UTC+5:30 lands on the previous UTC day
without a single special case.

**Step 3 — GMST** (Meeus eq. 12.4), with `d = JD − 2451545.0` and
`T = d / 36525`:

```
GMST = 280.46061837 + 360.98564736629·d + 0.000387933·T² − T³/38710000   (mod 360)
```

**Step 4 — LST** `= GMST + longitude` (east positive), and the **hour angle**
`H = LST − RA`, normalised to −180..180.

**Step 5 — altitude and azimuth:**

```
sin(alt) = sin(dec)·sin(lat) + cos(dec)·cos(lat)·cos(H)

Az = atan2( −cos(dec)·sin(H),
            sin(dec)·cos(lat) − cos(dec)·sin(lat)·cos(H) )     normalised to 0..360
```

`atan2` resolves the quadrant, so azimuth is measured from **north through east**
(0 = N, 90 = E, 180 = S, 270 = W) with no branch logic. This is algebraically the
build plan's `tan(Az) = −sin(H) / (cos(lat)·tan(dec) − sin(lat)·cos(H))` with
numerator and denominator both multiplied by `cos(dec)` — which is precisely what
removes the quadrant ambiguity and the `tan(dec)` pole at the celestial equator.

Sidereal time is a property of the moment, not of any one star, so it is computed
**once per call** and reused across the whole ~8,800-star catalogue.

### Stated simplifications

| Simplification | Size of the error |
| --- | --- |
| J2000 coordinates, no precession | ~50″/year of drift; well under 0.5° for a 1990s date |
| No atmospheric refraction | ~34′ at the horizon, ~0 above 45° |
| No proper motion, parallax, nutation, aberration | arcseconds |
| Geometric horizon (`altitude > 0`) | conservative by ~34′ |
| Fixed standard UTC offset, no DST | **up to 1 hour → up to 15° of sky rotation** |

The last row dominates every other error by two orders of magnitude, which is why
it is stated in the UI rather than buried.

### Edge cases

- **Malformed `dateISO`** → throws. A date that quietly became "some other day"
  would produce a plausible sky that simply is not yours; silence is worse than a
  crash here.
- **Latitude outside ±90** → throws.
- **Non-finite `timeMinutes` / `tzOffsetMinutes` / `longitude` / `jd`** → throws.
- **Exact zenith** — azimuth is genuinely undefined (every direction is "down").
  `atan2(0, 0)` returns 0, so the star is reported due north: arbitrary, but
  deterministic, and a star at the zenith has no meaningful bearing anyway.
- **Rounding past |sin| = 1** near the zenith is clamped before `asin`.
- **The poles** (lat ±90) work: only the observer's own hemisphere is ever up.
- **Empty catalogue** → empty array.
- **Ordering** — catalogue order is preserved (a filter, never a sort), so the
  result is stable value-for-value and position-for-position.

---

## 2. `sonify.ts` — sky to score

### Inputs and outputs

```
sonify(stars: HorizonStar[], config: MappingConfig) → MusicalScore
```

Plus the individual mappings, exported so each can be tested and reasoned about
alone: `altitudeToMidi`, `magnitudeToAmplitude`, `colourToTimbre`,
`azimuthToPan`, `altitudeToTwinkle`.

### The approach

Filter to `altitude > 0`, sort by magnitude ascending with the catalogue id as
tiebreaker, take `maxVoices`, map each star to one sustained event.

| Star property | → | Musical result | How |
| --- | --- | --- | --- |
| altitude | → | `midi` | horizon-to-zenith divided into `PITCH_SPAN_OCTAVES` (3) octaves of scale degrees; nearest step wins |
| magnitude | → | `amplitude` | linear in decibels across a 24 dB range |
| B–V | → | `timbre` | `warmth` ramps −0.4 → 2.0; `brightness = 1 − warmth` |
| azimuth | → | `pan` | `0.85 · sin(azimuth)` |
| altitude | → | `twinkle` | airmass `1/sin(alt)`, full depth at airmass 5 |

**Pitch — why quantization is unbreakable.** The altitude range is divided into
`scaleDegrees.length × 3` discrete steps and the altitude selects an index. An
off-scale pitch is not unlikely; it is *unrepresentable*. This is the single
biggest lever between "data beeps" and music.

**Amplitude — why decibels.** An astronomical magnitude *is* a logarithmic
measure of flux, so mapping magnitude linearly onto decibels is the physically
faithful choice and also the perceptually even one. Untouched, the 8-magnitude
naked-eye span would be ~32 dB (4 dB per magnitude); compressing to **24 dB**
leaves the faintest star whispering at ~6% amplitude instead of vanishing.

**Pan — why `sin`.** `sin(azimuth)` is exactly the east-west component of the
direction you would face to look at the star. Due east is +1, due west is −1, and
north and south sit at 0 — correct, because a star straight ahead or behind you
has no left-right bias. The sine also compresses the image naturally near the
meridian, so no arbitrary curve is needed. The 0.85 width is the one artistic
concession: full hard-panning pushes a due-east star entirely out of one ear.

**Twinkle — why airmass.** Airmass ≈ `1/sin(altitude)` is the amount of
atmosphere the starlight crosses: 1 at the zenith, climbing steeply toward the
horizon. Scintillation grows with it. Depth reaches full at airmass 5
(altitude ≈ 11.5°), below which twinkling is dramatic to the naked eye.

**Determinism.** Every value derives from the star itself. The only ordering is
magnitude with the id as tiebreaker, so two stars of identical brightness can
never swap between runs. Floating-point results are rounded (4 decimals) and `-0`
is normalised to `0`, so deep-equality is never surprised.

**`config.seed` is accepted, validated, and unused in v1** — nothing in the
birth-sky mapping needs a random choice. It stays in the contract for instruments
that will (the Phase 6 orrery among them). Flagged rather than quietly dropped.

### Deliberate behaviours worth knowing

- **Two stars at the same altitude get the same pitch.** Not nudged apart: they
  really are at the same height, the unison is consonant by construction, and
  their different pans and timbres turn the doubling into a natural chorus.
- **`meta.label` never mentions place or date.** This layer does not know them,
  and inventing them here would be the layer overstepping. The instrument
  prefixes the place and date for display.
- **A bad config throws; a strange sky does not.** An unknown scale name, a
  non-positive `loopSeconds`, a root outside 0..127 are bugs and say so loudly.
  A polar winter with nothing overhead is an ordinary sky and returns an ordinary
  (empty) score.

### Edge cases

| Input | Result |
| --- | --- |
| Empty array | Empty score, label `"no stars above the horizon"` |
| Every star below the horizon | Same, with `objectCount` intact |
| Fewer visible than `maxVoices` | Uses what is there; label `"…all sounding"` |
| `maxVoices: 0` | Empty events, label `"…none sounding"` |
| Star exactly at altitude 0 | Excluded (geometric horizon, conservative) |
| Star with no `bv` | Neutral, roughly solar default (0.65) |
| Extreme `rootMidi` | Final pitch clamped into 0..127 |
| Unknown scale name | Throws, listing the available scales |

---

## 3. Worked example — the sky this was checked against

**Bengaluru, 1993-08-01, 00:00 IST** (= 1993-07-31 18:30 UTC), lat 12.9719 N,
lon 77.5937 E, UTC+5:30.

```
JD  = 2449200.27083
LST = 304.4782°  =  20.299 h
4,279 of 8,849 stars above the horizon
key: A minor-pentatonic · loop 18 s
```

| Star | mag | alt | az | midi | note | amp | pan | twinkle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Arcturus | −0.05 | 3.7 | 288.8 | 48 | C3 | 0.606 | −0.80 | 1.000 |
| Vega | 0.03 | 55.9 | 323.7 | 67 | G4 | 0.590 | −0.50 | 0.052 |
| Altair | 0.76 | 82.2 | 239.0 | 76 | E5 | 0.458 | −0.73 | 0.002 |
| Antares | 1.06 | 21.9 | 234.2 | 52 | E3 | 0.413 | −0.69 | 0.419 |
| Fomalhaut | 1.17 | 32.6 | 138.5 | 57 | A3 | 0.398 | +0.56 | 0.214 |
| Deneb | 1.25 | 57.3 | 7.7 | 67 | G4 | 0.387 | +0.11 | 0.047 |
| Shaula | 1.62 | 26.8 | 215.9 | 55 | G3 | 0.340 | −0.50 | 0.305 |
| Alnair | 1.73 | 25.2 | 159.6 | 55 | G3 | 0.328 | +0.30 | 0.338 |

**Why this is right, independent of the code:**

- LST 20.3 h means stars near **RA 20.3 h** sit on the meridian. **Altair**
  (RA 19.85 h, dec +8.87°) is just past it, and its declination nearly matches
  the latitude (12.97° N) — so it must be near the zenith. It reports **82.2°**.
- **Deneb** (RA 20.69 h, dec +45.3°) is just east of the meridian and north of
  the zenith → azimuth **7.7°**, nearly due north. Correct.
- **Arcturus** (RA 14.26 h) is ~6 h west of the meridian → setting in the
  west-north-west, azimuth **288.8°**, altitude **3.7°**. Being lowest, it
  correctly earns the maximum twinkle of **1.000**.
- **Antares** and **Shaula** (Scorpius) sit in the south-west; **Fomalhaut** is
  rising in the south-east. All correct for an August evening.
- Every winter star — **Sirius, Betelgeuse, Rigel, Capella, Procyon** — is below
  the horizon, exactly as it must be in August.
- Every pitch is in A minor-pentatonic (A C D E G): C3, G4, E5, E3, A3, G4, G3,
  G3. The two G4s and two G3s are the deliberate same-altitude chorus.

**Something to listen for in Phase 3:** five of these eight voices pan left,
because on this particular night the bright stars happen to sit in the west. That
is honest, not a bug — but it is worth hearing before deciding whether 0.85 is the
right stereo width.

---

## 4. The test list

`test/astro.test.ts` — 48 tests

- **Julian Date:** exact at J2000.0; four published Meeus examples; +1 per day;
  month, year and leap-day boundaries (2000 vs 1900); timezone offset applied;
  backwards roll over midnight; absent time defaults to local midnight; four
  malformed-date rejections.
- **GMST:** matches the defined value at J2000.0; advances 360.9856°/solar day;
  always in 0..360; rejects non-finite input.
- **LST:** adds eastern and subtracts western longitude.
- **Normalisation:** degrees into 0..360, hour angles into −180..180.
- **THE GATE — Polaris altitude ≈ latitude** across 7 latitudes × 7 longitudes ×
  5 dates × 7 times of day (1,715 skies), all within 1°; and below the horizon
  from the southern hemisphere.
- **THE GATE — zenith transit:** a star with `dec = latitude` reaches altitude 90
  at `H = 0`, checked at 8 latitudes; plus due-south and due-north meridian cases.
- **THE GATE — circumpolar geometry:** from London, no star below
  `dec = −(90 − lat)` ever rises, and no star above `dec = 90 − lat` ever sets —
  both swept over a full day in 20-minute steps; and from the equator every
  sampled star rises at some point.
- **Azimuth quadrants:** a star 6 h east of the meridian is due east and on the
  horizon, 6 h west is due west; azimuth always in 0..360.
- **`starsAboveHorizon`:** plausible visible fraction; only genuinely-up stars;
  catalogue order preserved; deterministic; the sky changes with the moment; the
  same sidereal moment a day later gives the same sky; poles; empty catalogue;
  impossible latitude rejected.

`test/sonify.test.ts` — 51 tests

- **THE GATE — always on-scale:** all 5 scales × 4 roots × 8 times of day, every
  emitted pitch a member of the scale; plus a 0.1°-resolution sweep of the entire
  altitude range; plus an unknown scale rejected by name.
- **THE GATE — determinism:** repeated calls deep-equal; freshly recomputed sky
  deep-equal; stable across 5 skies; JSON round-trip unchanged; magnitude ties
  broken by id and not by array order; different skies differ.
- **THE GATE — strange skies never throw:** empty input; all stars below the
  horizon; fewer visible than `maxVoices`; a single star; `maxVoices: 0`; real
  polar skies at ±89.9°; a star exactly on the horizon; a star with no colour.
- **Config validation:** non-positive `loopSeconds`, out-of-range `rootMidi`,
  non-finite `maxVoices`/`seed`; an omitted seed is fine.
- **Each mapping alone:** pitch monotone and clamped, horizon at the root, zenith
  at the top, never out of MIDI range, same altitude → same pitch; amplitude
  ordered, bounded, whisper floor at 24 dB, equal magnitude steps → equal dB
  steps; timbre complementary and bounded with a neutral fallback; pan east-right
  west-left, centred N/S, never beyond the width, symmetric; twinkle calm
  overhead, monotone, bounded, full at airmass 5.
- **The score as a whole:** every field populated; brightest stars in brightness
  order; no star claims two voices; key named from root and scale; counts match
  the input sky; the Bengaluru chord sits inside its three-octave span.

---

# 4. The Living Sky stream (Slice A1a)

Low-level design for the modules added in Slice A1a, realizing
`docs/LIVING_SKY_DESIGN.md` §2–10. Everything here is pure and lives in the
mapping layer; `test/boundaries.test.ts` still fails the build if any of it
reaches for Tone, the DOM, a clock, or unseeded randomness.

## 4.1 The modules

| File | Responsibility |
| --- | --- |
| `skyTime.ts` | listening time ↔ sky time ↔ sidereal time; occurrence enumeration |
| `skyEvents.ts` | closed-form rise / culmination / set, and altitude crossings |
| `skyWeather.ts` | sky statistics → the three dials, scale choice, budgets |
| `session.ts` | the once-per-session plan: κ solve, key, opening star, arc |
| `conductor.ts` | salience, phrase grid, note and silence budgets, recency |
| `stream.ts` | `renderWindow` — assembles GROUND, WEATHER, CHORD and LEAD |

## 4.2 Inputs and outputs

```
prepareSession(catalog, observer, config?) → SessionPlan     // pure, once
renderWindow(plan, fromSeconds, toSeconds) → ScoreWindow     // pure, per slice
```

A window contains every event whose onset lies in `[from, to)`. Events may
extend past `to` — a chord voice can sustain for tens of minutes.

## 4.3 The load-bearing invariant

**Partition invariance.** For any split of `[0, T)` into consecutive windows, the
union of those windows' events equals `renderWindow(plan, 0, T)` exactly.

Two rules make it hold, and every future addition must obey them:

1. **Every event's time is absolute**, derived from the session origin — never
   from where a window begins. An event belongs to the window containing its
   `startSeconds`, where `startSeconds = max(trueEventTime, 0)`. That clamp is
   what makes window 0 ordinary: stars already up when the piece starts get
   start 0, are emitted once, and never again.
2. **Continuous roles sit on an absolute grid.** GROUND and WEATHER emit one
   segment per `continuousSegmentSeconds` at multiples of that value; circumpolar
   chord voices are cut on the same kind of grid. Tie a continuous layer to
   window boundaries instead and two windows would carry two segments where one
   window carries one.

The Conductor is the one part that wants history. It gets it through a **bounded
lookback anchored to an absolute phrase index**: to decide phrase *p* it replays
phrases from `max(0, p − lookbackPhrases)` forward, always from the same anchor,
so the answer depends only on *p*. Any future rule that cannot be expressed with
bounded lookback does not go in.

## 4.4 Closed-form astronomy

```
cos H = (sin A − sin dec · sin lat) / (cos dec · cos lat)
```

is the hour angle at which a star sits at altitude `A`. `A = 0` gives the horizon
(rise at −H, set at +H); culmination is always `H = 0`; and the same call answers
"when does this star cross 55°" for the octave lift. No search, no sampling, no
tolerance. `hourAngleAtAltitude` returns `null` when the crossing does not exist.

Three regimes, and the code branches on them explicitly:

| Regime | Condition | Events |
| --- | --- | --- |
| never rises | `90 − |lat − dec| ≤ 0` | none |
| circumpolar | `−90 + |lat + dec| > 0` | culmination only |
| rises and sets | otherwise | rise, culmination, set |

Verified against `starsAboveHorizon()` / `toHorizon()`, which were derived
independently in Phase 2: a predicted rise has the star below the horizon 20
listening-seconds before and above 20 after, and a predicted culmination sits at
`90 − |lat − dec|` and is a genuine local maximum.

## 4.5 CHORD

Per design §10.1 (approved, superseding Phase 2's current-altitude mapping):

```
pitch class  ← the star's MAXIMUM altitude, 90 − |lat − dec|   (its identity)
octave       ← voice-leading, then +1 if the star climbs past octaveLiftDegrees
amplitude    ← magnitude, shaped by a smoothstep horizon fade
```

Phase 2's mapping cannot survive an advancing sky: every star rises *through*
altitude 0, so every voice would enter on the root and then re-quantize as it
climbed. Culmination altitude is fixed per star per observer, so each star owns a
stable note and holds it — which is also perfect common-tone retention.

**Voice-leading** is therefore only ever "which octave should an entering voice
take". It takes the octave, within the weather's register span, nearest the
centroid of the sounding voices — where that centroid is computed from each
visible star's *canonical* placement, a pure function. Using the octaves actually
assigned would make the rule recursive and destroy window independence.

Bound: at most 6 semitones of residue from picking the nearest octave, plus 12
for a lifted voice. Measured worst case across an hour: 17.7.

**Known simplification.** The octave lift is decided once per voice from the
star's culmination altitude, not re-evaluated as it climbs. That keeps a
sustained voice from changing pitch mid-note (which would need a split and a
crossfade). True altitude-following register motion is a small A1b change —
`hourAngleAtAltitude` already returns the crossing time.

## 4.6 LEAD and the Conductor

The sky offers a true event roughly every ten seconds; the Conductor uses about
one in four. It works on a fixed grid of `phraseSeconds`, takes candidates only
from the front `(1 − silenceBudget)` of each period, ranks them by

```
salience = 0.5·brightness + 0.2·(altitude/90) + 0.3·kindWeight
kindWeight: culmination 1.0, rise 0.6, set 0.45
```

and keeps at most `notesPerPhrase`, no two closer than `minNoteGapSeconds`, with
no star repeating inside the lookback. The chime speaks the star's own note
carried up `leadOctaveOffset` octaves — octave-only, so on-scale by construction.

Culmination is deliberately the highest-weighted kind because it is the only
event type that survives at every latitude (see §4.8).

## 4.7 Emotional weather

Measured per scene: visible count, integrated brightness, brightest magnitude,
angular spread from the brightness centroid, and clustering (share of stars in
the densest tenth of sky cells — an honest Milky Way proxy from the catalogue
alone). Those produce `density`, `luminosity`, `solitude`, which drive the
register span, the silence budget, the note budget and the layer count.

The **scale and root are chosen once per session** from the mean of five samples
across what the session traverses (design §P5, approved): modulating the scale
mid-piece would either force a key change under a sustained drone or emit
off-scale notes during the crossfade.

## 4.8 What the data corrected

**Latitude does not make a sky sparse — it makes it still.** Measured with the
bundled catalogue: 4,249 stars visible at latitude 89.5° against 4,306 at
Bengaluru, and densities of 0.67 either way. A pole sees half the celestial
sphere permanently, and that half holds about as many stars as any other half.

So the "lonely sky" of the Musical Vision is not the polar one. It is the
**light-polluted** one: restricting the catalogue to stars brighter than
magnitude 3 drops density from 0.665 to 0.034, a twentyfold difference. That is
the mechanism behind "a lonely sky should sound lonely", and it is exactly the
city-dweller case the Vision names.

The polar sky is still lonely, but through **stasis**: measured over an hour of
piece time at latitude 89.5°, 59 culminations against 2 rises and 1 set. Nothing
arrives or departs. That is why the LEAD leans on culmination.

## 4.9 The arc and the gesture

`solveKappa` scores every reachable culmination of a star brighter than
`bloomMagLimit` by `salience × paceComfort(κ)` and sets κ so the winner lands at
`bloomFraction` of the session, within the approved [40, 90] band; it falls back
to `preferredKappa` when nothing qualifies. Stages run
opening → gathering → building → bloom → release → closing, and in endless mode
the arc follows the sky's own richness instead of a session position.

The opening gesture gives the brightest visible star a voice at t = 0 with
nothing else sounding; the rest enter staggered in brightness order across
`gatheringSeconds`. The closing mirrors it so the same star is last.

## 4.10 Worked example — Shambu's own birth sky

Bengaluru, 1993-08-01 00:00 IST, defaults, birth-sky mode:

```
kappa    66.40×      (660 s of listening traverses 12.2 sky-hours)
key      dorian      (weather luminosity 0.489)
weather  density 0.670, solitude 0.330 → silence budget 0.466, 2 notes/phrase
opening  Arcturus, alone at t = 0
BLOOM    Aldebaran culminating at 449 s — 68% through, exactly as designed
events   126 total: 44 chord, 38 lead, 22 ground, 22 weather
closing  Arcturus again, the last voice, ending at 660 s
```

The chimes around the bloom read: Mirfak culminates, Deneb sets, Alsephina rises,
**Aldebaran culminates**, then Rigel, Bellatrix and Saiph culminate in turn —
Orion crossing the meridian right behind Taurus, which is exactly what that sky
does. The music follows the night because it is reading the night.

---

# 5. The composed layer (Slice A1b)

Motifs, the phrase grammar and the development transforms, realizing design §5–7.

## 5.1 Degree space — why the covenant survives development

**Every transform operates on scale-degree indices, never on semitones.** A
degree is an unbounded integer position on the ladder; it becomes a pitch only at
the very end, in `degreeToMidi`.

| Transform | Operation | Fired by |
| --- | --- | --- |
| transposition | `d → d + n` | the answer (n = −1) |
| inversion | `d → 2·pivot − d` | a **setting** subject |
| augmentation | `gaps → gaps × 1.6` | a **culminating** subject |
| octave shift | `d → d ± degreesPerOctave` | register placement |

Inverting a minor third in semitone space gives a major sixth, which need not be
in the scale. Inverting in degree space *cannot* leave the ladder: `2·pivot − d`
is an integer and every integer is a rung. Out-of-range pitches are folded by
whole octaves rather than clamped — a clamp is precisely how an off-scale note
would sneak in at the edges. The property test drives arbitrary sequences
(including negatives and ±456) through every composition of transforms, across
all five scales and four roots.

## 5.2 Motifs

```
deriveMotif(catalog, constellation) → Motif | null
```

1. Members brighter than magnitude 3, sorted by magnitude then id; at least 3.
2. Keep the brightest **≤ 5** — the Beethoven cell.
3. Order by the **exact shortest open Hamiltonian path** (≤ 120 permutations, so
   the optimum is computed, not approximated), oriented from the brighter end.
4. Contour: `round((dec − centre)/halfSpan × 3)` — higher in the figure, higher
   note. Rhythm: gaps proportional to angular separation.

All of it in RA/Dec, so **the figure is identical from every place on Earth and
every date** — the property the identity claim rests on, and the one §14.17 tests
across six observers × four dates.

**29 constellations qualify** (not the 31 in the design note: that probe used
`mag ≤ 3` while the spec says `mag < 3`, and two constellations sit exactly on
3.00). Measured contours: Orion `[-3,-1,-1,2,3]` walking up through the belt,
Cassiopeia `[0,-4,2,2]` zigzagging, Canis Major `[3,3,-1,-2,-3]` falling from
Sirius.

**Wording.** This is *a path through a constellation's brightest stars*, never a
stick figure — we have no asterism data (design §P1, ruled).

**Prominence.** A constellation speaks when its mean right ascension culminates
(the group crossing the meridian) **and** every motif star is above the horizon
**and** the group's mean altitude clears 35°.

## 5.3 The phrase grammar

```
STATEMENT  the subject's figure — one chime, or a motif
ANSWER     the same material transposed down ONE degree, truncated, quieter
REST       to the end of the period, honouring the silence budget
```

Three constraints shape what actually gets said, and all three are asserted:

- **Note budget.** `noteAllowance` divides the per-minute budget by the number of
  phrase periods a *sliding* minute can touch — `floor(60/phrase) + 1` — not by
  the phrase rate. Dividing by the rate overshoots, and the sliding-window test
  caught it: two adjacent phrases put 10 notes in a minute against a budget of
  9.4. On Shambu's sky the allowance is 3 statement + 1 answer.
- **The active portion.** No note may start after `(1 − silenceBudget)` of its
  period. Notes that would spill are dropped.
- **Motif viability.** A constellation is only accepted as a subject if at least
  3 of its notes fit; otherwise the Conductor falls through to the next-best
  subject. A one-note motif is not a motif, and mangling the figure would waste
  the only thing carrying the identity.

## 5.4 The opening anchor

Three rules, config-selectable so they can be compared by ear
(`openingAnchorRule`), because on Shambu's own sky all three pick a different
star:

| Rule | Star | alt at 0 / 231 / 660 s |
| --- | --- | --- |
| `brightest` | Arcturus (mag −0.05) | 4° / **−49°** / 8° |
| `survives-gathering` | Vega (mag 0.03) | 56° / 9° / **−32°** |
| `bookends` *(default)* | **Polaris** (mag 1.97) | 13° / 14° / 13° |

`brightest` is truest to the Vision's wording but Arcturus is *setting* — gone
16 seconds in. `survives-gathering` is HQ's ruling and fixes the opening, but
Vega has set by the close so the one → all → one mirror cannot complete.
`bookends` refines HQ's rule *within its qualifying set* by preferring a star
that is also up at the end; on this sky that is Polaris, circumpolar and steady
at ~13° all night. Dimmer, but it can actually bookend the piece.

## 5.5 Worked example — the composed layer on Shambu's sky

Bengaluru, 1993-08-01 00:00 IST, defaults (κ 66.40×, dorian, bloom = Aldebaran
culminating at 449 s):

**Motifs that fire** — in the order those constellations cross the meridian:

| t | Constellation | Path | Contour | Mean alt |
| --- | --- | --- | --- | --- |
| 5 s | Cygnus | Aljanah → Sadr → Deneb → Fawaris | `[-4,0,2,2]` | 61° |
| 261 s | Andromeda | Alpheratz → Mirach → Almach | `[-3,0,3]` | 65° |
| 389 s | Perseus | …→ Algol → Mirfak → … | `[-3,-1,-1,2,3]` | 59° |
| 583 s | Gemini | Pollux → Castor → Tejat → Alhena | `[1,3,-1,-3]` | 75° |

**Phrases either side of the bloom:**

```
t=369s  39840        rise           statement [0]        answer []
t=389s  Per (motif)  constellation  statement [-3,-1,-1] answer [-4]
t=417s  Alsephina    rise           statement [0]        answer [-1]
t=449s  Aldebaran    culmination    statement [0]        answer [-1]   <- BLOOM
t=484s  Rigel        culmination    statement [0]        answer [-1]
t=520s  Betelgeuse   culmination    statement [0]        answer [-1]
t=546s  Canopus      culmination    statement [0]        answer [-1]
```

The arc's climax and the Conductor's chosen phrase land on the same event:
**Aldebaran speaks at exactly 449 s**, the moment the piece was paced to reach.
Orion follows it across the meridian, star by star, because that is what that
sky does.

## 5.6 Performance

`arcAt` in endless mode originally measured the full catalogue for every envelope
breakpoint — 8,849 horizon reductions, thousands of times per window. It now
follows the fraction of *chord-pool* stars above the horizon (48 reductions),
which is both far cheaper and a better proxy for how full the music should be.
Window weather is memoised on an absolute 30-second grid, so slicing cannot
change it. Together these took the Living Sky suite from 26 s to 2.4 s — which
matters, because Slice A2 has to schedule these windows in real time.

---

# 6. The streaming scheduler (Slice A2)

`src/engine/audio/streamEngine.ts` — the second and last file that imports Tone.

## 6.1 How scheduling works

Every event carries an absolute piece time, so scheduling is arithmetic against a
fixed origin captured at `play()`:

```
audioTime = origin + (event.startSeconds − sliceFrom)
```

There is no crossfade, no re-trigger and no seam at a window boundary, because
there is no boundary state — that is what partition invariance bought. The live
player tops up its schedule every 8 s with a 20 s lookahead; an offline render
schedules the whole span at once. Both use the same code path.

A slice may begin anywhere: events already sounding are started part-way through,
with their amplitude envelope read at the correct offset (`envelopeValueAt`), so
a bloom clip opens with the chord bed already in the air rather than in silence.

## 6.2 Roles to voices

| Role | Voice |
| --- | --- |
| GROUND | the persistent two-oscillator drone; its level follows the arc envelope |
| CHORD | octave-only partial stack, B–V lowpass, twinkle tremolo, per-voice pan; the score's breakpoints drive a gain node, so the swell is the **sky's**, not an ADSR's |
| LEAD | brighter partial stack, fast attack, long ring — struck glass |
| WEATHER | drives the shimmer send and reverb wet |

`getLevels()` reports per-voice meters and `getLevelSources()` names the star each
belongs to, ready for the Phase 4 star-field.

## 6.3 Voice-count normalisation

The first bloom render clipped hard — 6,282 clipped samples, peak 0.0 dBFS, the
mix pinned flat at −11 dBFS. Cause: a fixed per-voice gain. The opening has one
voice and a later stretch has twenty, and Phase 3.5 avoided this with
`masterGain / sqrt(voices)` on a static chord. The stream now scales every chord
voice by `1/sqrt(mean concurrent voices)`, sampled across a full sidereal turn so
the level is steady for the whole piece and there is no gain jump when the sky
fills. After the fix: **0 clipped samples everywhere**.

The opening deliberately sits ~8 dB below the bloom. That dynamic range across
the piece is the arc doing its job and must not be levelled away.

## 6.4 A measurement correction — how to probe for off-scale energy

Phase 3.5 reported "worst off-scale leakage −43 to −52 dB", measured by running
Goertzel at **exact equal-tempered** off-scale frequencies (F3 174.61, B3 246.94
and so on). That method is too weak, and this slice exposed why.

A **peak-finding sweep** of the rendered audio (0.5 Hz resolution, then
identifying each peak's nearest note and cents deviation) tells a different story.
The lush bloom's strongest peaks include energy at 115.0 Hz, 235.0 Hz, 475.0 Hz
and 955.0 Hz — all 14–33 cents off equal temperament, which is precisely why
narrow-band probes at exact ET frequencies missed them.

Their signature identifies the source: each sits a **constant ~4.5 Hz** from an
on-scale partial (110.5/115.0, 230.5/235.0, 470.5/475.0). Constant in *hertz*, not
in cents, so it is not a pitch relationship — it is granular sideband from
`Tone.PitchShift`, the octave-up shimmer.

Confirmed by comparison. Same 30 s window, same score, only the shimmer dials
changed:

| | lush (send 0.55, fb 0.38) | subtle (send 0.24, fb 0.16) |
| --- | --- | --- |
| strongest off-scale peak | **+4.0 dB** *above* the loudest on-scale partial | **−30.6 dB** |
| top six peaks | 4 of 6 off-scale | **6 of 6 on-scale** |

**The mapping layer is not implicated**: every *scheduled* pitch is on-scale, and
305 tests prove it. What the shimmer adds is inharmonic sideband — audible as
beating and haze rather than as wrong notes, but at lush settings it dominates the
spectrum. Peak-finding is now the method of record; the fixed-frequency probe
under-reported and should not be trusted alone.

---

# 7. The FIGURATION layer (Slice A3)

`src/engine/mapping/figuration.ts` — the meso timescale, and the fix for the
ear-gate failure.

## 7.1 Why it exists, and why it is not called PULSE

Music lives on three timescales. We had the macro arc (eleven minutes of real
night) and Slice B will bring the micro (instrument timbre), but the 0.5–3 second
layer where perception binds notes into melody was empty: one phrase every thirty
seconds over sustained voices reads as isolated events over a hum.

The dormant role was called `pulse`, and the name was part of the problem — a
*pulse* is a beat, and "percussion flattens the emotion" got over-read into "no
meso layer at all". What the handpan reference actually shows is that a soft
cyclic **figuration** hypnotises where a beat demands. The role is renamed to say
what it is.

## 7.2 Truth

The figuration invents nothing. Its entire vocabulary is `soundingChordTones` —
the same computation the CHORD events use, extracted to `chordVoices.ts` so the
two layers cannot disagree. A figuration note may only double a pitch already in
the air, so it is on-scale **and true by construction**, not by a check. Its
*timing* is artistic, which the covenant already declares.

## 7.3 The hard problem: evolution that is also a pure function of time

The pattern must evolve (≤1 slot different between consecutive cycles) *and* be
reconstructible from absolute time alone, or partition invariance dies.

Iterating a mutable pattern forward needs unbounded history. Instead every slot
carries its own deterministic **change epoch**:

- the cycle has `slots` positions (8), each `figurationSlotSeconds` (0.55 s) long,
  so a cycle is 4.4 s;
- a seeded permutation `changeOrder` maps each cycle-residue to the one slot
  allowed to change then. Because it is a bijection, **exactly one slot changes
  per cycle, by construction**;
- `lastChangeCycle(s, n)` is arithmetic: the most recent cycle at or before `n`
  whose residue is slot `s`'s position;
- **everything** about a slot is read at that cycle — its tone *and* whether it
  sounds at all.

That last point is what makes the guarantee absolute. Every slot other than the
one changing resolves to the same change cycle it had at `n − 1`, so it *cannot*
differ. Density can therefore ride the arc continuously as a target: each slot
adopts it when its own turn comes, so a fast-moving target is still absorbed one
slot at a time.

An earlier attempt suppressed the re-pick on "density cycles" instead. It failed
the test at cycle 32 — suppression only *shifted* the change rather than removing
it, so two slots moved at once. The slot-local reading is both simpler and
strictly correct.

## 7.4 The other transition rules

- **Migration.** When a star sets, its slots fall silent immediately — the pitch
  would no longer be true — and take a new tone only at their own next change
  cycle. Gradual, and never mid-cycle.
- **Anticipation.** The cycle before a stage change dips velocity ~15% and leans
  the register toward the next stage: a breath, not a step. It deliberately does
  *not* change the slot count, so only one parameter moves at a time.
- **Continuity.** Velocity and register are evaluated per note from the same
  `energy` (0.65 × arc intensity + 0.35 × weather density), so the layer breathes
  continuously between the discrete pattern changes.
- **Micro-timing.** Each onset is nudged by up to ±18 ms from a seeded hash of
  (cycle, slot) — deterministic, never enough to reorder the weave, and enough
  that the grid never clicks.

## 7.5 Measured evolution across a stage boundary

Bengaluru birth-sky, GATHERING → BUILDING at cycle 17 (t = 74.8 s). `·` is a
silent slot; each cycle differs from the one above it in exactly one place:

```
cycle   t(s)   stage       slots                                          active  diff
   13   57.2   gathering   ·  ·  ·  Vega     ·  Fomalhaut Achernar Deneb     4     —
   14   61.6   gathering   ·  ·  ·  Vega     ·  Fomalhaut Achernar Deneb     4     1
   15   66.0   gathering   ·  ·  ·  Polaris  ·  Fomalhaut Achernar Deneb     4     1
   16   70.4   gathering   ·  ·  ·  Polaris  ·  Fomalhaut Achernar Deneb     4     1
   17   74.8   gathering   ·  ·  ·  Polaris  ·  Fomalhaut Achernar Deneb     4     1
   18   79.2   building    ·  ·  ·  Polaris  ·  Vega      Achernar Deneb     4     1
   19   83.6   building    ·  ·  ·  Polaris  ·  Vega      Achernar Deneb     4     1
   20   88.0   building    ·  ·  ·  Polaris  ·  Vega      Achernar Fomalhaut 4     1
   21   92.4   building    ·  ·  ·  Polaris  ·  Vega      Shaula   Fomalhaut 4     1
```

The stage boundary (17 → 18) passes through as a single tone substitution,
Fomalhaut → Vega. No pattern switch, no density step, no lurch — which is exactly
the craft note from the sketch listen.

Over a full session the figuration contributes **716 notes** against 46 lead, 44
chord and 22 each of ground and weather — the meso layer is now by far the
densest, as it should be.

## 7.6 Rendering: two fixes worth keeping

**Synchronous offline rendering.** Slice A2 could never finish a long render and
the diagnosis was a guess. It is now confirmed from the source: Tone's
`OfflineContext.render()` defaults to `asynchronous = true`, which yields to
`setTimeout(done, 1)` every render block — and `setTimeout` is precisely what
Chrome throttles to about once a minute in a hidden tab. `renderStreamOffline`
now drives an `OfflineContext` directly with `render(false)`, which skips the
yields entirely and is immune to timer throttling.

**Meters off when rendering.** Every voice was given a `Tone.Meter` (an
AnalyserNode). Live, the star-field needs them; offline nobody ever calls
`getLevels()`, and a long session creates hundreds of notes. They are now opt-out
and off for offline renders.

---

# 8. The FORM layer (Slice A4)

`src/engine/mapping/movement.ts` — the Movement Planner, realizing Musical
Vision §6b after the v2 listen ("still lacks rhythms, patterns, building up,
transitions").

## 8.1 The doctrine A3 had inverted

- **Repetition belongs at the MESO scale.** A pattern must repeat long enough to
  be *learned*, or it never becomes a groove. A3 changed a slot every cycle, so
  nothing could settle.
- **Non-repetition belongs at the MACRO scale.** The piece never returns to the
  same state.

A4 therefore fixes the rhythm inside a movement and moves the contrast to the
boundaries between movements.

## 8.2 Where it lives, and why that guarantees purity

The whole plan is computed **once**, inside `prepareSession`, and stored on the
`SessionPlan`. `renderWindow` only ever reads it. Partition invariance is
therefore structural: a window cannot derive a different form for a different
slice, because it derives no form at all.

## 8.3 Partitioning

Candidate structures are the constellation prominences (same definition the
Conductor uses — every motif star up, group mean altitude past threshold, at the
group's meridian crossing) plus the bloom.

**The bloom is placed first and is mandatory.** Taking candidates purely in time
order let a constellation claim the boundary just before the climax; the bloom
then failed the minimum-length test and got no movement of its own, so the
additive build had nowhere to happen. The night's climax outranks every other
structure and reserves its section before anything else may.

Remaining candidates are accepted in time order if they clear
`movementMinSeconds` from every boundary already taken. Any stretch longer than
`movementMaxSeconds` is split, and those unanchored sections become the *still*
movements — which is itself a fact about the night.

## 8.4 The pattern vocabulary (composed clothing, labelled)

Five patterns, seeded from HQ's ear-approved v3 sketch, as 8-slot masks:

| Pattern | Mask | Register | Velocity |
| --- | --- | --- | --- |
| `sparse-low` | `x···x···` | −1 | 0.80 |
| `half-time-still` | `x·······` | −1 | 0.70 |
| `mid-weave` | `x·x·x·x·` | 0 | 0.90 |
| `dense-build` | `xxx·xxx·` | +1 | 1.00 |
| `thinning-return` | `x··x··x·` | 0 | 0.75 |

Assignment follows the arc: opening → `sparse-low`, the bloom → `dense-build`,
the last movement → `thinning-return`, an unanchored or long section →
`half-time-still`, otherwise `mid-weave`. Two adjacent movements are never given
the same pattern — that would read as one long section with a bump in it.

**The truth boundary:** the sky decides *which* patterns, *when*, *how dense*,
*in what harmony* and *toward what climax*. The vocabulary itself is composed
clothing, the same covenant category as timbre and tempo.

## 8.5 Transitions as first-class objects

A seam is `[toSeconds, toSeconds + transitionSeconds)`. Across it the mask
crossfades: the active count is the interpolated density, the incoming pattern's
own slots are taken first (so the new groove is what emerges, not a blur), and
the outgoing pattern holds the remainder until it is gone. A breath swell
(±18% velocity, a half-sine over the seam) marks the join as a gesture.

Two constraints set the seam's length, and it must satisfy both:

1. the note rate may not move faster than `formMaxRateStep`;
2. **the mask is integer-valued, so it cannot move more than one slot per cycle
   without an audible step** — five slots cannot be crossed in four cycles
   whatever the average rate says.

The second is usually binding, and missing it left a two-slot jump at the seam
into the bloom. Seams therefore run `max(12–16 s, gap × cycle)`; the widest pair
in the vocabulary (1 slot against 6) needs 22 s, which is a longer mix for a
bigger change — as it should be.

A third subtlety: every pattern here sounds slot 0, so the two crossfade passes
can *share* a slot and fall short of the target count. A top-up pass fills from
whatever remains, incoming first, so the count is exactly the interpolated one.

## 8.6 Motif as ostinato

During a constellation's movement its figure returns every
`ostinatoEveryCycles` (4) — the section's groove, not a one-shot chime. Each
contour degree lands on the **nearest currently-sounding chord tone**, so the
shape is the constellation's real geometry and every pitch is a tone genuinely
in the air.

Note that the LEAD also states motifs, and does so differently: melodically, in
its own register, from the anchor degree plus the contour. Both are on-scale;
only the figuration promises to double a live tone. The tests keep them apart.

## 8.7 The bloom movement — Zimmer additive

Inside the bloom movement one layer is added every `bloomLayerEveryCycles` on
the way up and removed in reverse on the way down:

1. octave doubling (+12, half gain)
2. off-beat echo (half a slot later, ⅓ gain)
3. high sparkle (+24 on slot 0 only, ⅕ gain)

Every layer is a whole-octave transposition, so the on-scale guarantee is
untouched. `bloomLayersAt` is a pure function of the cycle's distance from the
climax — nothing accumulates.

Measured on the Bengaluru session: layers ramp `1 1 2 2 3 3 3 3 3 3 3` into the
climax and strip `2 2 1 1` after it.

## 8.8 The Bengaluru session, and how it compares to the approved sketch

κ 66.40×, A dorian, bloom = Aldebaran at 449 s, cycle 4.40 s:

| # | body | seam | pattern | reg | anchor | figuration notes | ostinato statements |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0–124 | 12 s | `sparse-low` | −1 | opening / Polaris | 56 | 0 |
| 1 | 136–219 | 16 s | `mid-weave` | 0 | constellation / Peg | 71 | 5 |
| 2 | 235–377 | 22 s | `half-time-still` | −1 | constellation / Cas | 32 | 8 |
| 3 | 399–480 | 12 s | `dense-build` | +1 | **bloom / Aldebaran** | 273 | — |
| 4 | 492–551 | 16 s | `mid-weave` | 0 | constellation / Aur | 53 | 4 |
| 5 | 567–660 | — | `thinning-return` | 0 | return / Polaris | 55 | 6 |

Against v3's hand-composed boundaries (0 / 88 / 104 / 252 / 268 / 384 / 398 /
556 / 572):

| | engine | v3 | Δ start |
| --- | --- | --- | --- |
| M0 | 0–124 | 0–88 | **0 s** |
| M1 | 136–219 | 104–252 | +32 s |
| M2 | 235–377 | 268–384 | −33 s |
| M3 | 399–480 | 398–556 | **+1 s** |
| M4 | 492–551 | 572–660 | −80 s |
| M5 | 567–660 | (v3 had five) | — |

**The two structural pillars land within a second**: the opening at 0 and the
bloom movement at 399 against v3's 398. Those are the boundaries the sky itself
dictates — the session origin and the true climax — and the engine finds them
independently. The middle boundaries differ because v3's were chosen by ear from
the same score; the engine anchors them to prominences instead (Pegasus,
Cassiopeia, Auriga), and produces six sections where the sketch drew five.

Figuration density carries the contrast the sketch was reaching for: 273 notes
in the bloom movement against 32 in the still one, an 8× swing across the piece.
