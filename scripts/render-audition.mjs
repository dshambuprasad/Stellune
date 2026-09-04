#!/usr/bin/env node
/**
 * Slice B0 — print the audition set: one 60-second clip per mood lens.
 *
 *   npm run audition
 *   npm run audition -- --from=0 --seconds=90
 *
 * These are the clips that go to the ear gate, so they are all printed from the
 * SAME window of the SAME score: the only thing that differs between them is
 * the lens.
 *
 * AN AUDITION PUBLISHES NOTHING. It never passes `--publish-calibration`, so no
 * clip printed here can re-level the shipping app — see `render-score.mjs`, and
 * the regression test in `test/calibration.test.ts`.
 *
 * Default window is t=360–420 s of the birth session, chosen because
 * it is the densest minute in the A3 score — 82 figuration onsets, 7 lead
 * phrases and 30 chord voices, all five roles fully present. The opening
 * gesture (t=0) is the more beautiful minute, but it is one star answered by a
 * handful; it would not tell you whether the instruments work.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const DEFAULTS = { from: 360, seconds: 60, section: 'birth', score: 'docs/a3-score.json' };
const passthrough = process.argv.slice(2);

const lenses = Object.keys(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'samples', 'lenses.json'), 'utf8')).lenses,
);

const given = new Set(passthrough.map((a) => a.split('=')[0]));
const base = Object.entries(DEFAULTS)
  .filter(([k]) => !given.has(`--${k}`))
  .map(([k, v]) => `--${k}=${v}`);

const render = (lens, extra) =>
  execFileSync(
    process.execPath,
    [
      path.join(HERE, 'render-score.mjs'),
      ...base,
      ...passthrough,
      `--lens=${lens}`,
      `--json=docs/b0-${lens}-render.json`,
      ...extra,
    ],
    { stdio: 'inherit', cwd: ROOT },
  );

/**
 * Pass 1 — find the fader the whole set will share.
 *
 * Left to itself, each clip is peak-normalised to the ceiling, and a lens with
 * a transient-heavy palette (Ground's handpan and chimes) then prints far
 * quieter than a smooth one (Aurora's strings) even though their stem buses
 * are within a decibel of each other. That difference is crest factor, not
 * music, and it would dominate an A/B listen. So every clip in the set gets the
 * single most conservative fader, and the lenses' real relative loudness — the
 * thing the ear gate is actually judging — survives intact.
 */
console.log('pass 1 — measuring headroom across all five lenses\n');
const trims = [];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmophony-audition-'));
for (const lens of lenses) {
  // Pass 1 only needs the measurement, so its WAV goes somewhere disposable
  // rather than leaving a 10 MB intermediate next to the committed clips.
  render(lens, [`--out=${path.join(scratch, `${lens}.wav`)}`]);
  const report = JSON.parse(
    fs.readFileSync(path.join(ROOT, `docs/b0-${lens}-render.json`), 'utf8'),
  );
  trims.push({ lens, trim: report.masterTrimDb, rawPeak: report.rawPeakDbfs });
}
const shared = Math.min(...trims.map((t) => t.trim));
console.log(
  `\nshared master fader ${shared.toFixed(1)} dB — set by ` +
    `${trims.find((t) => t.trim === shared).lens} ` +
    `(per-lens would have been ${trims.map((t) => `${t.lens} ${t.trim.toFixed(1)}`).join(', ')})\n`,
);

fs.rmSync(scratch, { recursive: true, force: true });

console.log('pass 2 — printing the set\n');
for (const lens of lenses) {
  render(lens, [
    `--master-trim-db=${shared.toFixed(3)}`,
    '--mp3',
    `--out=docs/b0-${lens}-60s.wav`,
  ]);
  // The WAV is an intermediate: 10 MB a minute, gitignored, and reproducible.
  fs.rmSync(path.join(ROOT, `docs/b0-${lens}-60s.wav`), { force: true });
}

console.log(
  `\n${lenses.length} audition clips written to docs/b0-*-60s.mp3 ` +
    `(shared master fader ${shared.toFixed(1)} dB)`,
);
