/**
 * Slice B0 — the offline effects: a light delay and a light reverb, plus the
 * 38 Hz highpass the mix law mandates.
 *
 * "Light" is the operative word. The v2 render's lesson was that the space
 * should sit BEHIND the music, not swallow it, so these are modest: a single
 * ping-pong delay and a Schroeder-style reverb (four combs into two allpasses
 * per channel) with a darkened tail. Nothing here is trying to be a plugin —
 * it exists so the audition clips sound like a room rather than a dry stack.
 */

/** In-place 2nd-order Butterworth highpass. */
export function highpass(buf, sampleRate, cutoffHz) {
  const w = Math.tan((Math.PI * cutoffHz) / sampleRate);
  const norm = 1 / (1 + Math.SQRT2 * w + w * w);
  const b0 = norm;
  const b1 = -2 * norm;
  const b2 = norm;
  const a1 = 2 * (w * w - 1) * norm;
  const a2 = (1 - Math.SQRT2 * w + w * w) * norm;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    buf[i] = y0;
  }
}

/** In-place one-pole lowpass — used to darken the reverb tail. */
function lowpassInPlace(buf, sampleRate, cutoffHz) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let z = 0;
  for (let i = 0; i < buf.length; i++) {
    z = z * a + buf[i] * (1 - a);
    buf[i] = z;
  }
}

function comb(input, out, delayFrames, feedback, damping) {
  const buffer = new Float32Array(delayFrames);
  let idx = 0;
  let store = 0;
  for (let i = 0; i < input.length; i++) {
    const y = buffer[idx];
    store = y * (1 - damping) + store * damping;
    buffer[idx] = input[i] + store * feedback;
    idx = idx + 1 === delayFrames ? 0 : idx + 1;
    out[i] += y;
  }
}

function allpass(buf, delayFrames, feedback) {
  const buffer = new Float32Array(delayFrames);
  let idx = 0;
  for (let i = 0; i < buf.length; i++) {
    const bufout = buffer[idx];
    const y = -buf[i] + bufout;
    buffer[idx] = buf[i] + bufout * feedback;
    idx = idx + 1 === delayFrames ? 0 : idx + 1;
    buf[i] = y;
  }
}

const COMB_MS = [29.7, 37.1, 41.1, 43.7];
const ALLPASS_MS = [5.0, 1.7];

/** Reverb one channel; returns the wet signal (the caller mixes it in). */
export function reverbChannel(input, sampleRate, { decay = 0.84, dampHz = 2600, spread = 0 } = {}) {
  const wet = new Float32Array(input.length);
  for (const ms of COMB_MS) {
    const frames = Math.max(1, Math.round(((ms + spread) / 1000) * sampleRate));
    comb(input, wet, frames, decay, 0.35);
  }
  for (let i = 0; i < wet.length; i++) wet[i] *= 0.25;
  for (const ms of ALLPASS_MS) {
    allpass(wet, Math.max(1, Math.round(((ms + spread * 0.4) / 1000) * sampleRate)), 0.5);
  }
  // Dark tail: the v2 lesson. A bright reverb on a star field sounds like glare.
  lowpassInPlace(wet, sampleRate, dampHz);
  return wet;
}

/**
 * Ping-pong delay across a stereo pair. Returns the wet pair; the caller mixes.
 * Feedback is kept low — this is an echo of the sky, not a dub effect.
 */
export function pingPongDelay(left, right, sampleRate, { timeSeconds = 0.42, feedback = 0.3 } = {}) {
  const d = Math.max(1, Math.round(timeSeconds * sampleRate));
  const wetL = new Float32Array(left.length);
  const wetR = new Float32Array(right.length);
  for (let i = 0; i < left.length; i++) {
    const srcL = i >= d ? left[i - d] + wetR[i - d] * feedback : 0;
    const srcR = i >= d ? right[i - d] + wetL[i - d] * feedback : 0;
    // Cross-fed: the left tap answers on the right and vice versa.
    wetL[i] = srcR;
    wetR[i] = srcL;
  }
  return [wetL, wetR];
}

/**
 * Look-ahead peak limiter on the stereo master.
 *
 * The mix law sets stem levels by RMS, and sparse roles (a lead phrase that
 * sounds a fifth of the time) legitimately carry a large crest factor once
 * their RMS is brought up to target. Summed, those peaks can exceed full scale
 * even though every stem is exactly on its number. Rather than pull the whole
 * master down — which would break the law's absolute targets — we catch the
 * peaks and report how much was caught, so heavy limiting is visible rather
 * than silently baked in.
 *
 * Returns `{maxDb, busyFraction}`. The max is a single worst transient and says
 * little on its own; `busyFraction` — how much of the render is being held down
 * by more than 1 dB — is the number that tells you whether the limiter is
 * catching peaks or squashing the music.
 */
export function limitStereo(left, right, sampleRate, ceilingDbfs = -1.0) {
  const ceiling = 10 ** (ceilingDbfs / 20);
  const look = Math.max(1, Math.round(0.005 * sampleRate));
  const release = Math.exp(-1 / (0.25 * sampleRate));
  const n = left.length;

  // Sliding max of |x| over the look-ahead window, via a monotonic deque.
  const target = new Float32Array(n);
  const deque = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const amp = (i) => Math.max(Math.abs(left[i]), Math.abs(right[i]));
  for (let i = 0; i < n; i++) {
    while (tail > head && amp(deque[tail - 1]) <= amp(i)) tail--;
    deque[tail++] = i;
    const from = i - look + 1;
    while (deque[head] < from) head++;
    const at = i - look + 1;
    if (at >= 0) target[at] = amp(deque[head]);
  }
  for (let i = Math.max(0, n - look); i < n; i++) target[i] = amp(i);

  let gain = 1;
  let maxReduction = 0;
  let busy = 0;
  const busyThreshold = 10 ** (-1 / 20); // 1 dB down
  for (let i = 0; i < n; i++) {
    const wanted = target[i] > ceiling ? ceiling / target[i] : 1;
    // Instant attack (the look-ahead is what makes it inaudible), slow release.
    gain = wanted < gain ? wanted : wanted + (gain - wanted) * release;
    left[i] *= gain;
    right[i] *= gain;
    const reduction = -20 * Math.log10(gain);
    if (reduction > maxReduction) maxReduction = reduction;
    if (gain < busyThreshold) busy++;
  }
  return { maxDb: maxReduction, busyFraction: n > 0 ? busy / n : 0 };
}

/** Equal-power stereo pan. `pan` is −1 … +1. */
export function panGains(pan) {
  const p = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(p), Math.sin(p)];
}
