# Cosmophony

**The real sky above a place and date, turned into calm ambient sound.**

Enter a birthday and a city; Cosmophony works out which stars were actually above
that horizon at that moment and plays them as a slow, consonant drone you can
leave running. The structure is true — real stars, real positions, real
brightness. The timbre, the musical scale, and the timing are artistic choices.
It is never a claim about what space literally sounds like.

Everything runs in your browser. No accounts, no backend, no tracking; the date
and place you type never leave your machine.

> **Status: Phase 3 of 7 — audio layer.** The architecture, the bundled data, the
> astronomy, the sonification, and the Tone.js synthesis are real and tested (197
> tests). It makes sound: `npm run dev` then open
> [`/harness.html`](http://localhost:5173/harness.html) and press Play. There is
> no app UI yet. Rendered samples are committed under `docs/` — compare
> `phase35-lush-bengaluru.wav` and `phase35-subtle-bengaluru.wav` against the
> plainer `phase3-bengaluru-1993-08-01.wav`. See `docs/BUILD_LOG.md` for exactly what
> is real so far, and `docs/LLD.md` for how the mapping works.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build
npm run test         # vitest
npm run typecheck    # tsc --noEmit
npm run build:data   # regenerate the bundled star + city data from source
```

**Hearing it (dev only).** `harness.html` is a Phase 3 scratch page — it is not
part of the production build. With `npm run dev` running, open
`http://localhost:5173/harness.html`, press **Play** (browsers require a real
user gesture before any audio can start), or **Render** to write an 18-second WAV
into `docs/`. `?seconds=54&name=my.wav` changes the length and filename, and
`?style=subtle` renders the restrained take instead of the lush one.

Requires Node 20+ (developed on Node 25).

## Architecture

Three decoupled engine layers, plus pluggable instruments and a thin shell:

```
src/
  engine/
    model/        Layer 1 — data model. Depends on NOTHING.
    mapping/      Layer 2 — sonification. Depends ONLY on model.
                  Pure and deterministic: no Tone.js, no DOM, no clock,
                  no unseeded randomness. This is the heart.
    audio/        Layer 3 — the Tone.js graph. The ONLY place Tone is imported.
  instruments/    Pluggable experiences built on the engine surface.
    birthSky/     v1 hero instrument.
    orrery/       Reserved for Phase 6 (TRAPPIST-1).
  app/            The shell: UI, star-field canvas, export. Cheap to change.
```

**The dependency rule is the whole design.** Nothing flows upward, and `mapping`
importing Tone or touching the DOM is a build failure — `test/boundaries.test.ts`
scans the source and fails the suite if it happens. Keeping the mapping layer
pure is what makes the astronomy testable and the same input reproducible
forever.

The architecture gets its real exam in Phase 6: adding the orrery instrument must
require zero edits to `engine/`.

## Publishing (copy-paste)

These commands are for Shambu to run — nothing here has been pushed anywhere.

```bash
cd builds/POC5_Cosmophony
git init
git add .
git commit -m "Cosmophony: phase 0 scaffold"
git branch -M main
```

Create an empty repo at <https://github.com/new> named `cosmophony` (no README,
no .gitignore, no licence — this folder already has them), then:

```bash
git remote add origin https://github.com/dshambuprasad/cosmophony.git
git push -u origin main
```

Or: open the folder in GitHub Desktop → **Publish repository**.

### Free hosting on GitHub Pages

The build uses relative asset paths (`base: './'` in `vite.config.ts`), so it
works from a project sub-path without any extra configuration.

```bash
npm run build          # produces dist/
npx gh-pages -d dist   # publishes dist/ to the gh-pages branch
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch →
`gh-pages` / `(root)`**. The site appears at
`https://dshambuprasad.github.io/cosmophony/` within a minute or two.

(Alternative, no extra package: **Settings → Pages → Source: GitHub Actions** and
pick the Vite starter workflow.)

## Data sources

Two datasets are bundled as static JSON, so nothing is fetched from the network
at runtime:

| File | Contents | Source | Licence |
| --- | --- | --- | --- |
| `public/data/stars.hyg.subset.json` | 8,849 naked-eye stars (mag ≤ 6.5) | [HYG Database v3.8](https://github.com/astronexus/HYG-Database) | CC BY-SA 2.5 |
| `public/data/cities.json` | 1,500 cities across 244 countries, with fixed UTC offsets | [GeoNames `cities15000`](https://download.geonames.org/export/dump/) | CC BY 4.0 |

Both are regenerated from source by a zero-dependency script:

```bash
npm run build:data            # uses cached downloads
npm run build:data -- --fresh # re-download from source
```

It is deterministic — the same sources produce byte-identical output — and it
rewrites `public/data/ATTRIBUTION.md` with the source URLs, licences, SHA-256
checksums, every transform applied, and the access date. **Read that file before
redistributing the data.**

## Licence

The **code** is MIT — see `LICENSE`.

The **bundled data is not MIT**, and the two obligations differ:

- `stars.hyg.subset.json` derives from HYG, which is **CC BY-SA 2.5** — attribution
  *and* ShareAlike. Redistribute it under the same licence.
- `cities.json` derives from GeoNames, which is **CC BY 4.0** — attribution.

Neither dataset is public domain. Shipping `public/data/ATTRIBUTION.md` alongside
the data satisfies both licences.
