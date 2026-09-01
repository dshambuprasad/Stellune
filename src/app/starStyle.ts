/**
 * Phase 4 — how a star looks: colour from its real B–V, size from its real
 * magnitude, and the pre-rendered sprites that make 4,000 of them cheap.
 *
 * THE TRUTH COVENANT APPLIES TO COLOUR. A star's tint here is not a palette
 * choice — it is its catalogue B–V index run through the standard physics:
 * B–V → effective temperature (Ballesteros 2012) → Planckian locus → sRGB. Blue
 * stars are blue because they are hot. What IS an artistic choice, and is
 * labelled as one, is the *saturation*: real starlight is close to white to the
 * naked eye, and rendering the raw chromaticity looks like a toy. We keep the
 * true hue and pull the saturation back to something the eye reads as a star.
 *
 * Size is honest in ORDER but not in ratio: apparent brightness spans a factor
 * of ~1,600 between Sirius and the naked-eye limit, and no screen can show that
 * as area. The mapping below is monotonic in magnitude — brighter always looks
 * bigger — on a perceptual curve.
 */

import type { Star } from '../engine/index.ts';

/** Faintest magnitude the bundled catalogue carries (naked-eye limit). */
export const MAG_LIMIT = 6.6;
/** Brightest, a shade under Sirius at −1.44. */
export const MAG_BRIGHTEST = -1.6;

/** B–V range we bucket over. Beyond this, stars clamp to the end bins. */
const BV_MIN = -0.4;
const BV_MAX = 2.0;
const BV_BINS = 24;

/**
 * How far the true chromaticity is pulled toward white. 0 = white, 1 = raw.
 *
 * The hue is physics; this number is taste, and it is the one number on this
 * screen that is. Raw Planckian colour makes a starfield look like confetti;
 * pure white throws away a real property of every star in the catalogue. At
 * 0.68 the difference between Betelgeuse and Rigel is plainly visible without
 * the sky looking painted.
 */
const SATURATION = 0.68;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * B–V colour index → effective temperature in kelvin (Ballesteros 2012).
 *
 * Valid across the main sequence; clamped at both ends so a catalogue outlier
 * cannot produce a nonsense temperature.
 */
export function bvToKelvin(bv: number): number {
  const x = Math.min(BV_MAX, Math.max(BV_MIN, bv));
  const t = 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
  return Math.min(40000, Math.max(1500, t));
}

/**
 * Colour temperature → CIE 1931 xy chromaticity, on the Planckian locus
 * (Kim et al. 2002 cubic approximation, 1667 K – 25000 K).
 */
export function kelvinToXy(kelvin: number): { x: number; y: number } {
  const t = Math.min(25000, Math.max(1667, kelvin));
  const t2 = t * t;
  const t3 = t2 * t;

  const x =
    t <= 4000
      ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.179910
      : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.240390;

  const x2 = x * x;
  const x3 = x2 * x;

  let y: number;
  if (t <= 2222) {
    y = -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683;
  } else if (t <= 4000) {
    y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
  } else {
    y = 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  }
  return { x, y };
}

/** CIE xy → gamma-encoded sRGB, normalised so the brightest channel is 1. */
export function xyToRgb(x: number, y: number): Rgb {
  // xyY with Y = 1.
  const yy = y === 0 ? 1e-6 : y;
  const X = x / yy;
  const Y = 1;
  const Z = (1 - x - y) / yy;

  // sRGB D65 matrix.
  let r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  let g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  let b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;

  // Chromaticities outside the sRGB gamut go slightly negative; clip, then
  // normalise, so the hue survives and only the impossible part is lost.
  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);
  const peak = Math.max(r, g, b, 1e-6);
  r /= peak;
  g /= peak;
  b /= peak;

  const encode = (v: number): number =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

  return { r: encode(r), g: encode(g), b: encode(b) };
}

/** The full chain, plus the desaturation that keeps a star looking like a star. */
export function bvToRgb(bv: number, saturation = SATURATION): Rgb {
  const { x, y } = kelvinToXy(bvToKelvin(bv));
  const raw = xyToRgb(x, y);
  const mix = (v: number): number => Math.min(1, Math.max(0, 1 + (v - 1) * saturation));
  return { r: mix(raw.r), g: mix(raw.g), b: mix(raw.b) };
}

/** Which colour bin a B–V falls in. Stars without B–V land mid-scale (white-ish). */
export function bvBin(bv: number | undefined): number {
  if (bv == null || !Number.isFinite(bv)) return Math.floor(BV_BINS * 0.35);
  const t = (bv - BV_MIN) / (BV_MAX - BV_MIN);
  return Math.min(BV_BINS - 1, Math.max(0, Math.round(t * (BV_BINS - 1))));
}

/** Representative B–V for a bin, for building that bin's sprite. */
function binToBv(bin: number): number {
  return BV_MIN + (bin / (BV_BINS - 1)) * (BV_MAX - BV_MIN);
}

/**
 * 0..1 "prominence" from magnitude — 1 for the brightest star in the sky, 0 at
 * the naked-eye limit. Everything visual (radius, opacity, glow) rides this.
 */
export function magProminence(mag: number): number {
  const t = (MAG_LIMIT - mag) / (MAG_LIMIT - MAG_BRIGHTEST);
  return Math.min(1, Math.max(0, t));
}

export interface SpriteScale {
  /** Core radius in CSS pixels at zoom 1. */
  coreRadius: number;
  /** Alpha of the star at rest. */
  alpha: number;
}

/**
 * THE MAGNITUDE HIERARCHY (Slice B2).
 *
 * The HQ visual gate's finding was "near-uniform dots… nothing to recognise",
 * and the curve is why. `magProminence` is linear in magnitude, and the old
 * shaping — radius as p^2.1, alpha as 0.30 + 0.70·p^0.75 — was too gentle at
 * both ends at once. A magnitude-5 star, of which the catalogue holds thousands,
 * came out at 32% alpha: individually faint, collectively a wash that the
 * twenty stars anyone can actually name had to compete with. Under `lighter`
 * compositing that wash is what the eye integrates, so the sky read as texture
 * rather than as structure.
 *
 * Two changes, both steepening:
 *
 *   RADIUS  p^2.1 → p^3.0, over a wider range (0.26–4.6 px rather than
 *           0.34–3.4). Sirius is now ~15× the radius of a magnitude-5 star and
 *           about 200× its area; it was ~8× and 60×.
 *   ALPHA   0.30 + 0.70·p^0.75 → 0.16 + 0.84·p^1.7. The floor drops from 32%
 *           to 17%, so the faint field recedes into being a field.
 *
 * STILL HONEST IN ORDER, STILL NOT IN RATIO. Both curves are strictly monotonic
 * in magnitude — brighter is always bigger and always brighter, with no
 * inversions and no ties introduced. The true flux ratio between Sirius and the
 * naked-eye limit is about 1,500:1 and no screen can draw that, so this is a
 * perceptual compression, as the module header has always said. What changed is
 * that the compression no longer flattens the top of the range into the middle.
 */
export function magToScale(mag: number, tuning: { maxRadius: number; minRadius: number }): SpriteScale {
  const p = magProminence(mag);
  return {
    coreRadius: tuning.minRadius + (tuning.maxRadius - tuning.minRadius) * Math.pow(p, RADIUS_GAMMA),
    alpha: 0.16 + 0.84 * Math.pow(p, 1.7),
  };
}

/** How sharply drawn radius grows with prominence. See `magToScale`. */
const RADIUS_GAMMA = 3.0;
/** How the bin index is spaced across prominence. */
const BIN_GAMMA = 0.75;

/**
 * Number of size buckets the atlas quantises to.
 *
 * Raised from 14 with the steeper curve: a 3rd-power radius spends most of its
 * range on the brightest few bins, and at 14 the top two steps were far enough
 * apart to be visible as a jump between two stars of nearly equal magnitude.
 */
export const SIZE_BINS = 18;

export function sizeBin(mag: number): number {
  const p = magProminence(mag);
  return Math.min(SIZE_BINS - 1, Math.max(0, Math.round(Math.pow(p, BIN_GAMMA) * (SIZE_BINS - 1))));
}

/**
 * The sprite atlas.
 *
 * Drawing 4,000 radial gradients per frame is hopeless; drawing 4,000
 * `drawImage` calls from ~340 pre-rendered sprites is comfortably inside a
 * 16 ms budget. Sprites are rebuilt only when the device pixel ratio changes.
 */
export class StarSprites {
  readonly #canvases: HTMLCanvasElement[][] = [];
  readonly dpr: number;
  readonly #maxRadius: number;
  readonly #minRadius: number;

  constructor(dpr: number, maxRadius: number, minRadius: number) {
    this.dpr = dpr;
    this.#maxRadius = maxRadius;
    this.#minRadius = minRadius;
    for (let colour = 0; colour < BV_BINS; colour++) {
      const row: HTMLCanvasElement[] = [];
      for (let size = 0; size < SIZE_BINS; size++) {
        row.push(this.#build(colour, size));
      }
      this.#canvases.push(row);
    }
  }

  /**
   * Radius in CSS px for a size bin — the caller needs it to place the sprite.
   *
   * The exponent is `RADIUS_GAMMA / BIN_GAMMA`, not a number of its own: a star
   * is binned by p^BIN_GAMMA and then sized by that bin, so the two must
   * compose back to `magToScale`'s curve or the atlas would draw a different
   * hierarchy from the one the model describes. Deriving it is what stops the
   * two drifting the next time either is tuned.
   */
  radiusForBin(bin: number): number {
    const p = bin / (SIZE_BINS - 1);
    return this.#minRadius + (this.#maxRadius - this.#minRadius) * Math.pow(p, RADIUS_GAMMA / BIN_GAMMA);
  }

  sprite(colourBin: number, sizeBinIndex: number): HTMLCanvasElement | null {
    return this.#canvases[colourBin]?.[sizeBinIndex] ?? null;
  }

  #build(colourBin: number, sizeBinIndex: number): HTMLCanvasElement {
    const { r, g, b } = bvToRgb(binToBv(colourBin));
    const core = this.radiusForBin(sizeBinIndex);
    // 0 for the faintest bin, 1 for the brightest — how far up the hierarchy
    // this sprite is, used to shape the bloom as well as size it.
    const rank = SIZE_BINS > 1 ? sizeBinIndex / (SIZE_BINS - 1) : 1;
    // The glow reaches well past the core — that soft bloom is most of what
    // makes a point of light read as a star rather than a pixel. It reaches
    // FURTHER, proportionally, on the bright ones: a first-magnitude star seen
    // by eye or by camera is a small hard point wrapped in a large soft halo,
    // and drawing every star with the same core-to-halo ratio is a large part
    // of why the old field read as dots of assorted sizes rather than as stars.
    const reach = core * (4.0 + 1.8 * rank) + 1.3;
    const sizePx = Math.max(4, Math.ceil(reach * 2 * this.dpr));

    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const c = sizePx / 2;
    const rr = Math.round(r * 255);
    const gg = Math.round(g * 255);
    const bb = Math.round(b * 255);

    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    // A hot near-white centre over the true-coloured halo: this is how a bright
    // point source actually behaves on a sensor and to the eye.
    //
    // The stops move IN as the star gets brighter, because `reach` has already
    // moved out: holding them fixed would have scaled the whole sprite up and
    // produced a bigger blob. Moving them in keeps the core a point and lets
    // the halo do the growing — crisp, not swollen.
    const coreStop = 0.17 - 0.07 * rank;
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(coreStop, `rgba(${rr},${gg},${bb},0.95)`);
    gradient.addColorStop(coreStop * 2.1, `rgba(${rr},${gg},${bb},0.30)`);
    gradient.addColorStop(0.58, `rgba(${rr},${gg},${bb},0.06)`);
    gradient.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, sizePx, sizePx);
    return canvas;
  }
}

/**
 * A star reduced to everything the renderer needs, computed once at load.
 *
 * Position is recomputed every frame (the sky turns), so the trig that does not
 * depend on time is cached here: declination's sine and cosine are fixed
 * properties of the star.
 */
export interface RenderStar {
  star: Star;
  raDeg: number;
  sinDec: number;
  cosDec: number;
  colourBin: number;
  sizeBinIndex: number;
  alpha: number;
  prominence: number;
  /**
   * The name shown at rest, or null. Slice B2: a star earns a standing label by
   * having a proper name in the catalogue AND being first-magnitude, which is
   * 21 stars — Sirius down to Regulus, and at most about ten of them above any
   * one horizon. That is a sky you can read without it becoming a diagram.
   * The LEAD's own label is separate and unchanged; it can name any star.
   */
  label: string | null;
}

/** Faintest a star may be and still carry a standing name. */
export const LABEL_MAG_LIMIT = 1.5;

const DEG = Math.PI / 180;

export function toRenderStars(catalog: Star[], tuning: { maxRadius: number; minRadius: number }): RenderStar[] {
  const out: RenderStar[] = [];
  for (const star of catalog) {
    const decRad = star.dec * DEG;
    out.push({
      star,
      raDeg: star.ra,
      sinDec: Math.sin(decRad),
      cosDec: Math.cos(decRad),
      colourBin: bvBin(star.bv),
      sizeBinIndex: sizeBin(star.mag),
      alpha: magToScale(star.mag, tuning).alpha,
      prominence: magProminence(star.mag),
      label: star.name && star.mag < LABEL_MAG_LIMIT ? star.name : null,
    });
  }
  // Faintest first, so the bright stars composite on top of the haze.
  out.sort((a, b) => a.prominence - b.prominence);
  return out;
}
