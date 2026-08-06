#!/usr/bin/env node
/**
 * Slice B0 — acquire, verify, trim and encode the bundled instrument samples.
 *
 *   node scripts/fetch-samples.mjs            # fetch anything missing, encode all
 *   node scripts/fetch-samples.mjs --only=kalimba,flute
 *   node scripts/fetch-samples.mjs --report   # print the licence/hash table only
 *
 * Reads `scripts/samples.manifest.mjs` (the pinned, licence-checked source of
 * truth), downloads each upstream file into `scripts/.cache/` (gitignored,
 * multi-GB packs never enter the repo), records its SHA-256, then writes lean
 * mono ogg+mp3 note-sets into `public/samples/` plus the runtime index
 * `public/samples/manifest.json`.
 *
 * The evidence this emits — source URL, pinned version, licence, SHA-256,
 * access date — is what `docs/ATTRIBUTION_AUDIO.md` is built from.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

import { PACKS, INSTRUMENTS, ENCODE, noteToMidi, midiToNote } from './samples.manifest.mjs';
import {
  FFMPEG,
  requireFfmpeg,
  decodeMono,
  findOnset,
  peak,
  detectFundamental,
  detectStrikeTone,
  hzToMidi,
  rmsDbfs,
  sha256File,
} from './lib/audio.mjs';

/**
 * Loudness reference for cross-instrument matching, dBFS RMS measured over the
 * first half second of each note.
 *
 * Peak-normalising is not enough: a bowed violin and a struck kalimba can share
 * a peak and differ by 10 dB in how loud they sound, and a role that falls back
 * from one instrument to another mid-render then lurches in level. (Measured:
 * that lurch is what put the Ground lens's figuration stem 8.9 dB off target in
 * one window and had the limiter working 18% of the time.) So each instrument
 * also carries a `levelDb` that brings its median first-half-second RMS to this
 * reference — per instrument, not per note, so a glockenspiel's top octave is
 * still allowed to be naturally quieter than its bottom.
 */
const LOUDNESS_REFERENCE_DBFS = -20;
const LOUDNESS_WINDOW_SECONDS = 0.5;

/** How far a 'sustained' instrument's loop region may sit below its attack. */
const MAX_SUSTAIN_DROP_DB = 12;

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE = path.join(HERE, '.cache', 'samples-src');
const OUT = path.join(ROOT, 'public', 'samples');

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const reportOnly = args.includes('--report');
const ACCESS_DATE = process.env.ACCESS_DATE ?? new Date().toISOString().slice(0, 10);

/** Download to `dest` unless it is already there. Returns {bytes, cached}. */
async function fetchTo(url, dest) {
  if (fs.existsSync(dest)) return { bytes: fs.statSync(dest).size, cached: true };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return { bytes: buf.length, cached: false };
}

/**
 * Salamander ships as one tar.xz. Verify the archive hash against the manifest
 * (a mismatch means the distribution changed under us) and extract only the
 * note files we actually bundle.
 */
function ensureSalamander(needed) {
  const pack = PACKS.salamander;
  const archive = path.join(CACHE, 'salamander', path.basename(new URL(pack.archive).pathname));
  if (!fs.existsSync(archive)) {
    throw new Error(
      `Salamander archive missing. Download it first:\n` +
        `  mkdir -p ${path.dirname(archive)}\n` +
        `  curl -L -o "${archive}" "${pack.archive}"`,
    );
  }
  const got = sha256File(archive);
  if (got !== pack.archiveSha256) {
    throw new Error(
      `Salamander archive SHA-256 mismatch.\n  expected ${pack.archiveSha256}\n  got      ${got}`,
    );
  }
  const dir = path.join(CACHE, 'salamander', 'extracted');
  const missing = needed.filter((n) => !fs.existsSync(path.join(dir, n)));
  if (missing.length) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync(
      'tar',
      ['-xJf', archive, '-C', dir, '--strip-components=2', ...missing.map((n) => pack.archivePrefix + n)],
      { stdio: 'inherit' },
    );
  }
  return { dir, archive, archiveSha256: got };
}

/** Resolve every (instrument, note) to a local source file + its provenance. */
async function acquire(inst) {
  const pack = PACKS[inst.pack];
  const entries = [];

  if (inst.pack === 'salamander') {
    const names = Object.values(inst.notes);
    const { dir, archive } = ensureSalamander(names);
    for (const [note, file] of Object.entries(inst.notes)) {
      const src = path.join(dir, file);
      if (!fs.existsSync(src)) throw new Error(`missing from archive: ${file}`);
      entries.push({ note, src, sourceUrl: pack.archive, sourcePath: pack.archivePrefix + file });
    }
    return { entries, archive };
  }

  if (inst.pack === 'freesound') {
    for (const s of inst.sounds) {
      const dest = path.join(CACHE, 'freesound', path.basename(new URL(s.url).pathname));
      await fetchTo(s.url, dest);
      entries.push({
        note: s.note,
        src: dest,
        sourceUrl: s.url,
        soundUrl: s.soundUrl,
        author: s.author,
        title: s.title,
        licence: s.licence,
        detectPitch: s.detectPitch,
      });
    }
    return { entries };
  }

  for (const [note, file] of Object.entries(inst.notes)) {
    const rel = inst.dir + file;
    const dest = path.join(CACHE, inst.pack, rel);
    const url = pack.raw(rel.split('/').map(encodeURIComponent).join('/'));
    await fetchTo(url, dest);
    entries.push({ note, src: dest, sourceUrl: url, sourcePath: rel });
  }
  return { entries };
}

/**
 * Trim one source note to a lean, loop-ready, peak-normalised clip and encode
 * it to ogg + mp3. Returns the runtime manifest row.
 */
async function processNote(inst, entry) {
  const sr = ENCODE.sampleRate;
  const pcm = await decodeMono(entry.src, sr);

  // Start at the true onset (upstream files carry varying pre-roll), backing
  // off a hair so the attack transient survives intact.
  const onset = Math.max(0, findOnset(pcm) - Math.round(sr * 0.005));
  const wanted = Math.round(inst.trimSeconds * sr);
  const end = Math.min(pcm.length, onset + wanted);
  const clip = Float32Array.prototype.slice.call(pcm, onset, end);

  // Peak-normalise so per-role gains in the MIX LAW mean the same thing for
  // every instrument, whatever the upstream recording level was.
  const p = peak(clip);
  const target = 10 ** (ENCODE.peakDbfs / 20);
  const gain = p > 0 ? target / p : 1;
  for (let i = 0; i < clip.length; i++) clip[i] *= gain;

  // Fade the tail so a truncated sustain does not click.
  const fade = Math.min(clip.length, Math.round(ENCODE.fadeOutSeconds * sr));
  for (let i = 0; i < fade; i++) {
    clip[clip.length - fade + i] *= 1 - i / fade;
  }

  // Pitch: either the upstream name, or measured where the name is not a pitch.
  // Harmonic sources get autocorrelation; inharmonic ones get the strike tone.
  let midi;
  let measuredHz = null;
  const detect = inst.detectPitch ?? entry.detectPitch;
  if (detect) {
    const band = inst.pitchBand ?? [200, 2100];
    const hz =
      detect === 'strike'
        ? detectStrikeTone(clip, sr, band[0], band[1])
        : detectFundamental(clip, sr);
    if (hz == null) throw new Error(`could not detect pitch for ${inst.id}/${entry.note}`);
    measuredHz = hz;
    midi = Math.round(hzToMidi(hz));
  } else {
    midi = noteToMidi(entry.note);
  }
  const note = midiToNote(midi);

  const dir = path.join(OUT, inst.id);
  fs.mkdirSync(dir, { recursive: true });
  const base = note.replace('#', 's');
  const raw = path.join(dir, `${base}.raw`);
  fs.writeFileSync(raw, Buffer.from(clip.buffer, clip.byteOffset, clip.byteLength));

  const inputArgs = ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(sr), '-ac', '1', '-i', raw];
  await execFileAsync(FFMPEG, [...inputArgs, ...ENCODE.ogg, path.join(dir, `${base}.ogg`)]);
  await execFileAsync(FFMPEG, [...inputArgs, ...ENCODE.mp3, path.join(dir, `${base}.mp3`)]);
  fs.unlinkSync(raw);

  const impactDbfs = rmsDbfs(clip, 0, Math.min(clip.length, Math.round(LOUDNESS_WINDOW_SECONDS * sr)));

  // A 'sustained' instrument has to actually sustain: the sampler loops its
  // loop region to hold a chord voice for ten minutes, so if the tone has
  // already decayed by the time the loop starts, it loops near-silence and the
  // chord bed quietly collapses. (Measured: the TX81Z Clavisynth, auditioned as
  // the Pulse pad, drops 50 dB across 3 seconds — it is a plucked sound wearing
  // a pad's name.) Fail loudly at build time rather than mysteriously at mix time.
  if (inst.kind === 'sustained' && inst.loop) {
    const loopFrom = Math.round(inst.loop.start * sr);
    const loopTo = Math.min(clip.length, Math.round(inst.loop.end * sr));
    const loopDbfs = rmsDbfs(clip, loopFrom, loopTo);
    const drop = impactDbfs - loopDbfs;
    if (drop > MAX_SUSTAIN_DROP_DB) {
      throw new Error(
        `${inst.id}/${entry.note}: declared 'sustained' but the loop region is ` +
          `${drop.toFixed(1)} dB below the attack (max ${MAX_SUSTAIN_DROP_DB}). ` +
          `This sound decays — classify it 'decay', or move the loop earlier.`,
      );
    }
  }

  return {
    row: {
      note,
      midi,
      ogg: `${inst.id}/${base}.ogg`,
      mp3: `${inst.id}/${base}.mp3`,
      seconds: +(clip.length / sr).toFixed(3),
      impactDbfs: +impactDbfs.toFixed(2),
      ...(measuredHz ? { measuredHz: +measuredHz.toFixed(2) } : {}),
    },
    provenance: {
      instrument: inst.id,
      note,
      sourceUrl: entry.soundUrl ?? entry.sourceUrl,
      downloadUrl: entry.sourceUrl,
      sourcePath: entry.sourcePath ?? null,
      sha256: sha256File(entry.src),
      bytes: fs.statSync(entry.src).size,
      author: entry.author ?? null,
      title: entry.title ?? null,
      licence: entry.licence ?? PACKS[inst.pack].licence,
      ...(measuredHz ? { measuredHz: +measuredHz.toFixed(2), labelledAs: entry.note } : {}),
    },
    encodedBytes:
      fs.statSync(path.join(dir, `${base}.ogg`)).size +
      fs.statSync(path.join(dir, `${base}.mp3`)).size,
    oggBytes: fs.statSync(path.join(dir, `${base}.ogg`)).size,
  };
}

async function main() {
  requireFfmpeg();
  const chosen = INSTRUMENTS.filter((i) => !only || only.includes(i.id));
  if (!chosen.length) throw new Error(`no instruments matched --only=${only}`);

  const manifest = {
    generatedBy: 'scripts/fetch-samples.mjs',
    accessDate: ACCESS_DATE,
    encode: {
      sampleRate: ENCODE.sampleRate,
      channels: ENCODE.channels,
      peakDbfs: ENCODE.peakDbfs,
      ogg: `ffmpeg ${ENCODE.ogg.join(' ')}`,
      mp3: `ffmpeg ${ENCODE.mp3.join(' ')}`,
    },
    packs: Object.fromEntries(
      Object.entries(PACKS).map(([k, p]) => [
        k,
        {
          title: p.title,
          author: p.author,
          licence: p.licence,
          licenceUrl: p.licenceUrl,
          homepage: p.homepage,
          version: p.version,
          ...(p.archiveSha256 ? { archive: p.archive, archiveSha256: p.archiveSha256 } : {}),
          ...(p.credit ? { credit: p.credit } : {}),
        },
      ]),
    ),
    instruments: {},
  };
  const provenance = [];

  for (const inst of chosen) {
    process.stdout.write(`· ${inst.id} … `);
    // Clear first: a re-detected pitch renames the output, and a stale file
    // from the previous naming would linger in the bundle forever.
    fs.rmSync(path.join(OUT, inst.id), { recursive: true, force: true });
    const { entries } = await acquire(inst);
    const rows = [];
    let bytes = 0;
    let oggBytes = 0;
    for (const entry of entries) {
      const r = await processNote(inst, entry);
      rows.push(r.row);
      provenance.push(r.provenance);
      bytes += r.encodedBytes;
      oggBytes += r.oggBytes;
    }
    rows.sort((a, b) => a.midi - b.midi);
    const impacts = rows.map((r) => r.impactDbfs).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const median = impacts.length
      ? impacts[Math.floor(impacts.length / 2)]
      : LOUDNESS_REFERENCE_DBFS;
    const levelDb = +(LOUDNESS_REFERENCE_DBFS - median).toFixed(2);
    manifest.instruments[inst.id] = {
      title: inst.title,
      pack: inst.pack,
      licence: PACKS[inst.pack].licence,
      kind: inst.kind,
      attackSeconds: inst.attackSeconds,
      loop: inst.loop,
      /** Brings this instrument's median first-half-second RMS to the reference. */
      levelDb,
      medianImpactDbfs: median,
      oggBytes,
      samples: rows,
    };
    console.log(
      `${rows.length} notes, ${(oggBytes / 1024).toFixed(0)} kB ogg, ` +
        `level ${levelDb >= 0 ? '+' : ''}${levelDb.toFixed(1)} dB`,
    );
  }

  // Merge rather than clobber, so `--only=` re-encodes one instrument without
  // dropping the rest from the runtime index.
  const manifestPath = path.join(OUT, 'manifest.json');
  if (only && fs.existsSync(manifestPath)) {
    const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.instruments = { ...prev.instruments, ...manifest.instruments };
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const provPath = path.join(HERE, '.cache', 'samples-provenance.json');
  const prevProv =
    only && fs.existsSync(provPath) ? JSON.parse(fs.readFileSync(provPath, 'utf8')) : [];
  const keep = prevProv.filter((p) => !chosen.some((c) => c.id === p.instrument));
  fs.writeFileSync(
    provPath,
    `${JSON.stringify([...keep, ...provenance].sort((a, b) =>
      a.instrument === b.instrument ? a.note.localeCompare(b.note) : a.instrument.localeCompare(b.instrument),
    ), null, 2)}\n`,
  );

  const totalOgg = Object.values(manifest.instruments).reduce((s, i) => s + i.oggBytes, 0);
  console.log(`\nwrote ${manifestPath}`);
  console.log(`total ogg payload: ${(totalOgg / 1024 / 1024).toFixed(2)} MB`);
  console.log(`provenance: ${provPath} (${provenance.length} rows)`);
}

if (reportOnly) {
  const provPath = path.join(HERE, '.cache', 'samples-provenance.json');
  const rows = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  for (const r of rows) console.log(`${r.instrument}\t${r.note}\t${r.licence}\t${r.sha256}`);
} else {
  main().catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
