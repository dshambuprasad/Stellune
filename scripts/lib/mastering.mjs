/**
 * Slice B1 — THE MASTERING LAW, as executable numbers.
 *
 * The mix law levels the stems. It does not stop them occupying the same
 * spectrum, and a musician's review of the B0 clips found exactly that: every
 * role on its target, and the result still muddy, because five roles were
 * piled into the same 200–800 Hz band where the ear cannot separate them.
 *
 * So this module implements the second half of the mix:
 *
 *   EQ LANES        per role, per lens. The pads are CARVED where the moving
 *                   parts live, rather than the moving parts being pushed
 *                   louder. A −5 dB notch in the chord bed at 2 kHz costs the
 *                   pad almost nothing — its energy is an octave lower — and
 *                   hands the figuration a window it no longer has to shout
 *                   through.
 *
 *   GLUE            on figuration ONLY, slow and shallow. The macro arc IS the
 *                   composition; Slice A4 spent itself shaping how the night
 *                   swells, so compressing the master would undo the work.
 *
 *   LUFS            the master is normalised to integrated loudness, not to
 *                   peak. Peak normalisation rewards crest factor: a sparse
 *                   early sky and a full late one can share a peak and differ
 *                   by several dB of perceived level, which for a piece meant
 *                   to hold a steady calm is the wrong thing to hold constant.
 *
 * The filters are the RBJ cookbook biquads — the same design the Web Audio
 * `BiquadFilterNode` implements — so the live graph and this renderer apply the
 * same curve from the same numbers, not merely a similar one.
 *
 * Plain ESM, no Tone, no Web Audio, no filesystem.
 */

const TAU = Math.PI * 2;

/**
 * One RBJ biquad, applied in place.
 *
 * `type` is 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf',
 * matching the Web Audio names so a lane reads the same on both sides.
 */
export function biquad(buf, sampleRate, { type, freq, q = 0.707, gainDb = 0 }) {
  const w0 = (TAU * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** (gainDb / 40);
  const alpha = sin / (2 * q);

  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
    default:
      throw new Error(`unknown filter type "${type}"`);
  }

  const B0 = b0 / a0;
  const B1 = b1 / a0;
  const B2 = b2 / a0;
  const A1 = a1 / a0;
  const A2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = B0 * x0 + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    buf[i] = y0;
  }
  return buf;
}

/**
 * Apply one role's EQ lane to a stereo stem, in place.
 *
 * Order matters and matches the live graph exactly: highpass, low shelf, dip,
 * high shelf. Filters are not commutative in the presence of clipping and the
 * stems here are nowhere near it, but keeping the order identical means the two
 * paths cannot drift for a reason nobody can find later.
 */
export function applyEqLane([left, right], sampleRate, lane) {
  if (!lane) return;
  for (const channel of [left, right]) {
    if (lane.highpassHz) {
      biquad(channel, sampleRate, { type: 'highpass', freq: lane.highpassHz, q: 0.707 });
    }
    if (lane.lowShelf) {
      biquad(channel, sampleRate, {
        type: 'lowshelf',
        freq: lane.lowShelf.hz,
        gainDb: lane.lowShelf.db,
      });
    }
    if (lane.dip) {
      biquad(channel, sampleRate, {
        type: 'peaking',
        freq: lane.dip.hz,
        q: lane.dip.q ?? 0.8,
        gainDb: lane.dip.db,
      });
    }
    if (lane.highShelf) {
      biquad(channel, sampleRate, {
        type: 'highshelf',
        freq: lane.highShelf.hz,
        gainDb: lane.highShelf.db,
      });
    }
  }
}

/**
 * Glue compression — slow, shallow, and reported.
 *
 * Deliberately a soft-knee peak compressor with a long attack, which is to say
 * it barely does anything to a transient and instead leans on sustained level.
 * That is what "glue" means here: it should stop one chime standing out of its
 * own layer, and it should be inaudible on everything else.
 *
 * THE ≤2 dB BOUND IS ENFORCED, NOT HOPED FOR. Reduction is clamped at
 * `maxReductionDb`, which makes the device structurally incapable of squashing
 * whatever it is handed. This is not belt-and-braces: the first attempt used a
 * threshold and ratio chosen to "usually" stay under 2 dB and, once the stem
 * was correctly trimmed onto the mix law's target, reached 7.4 dB. Settings
 * that satisfy a law at one level do not satisfy it at another; a clamp does.
 *
 * Returns the worst reduction actually applied, in dB.
 */
export function glueCompress([left, right], sampleRate, config) {
  const { thresholdDb, ratio, attackSeconds, releaseSeconds, kneeDb, maxReductionDb } = config;
  const ceiling = maxReductionDb ?? Infinity;
  const attack = Math.exp(-1 / (attackSeconds * sampleRate));
  const release = Math.exp(-1 / (releaseSeconds * sampleRate));
  let envelope = 0;
  let worstDb = 0;

  for (let i = 0; i < left.length; i++) {
    const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    envelope = level > envelope ? level + (envelope - level) * attack : level + (envelope - level) * release;

    const db = envelope > 0 ? 20 * Math.log10(envelope) : -120;
    const over = db - thresholdDb;

    // Soft knee: the ratio comes in gradually across `kneeDb`, so the onset of
    // compression is not itself an audible event.
    let reductionDb = 0;
    if (over >= kneeDb / 2) {
      reductionDb = over - over / ratio;
    } else if (over > -kneeDb / 2) {
      const x = over + kneeDb / 2;
      reductionDb = ((1 - 1 / ratio) * x * x) / (2 * kneeDb);
    }
    if (reductionDb > ceiling) reductionDb = ceiling;
    if (reductionDb > worstDb) worstDb = reductionDb;

    if (reductionDb > 0) {
      const g = 10 ** (-reductionDb / 20);
      left[i] *= g;
      right[i] *= g;
    }
  }
  return worstDb;
}

/**
 * Transient limiting, per stem — THE RATIFIED AMENDMENT (2026-08-10).
 *
 * The original law forbade the limiter from engaging at all. Measured, that and
 * the −18 LUFS target could not both be met: figuration's crest factor after
 * RMS matching is about 29 dB, so peak-guarding alone left lenses up to 8.9 dB
 * under target. HQ's read, ratified by Shambu: the 0% rule was written to
 * protect the SUSTAINED bed's breathing, not to forbid transient control.
 *
 * So the limiter moved off the master and onto the stems that actually carry
 * transients. The bed's zero engagement is then structural rather than
 * asserted-and-hoped: ground and chord have no limiter to engage.
 *
 * Look-ahead, because a limiter that reacts after the peak has passed is a
 * distortion unit. Returns what it did, so the ≤3 dB and ≤1% bounds are checked
 * against measurement and not against settings.
 */
export function limitTransients([left, right], sampleRate, config) {
  const ceiling = 10 ** (config.ceilingDbfs / 20);
  const maxReduction = 10 ** (-(config.maxReductionDb ?? 3) / 20);
  const lookahead = Math.max(1, Math.round(0.005 * sampleRate));
  // 50 ms, not 150. On struck figuration a 150 ms release means the limiter is
  // still recovering when the next chime lands, so it reads as "engaged" a
  // quarter of the time while actually reducing on only a fraction of that —
  // and the law's ≤1% is a statement about how often it WORKS, not about how
  // long it takes to let go. 50 ms is still slow enough to be inaudible on
  // percussive material and fast enough that the measurement means what it says.
  const release = Math.exp(-1 / ((config.releaseSeconds ?? 0.05) * sampleRate));

  // The gain each sample needs, on its own.
  const need = new Float32Array(left.length).fill(1);
  for (let i = 0; i < left.length; i++) {
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (peak > ceiling) need[i] = Math.max(maxReduction, ceiling / peak);
  }

  // The minimum over the NEXT `lookahead` samples, so the gain is already down
  // when the transient arrives.
  //
  // A sliding-window minimum, via a monotonic deque. The obvious loop —
  // "gain[i] = min(gain[i], gain[i + lookahead])" — was written first and is
  // wrong: each step reads a value that has already absorbed the one beyond it,
  // so a single loud sample propagates its gain all the way back to the start
  // of the buffer. Measured, that pinned the limiter at its maximum reduction
  // for 99.8% of the render, which is not a limiter, it is a fader.
  const window = new Float32Array(left.length);
  const deque = new Int32Array(left.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < left.length; i++) {
    const bound = Math.min(left.length - 1, i + lookahead);
    // Extend the window to cover [i, i+lookahead].
    for (let k = i === 0 ? 0 : Math.min(left.length - 1, i - 1 + lookahead + 1); k <= bound; k++) {
      while (tail > head && need[deque[tail - 1]] >= need[k]) tail--;
      deque[tail++] = k;
    }
    while (deque[head] < i) head++;
    window[i] = need[deque[head]];
  }
  let smoothed = 1;
  let worstDb = 0;
  let engaged = 0;
  for (let i = 0; i < left.length; i++) {
    const wanted = window[i];
    smoothed = wanted < smoothed ? wanted : wanted + (smoothed - wanted) * release;
    left[i] *= smoothed;
    right[i] *= smoothed;
    const db = -20 * Math.log10(smoothed);
    if (db > worstDb) worstDb = db;
    if (db > (config.engagementThresholdDb ?? 0.1)) engaged++;
  }
  return { worstDb, engagedFraction: engaged / Math.max(1, left.length) };
}

// ---------------------------------------------------------------------------
// Integrated loudness — ITU-R BS.1770-4
// ---------------------------------------------------------------------------

/**
 * The K-weighting pre-filter: a high-shelf approximating the head's response,
 * then a highpass. Coefficients from BS.1770-4 Tables 1 and 2, which are
 * specified at 48 kHz; they are re-derived here for the render rate so a
 * 44.1 kHz measurement is not quietly a few tenths off.
 */
function kWeight(channel, sampleRate) {
  const out = Float32Array.from(channel);
  // Stage 1 — high shelf, +4 dB above ~1.5 kHz.
  biquad(out, sampleRate, { type: 'highshelf', freq: 1681.97, q: 0.7071, gainDb: 3.999 });
  // Stage 2 — highpass at ~38 Hz, the RLB curve.
  biquad(out, sampleRate, { type: 'highpass', freq: 38.13, q: 0.5003 });
  return out;
}

/**
 * Integrated loudness of a stereo programme, in LUFS.
 *
 * 400 ms blocks at 75% overlap, an absolute gate at −70 LUFS and a relative
 * gate 10 LU below the ungated mean — the standard's two-stage gate, which is
 * the whole reason this is not simply an RMS reading. Silence between phrases
 * is part of the piece; it should not drag the measured loudness down and make
 * the normaliser turn a calm mix up.
 */
export function integratedLufs([left, right], sampleRate) {
  const l = kWeight(left, sampleRate);
  const r = kWeight(right, sampleRate);

  const blockFrames = Math.round(0.4 * sampleRate);
  const hopFrames = Math.round(blockFrames / 4);
  if (l.length < blockFrames) return -Infinity;

  const loudness = [];
  for (let start = 0; start + blockFrames <= l.length; start += hopFrames) {
    let sum = 0;
    for (let i = start; i < start + blockFrames; i++) sum += l[i] * l[i] + r[i] * r[i];
    const mean = sum / blockFrames;
    loudness.push(mean > 0 ? -0.691 + 10 * Math.log10(mean) : -Infinity);
  }
  if (loudness.length === 0) return -Infinity;

  const meanOf = (blocks) => {
    let sum = 0;
    let n = 0;
    for (const db of blocks) {
      if (!Number.isFinite(db)) continue;
      sum += 10 ** ((db + 0.691) / 10);
      n++;
    }
    return n === 0 ? -Infinity : -0.691 + 10 * Math.log10(sum / n);
  };

  const absolute = loudness.filter((db) => db > -70);
  if (absolute.length === 0) return -Infinity;
  const relativeGate = meanOf(absolute) - 10;
  const gated = absolute.filter((db) => db > relativeGate);
  return meanOf(gated.length > 0 ? gated : absolute);
}

/** The fader move that puts a measured programme on its LUFS target. */
export function lufsTrimDb(targetLufs, measuredLufs) {
  return Number.isFinite(measuredLufs) ? targetLufs - measuredLufs : 0;
}

// ---------------------------------------------------------------------------
// Spectral separation — what the EQ lanes are FOR
// ---------------------------------------------------------------------------

/**
 * RMS level of one band of a stereo stem, in dBFS.
 *
 * Four cascaded biquads per edge — steep enough that the answer is about the
 * band and not about the skirts. Used to assert the claim the lanes actually
 * make: that the pads do not sit in the motion band.
 */
export function bandLevelDb([left, right], sampleRate, [lowHz, highHz]) {
  let sum = 0;
  let n = 0;
  for (const channel of [left, right]) {
    const band = Float32Array.from(channel);
    for (let i = 0; i < 2; i++) {
      biquad(band, sampleRate, { type: 'highpass', freq: lowHz, q: 0.707 });
      biquad(band, sampleRate, { type: 'lowpass', freq: Math.min(highHz, sampleRate / 2 - 100), q: 0.707 });
    }
    // Skip the edges: the filters ring at the start of a buffer.
    const from = Math.floor(band.length * 0.1);
    const to = Math.ceil(band.length * 0.9);
    for (let i = from; i < to; i++) sum += band[i] * band[i];
    n += to - from;
  }
  if (n === 0) return -Infinity;
  const rms = Math.sqrt(sum / n);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/**
 * How much of a pad's own energy sits in the band where the motion lives.
 *
 * Expressed relative to the pad's total level, so it is a statement about the
 * SHAPE of the pad and not about how loud it happens to be — which is what
 * makes it an EQ assertion rather than a restatement of the mix law.
 */
export function motionBandOccupancyDb(stem, sampleRate, motionBandHz) {
  const inBand = bandLevelDb(stem, sampleRate, motionBandHz);
  const total = bandLevelDb(stem, sampleRate, [20, sampleRate / 2 - 100]);
  if (!Number.isFinite(inBand) || !Number.isFinite(total)) return -Infinity;
  return inBand - total;
}
