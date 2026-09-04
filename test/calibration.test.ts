/**
 * Slice B3 — AN AUDITION MUST NOT REPUBLISH THE LIVE MIX.
 *
 * The defect, found in B2 and not ratified away: `render-score.mjs` wrote
 * `public/samples/calibration.json` at the end of every run. So printing a
 * 60-second audition clip — from `docs/a3-score.json`, at t=360 s, one lens at
 * a time, for a listen that is meant to be thrown away — silently re-levelled
 * the shipping app. The app plays a live tonight sky; the faders it would have
 * been given came from a birth score's densest minute. That is not a stale
 * number, it is a wrong one, and nothing in the build would have said so.
 *
 * The fix is that publication is an ACT, not a side effect: `writeCalibration`
 * has to be called, and `main()` only calls it under `--publish-calibration`.
 * `npm run calibrate` is the deliberate path.
 *
 * These tests do not render audio. They pin the decision — which is where the
 * defect lived — so they run in the unit suite, on every push, without ffmpeg.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CALIBRATION_FILE, parseArgs, writeCalibration } from '../scripts/render-score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** What `render-audition.mjs` builds its two passes out of, verbatim. */
const AUDITION_DEFAULTS = ['--from=360', '--seconds=60', '--section=birth', '--score=docs/a3-score.json'];

describe('AN AUDITION WRITES NOWHERE THE APP READS', () => {
  it('a render publishes nothing unless it is asked to', () => {
    expect(parseArgs([]).publishCalibration).toBe(false);
    expect(parseArgs(AUDITION_DEFAULTS).publishCalibration).toBe(false);
    // Pass 2 of the audition set, which is the run that prints the mp3s.
    expect(
      parseArgs([
        ...AUDITION_DEFAULTS,
        '--lens=embrace',
        '--json=docs/b0-embrace-render.json',
        '--master-trim-db=-9.070',
        '--mp3',
        '--out=docs/b0-embrace-60s.wav',
      ]).publishCalibration,
    ).toBe(false);
  });

  it('publishing is available, and has to be spelled out', () => {
    expect(parseArgs(['--publish-calibration']).publishCalibration).toBe(true);
    expect(parseArgs(['--publish-calibration=false']).publishCalibration).toBe(false);
  });

  it('the audition script never asks for it', () => {
    // A canary, not a proof: the audition passes its own argv straight through
    // to the renderer, so the one thing that could reintroduce the defect is
    // this file growing the flag. If it ever does, that has to be a deliberate
    // edit to a test that says why.
    const source = fs
      .readFileSync(path.join(ROOT, 'scripts', 'render-audition.mjs'), 'utf8')
      // Comments are where the file EXPLAINS that it never publishes, so they
      // are not evidence that it does.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source).not.toMatch(/--publish-calibration|publishCalibration/);
  });

  it('writeCalibration writes where it is told, and leaves the live file alone', () => {
    const before = fs.readFileSync(CALIBRATION_FILE);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stellune-calibration-'));
    const target = path.join(scratch, 'calibration.json');
    try {
      const written = writeCalibration(
        {
          lens: 'aurora',
          trims: { ground: 1, chord: 2, figuration: 3, lead: 4, weather: 5 },
          rawLufs: -12.5,
          rawPeakDbfs: 8.07,
          score: path.join(ROOT, 'docs', 'a3-score.json'),
          section: 'birth',
        },
        target,
      );
      expect(written).toBe(target);
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      expect(parsed.lenses.aurora.measuredLufs).toBe(-12.5);
      // Ruling 1: the live graph cannot compute a peak-safe trim from a loudness
      // number, so the peak travels with it.
      expect(parsed.lenses.aurora.measuredPeakDbfs).toBe(8.07);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    expect(fs.readFileSync(CALIBRATION_FILE).equals(before)).toBe(true);
  });
});
