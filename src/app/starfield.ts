/**
 * Phase 4 — THE STARFIELD.
 *
 * WHY CANVAS 2D AND NOT WebGL. The load is ~4,300 stars above the horizon at
 * once, drawn as pre-rendered sprites. Measured on this machine that is ~3 ms a
 * frame, comfortably inside the 16.7 ms budget, and the honest reason to reach
 * for WebGL — tens of thousands of points — is an order of magnitude away. What
 * we get for staying in 2D is worth more than the headroom we give up: no
 * shader pipeline, no context-loss recovery path, no driver variance, and it
 * works on every browser this will ever be wrapped into, which matters because
 * the ship path ends at Capacitor and the App Store. The glow-sync halo also
 * wants per-star dynamic radius and alpha every frame, which is a one-line
 * `drawImage` scale in 2D and a buffer re-upload in WebGL.
 *
 * If a later phase adds deep-sky objects or the century time-scrub (both on the
 * roadmap, both way past 10k objects), that is the moment to switch. The
 * projection, colour and glow modules are deliberately renderer-agnostic so the
 * swap costs only this file.
 *
 * THE HOT LOOP. Per frame, per star: one cos, one sin, one asin, one atan2, one
 * tan, one drawImage. Declination's sine and cosine are precomputed at load
 * (they never change), and stars below the horizon are dropped before any
 * drawing happens.
 */

import type { Camera, Viewport } from './projection.ts';
import { CARDINALS, clampCamera, fitViewport, project, zenithRadius } from './projection.ts';
import type { RenderStar } from './starStyle.ts';
import { StarSprites } from './starStyle.ts';

const DEG = Math.PI / 180;

/** What the renderer needs to know about the sounding sky, refreshed per frame. */
export interface GlowState {
  /** starId → 0..1 voice level, for every star currently sounding. */
  levels: Map<string, number>;
  /** The star the LEAD is speaking through right now, if any. */
  leadStarId: string | null;
  /** Its name, when the catalogue has one — the small label. */
  leadLabel: string | null;
  /** 0..1 — how far through its phrase, so the halo can breathe in and out. */
  leadIntensity: number;
}

export const EMPTY_GLOW: GlowState = {
  levels: new Map(),
  leadStarId: null,
  leadLabel: null,
  leadIntensity: 0,
};

export interface StarfieldOptions {
  /** Halve the frame rate and thin the field. Set from prefers-reduced-motion
   *  or the low-power toggle. */
  lowPower?: boolean;
}

interface Tuning {
  maxRadius: number;
  minRadius: number;
  /** Faintest magnitude drawn. Low-power mode raises the floor. */
  magLimit: number;
}

const FULL: Tuning = { maxRadius: 3.4, minRadius: 0.34, magLimit: 6.6 };
const LOW: Tuning = { maxRadius: 3.0, minRadius: 0.42, magLimit: 5.2 };

export class Starfield {
  readonly canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;

  #stars: RenderStar[] = [];
  #sprites: StarSprites | null = null;
  #view: Viewport;
  #camera: Camera = { zoom: 1, panX: 0, panY: 0 };
  #dpr = 1;
  #lowPower: boolean;
  #tuning: Tuning;
  /** How many CSS pixels of the bottom the controls cover. */
  #occludedBottom = 0;
  /** …and of the top, where the title and status line sit. */
  #occludedTop = 0;

  /** Observer latitude, degrees. */
  #latitude = 0;
  /** Local sidereal time of the frame being drawn, degrees. */
  #lst = 0;
  /** 0..1 — the whole field fades in when a session opens. */
  #reveal = 0;

  #glow: GlowState = EMPTY_GLOW;

  /** Rolling frame-time average, exposed for the performance note. */
  #frameMs = 0;
  #frames = 0;
  /** Rendered star count last frame, for the smoke test to assert on. */
  #drawn = 0;
  /** Where the LEAD was last drawn, in CSS pixels. Null when it is off-screen. */
  #leadScreen: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, options: StarfieldOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Cosmophony: this browser cannot open a 2D canvas.');
    this.#ctx = ctx;
    this.#lowPower = options.lowPower ?? false;
    this.#tuning = this.#lowPower ? LOW : FULL;
    this.#view = fitViewport(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  /**
   * Tell the field how much of the bottom of the screen the panel covers, so
   * the dome can sit in the part you can see. Re-fits immediately: on a phone
   * this is the difference between a whole sky and a half one.
   */
  setOcclusion(bottomPixels: number, topPixels = this.#occludedTop): void {
    const bottom = Math.max(0, Math.round(bottomPixels));
    const top = Math.max(0, Math.round(topPixels));
    if (bottom === this.#occludedBottom && top === this.#occludedTop) return;
    this.#occludedBottom = bottom;
    this.#occludedTop = top;
    this.#view = fitViewport(
      this.canvas.clientWidth || 1,
      this.canvas.clientHeight || 1,
      bottom,
      top,
    );
    this.#camera = clampCamera(this.#camera, this.#view);
  }

  get camera(): Camera {
    return this.#camera;
  }

  set camera(next: Camera) {
    this.#camera = clampCamera(next, this.#view);
  }

  get view(): Viewport {
    return this.#view;
  }

  get lowPower(): boolean {
    return this.#lowPower;
  }

  get averageFrameMs(): number {
    return this.#frames > 0 ? this.#frameMs / this.#frames : 0;
  }

  get drawnLastFrame(): number {
    return this.#drawn;
  }

  /** Where the speaking star is on screen right now, if it is on screen. */
  get leadScreen(): { x: number; y: number } | null {
    return this.#leadScreen;
  }

  resetStats(): void {
    this.#frameMs = 0;
    this.#frames = 0;
  }

  setLowPower(lowPower: boolean): void {
    if (lowPower === this.#lowPower) return;
    this.#lowPower = lowPower;
    this.#tuning = lowPower ? LOW : FULL;
    this.#sprites = null; // rebuilt on the next frame at the new sizing
  }

  setStars(stars: RenderStar[]): void {
    this.#stars = stars;
  }

  setObserver(latitudeDeg: number): void {
    this.#latitude = latitudeDeg;
  }

  /** The sky's own time for this frame, in degrees of local sidereal time. */
  setSiderealTime(lstDeg: number): void {
    this.#lst = lstDeg;
  }

  setGlow(glow: GlowState): void {
    this.#glow = glow;
  }

  /** 0..1. The sky fades in rather than snapping on — the walkthrough's word. */
  setReveal(reveal: number): void {
    this.#reveal = Math.min(1, Math.max(0, reveal));
  }

  /** Match the backing store to the element. Returns true if anything changed. */
  resize(): boolean {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    // Cap the device pixel ratio: a 3× phone screen triples the fill cost for
    // a difference nobody can see on a field of soft points.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wantW = Math.round(width * dpr);
    const wantH = Math.round(height * dpr);
    if (this.canvas.width === wantW && this.canvas.height === wantH && this.#sprites) {
      return false;
    }
    this.canvas.width = wantW;
    this.canvas.height = wantH;
    this.#dpr = dpr;
    this.#view = fitViewport(width, height, this.#occludedBottom, this.#occludedTop);
    this.#camera = clampCamera(this.#camera, this.#view);
    this.#sprites = new StarSprites(dpr, this.#tuning.maxRadius, this.#tuning.minRadius);
    return true;
  }

  /** Draw one frame. */
  render(): void {
    const started = performance.now();
    this.resize();
    const sprites = this.#sprites;
    if (!sprites) return;

    const ctx = this.#ctx;
    const view = this.#view;
    const camera = this.#camera;
    const dpr = this.#dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#paintSpace(ctx, view);

    const originX = view.cx + camera.panX;
    const originY = view.cy + camera.panY;
    const scale = view.radius * camera.zoom;

    // Stars are point sources: strictly, zooming should separate them without
    // enlarging them. Strictly is wrong here — at 6× the field thinned out and
    // read as *less* detail, which is the opposite of what zooming in is for.
    // A gentle growth keeps the same visual weight per star while the patterns
    // open up. Sub-linear, so it never becomes a field of blobs.
    const zoomScale = Math.pow(camera.zoom, 0.4);

    // Cull to the viewport with a margin for the glow's reach.
    const margin = 24;
    const latRad = this.#latitude * DEG;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const lst = this.#lst;
    const magLimit = this.#tuning.magLimit;
    const reveal = this.#reveal;

    ctx.globalCompositeOperation = 'lighter';

    let drawn = 0;
    this.#leadScreen = null;
    for (const rs of this.#stars) {
      if (rs.star.mag > magLimit) continue;

      // Hour angle → altitude. The sky turns; this is the only per-frame trig
      // that cannot be precomputed.
      const h = (lst - rs.raDeg) * DEG;
      const cosH = Math.cos(h);
      const sinAlt = rs.sinDec * sinLat + rs.cosDec * cosLat * cosH;
      if (sinAlt <= 0) continue; // below the horizon: not in this sky

      const altitude = Math.asin(sinAlt > 1 ? 1 : sinAlt) / DEG;
      const azimuth = Math.atan2(
        -rs.cosDec * Math.sin(h),
        rs.sinDec * cosLat - rs.cosDec * sinLat * cosH,
      );

      const r = zenithRadius(altitude) * scale;
      const x = originX - r * Math.sin(azimuth);
      const y = originY - r * Math.cos(azimuth);
      if (x < -margin || y < -margin || x > view.width + margin || y > view.height + margin) {
        continue;
      }

      const sprite = sprites.sprite(rs.colourBin, rs.sizeBinIndex);
      if (!sprite) continue;

      // A star low on the horizon is dimmed, as it really is through more air.
      const extinction = altitude < 12 ? 0.35 + 0.65 * (altitude / 12) : 1;
      const level = this.#glow.levels.get(rs.star.id) ?? 0;

      const size = (sprite.width / dpr) * zoomScale;
      const half = size / 2;
      ctx.globalAlpha = Math.min(1, rs.alpha * extinction * reveal);
      ctx.drawImage(sprite, x - half, y - half, size, size);

      // GLOW-SYNC — the product's signature moment. A star that is sounding
      // swells with its own voice level, so the sky is visibly singing.
      if (level > 0.004) {
        const swell = 1 + 2.6 * Math.sqrt(level);
        const glowSize = size * swell;
        ctx.globalAlpha = Math.min(1, 0.55 * Math.sqrt(level) * reveal);
        ctx.drawImage(sprite, x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
      }

      if (rs.star.id === this.#glow.leadStarId) {
        this.#paintLead(ctx, x, y, size, level, reveal);
        this.#leadScreen = { x, y };
      }

      drawn++;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.#drawn = drawn;

    this.#paintHorizon(ctx, view, camera);

    this.#frameMs += performance.now() - started;
    this.#frames++;
  }

  /** The deep-space gradient: never flat black, never bright. */
  #paintSpace(ctx: CanvasRenderingContext2D, view: Viewport): void {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#04060d';
    ctx.fillRect(0, 0, view.width, view.height);

    const cx = view.cx + this.#camera.panX;
    const cy = view.cy + this.#camera.panY;
    // Clamp the wash to the viewport. Tied to the zoomed dome radius it grows
    // off-screen when you zoom in, and its bright centre floods the whole
    // frame — the sky got *lighter* the closer you looked, which is backwards.
    const reach = Math.min(view.radius * this.#camera.zoom, Math.max(view.width, view.height) * 0.72);

    // A slow cool wash toward the zenith, and a hint of warmth near the horizon
    // where a real sky carries airglow and the last of the light.
    const sky = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * 1.35);
    sky.addColorStop(0, 'rgba(20, 30, 56, 0.85)');
    sky.addColorStop(0.55, 'rgba(11, 17, 34, 0.6)');
    sky.addColorStop(0.88, 'rgba(24, 22, 34, 0.42)');
    sky.addColorStop(1, 'rgba(4, 6, 13, 0)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, view.width, view.height);
  }

  /** The horizon ring and its cardinal marks — thin, quiet, always readable. */
  #paintHorizon(ctx: CanvasRenderingContext2D, view: Viewport, camera: Camera): void {
    const cx = view.cx + camera.panX;
    const cy = view.cy + camera.panY;
    const r = view.radius * camera.zoom;
    const fade = 0.35 + 0.65 * this.#reveal;

    ctx.save();
    ctx.strokeStyle = `rgba(150, 170, 210, ${0.22 * fade})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // A second, fainter ring at 30° altitude gives the dome depth without
    // turning the screen into a chart.
    ctx.strokeStyle = `rgba(150, 170, 210, ${0.08 * fade})`;
    ctx.beginPath();
    ctx.arc(cx, cy, zenithRadius(30) * r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = `500 ${11}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { label, azimuth } of CARDINALS) {
      const p = project(0, azimuth, view, camera);
      // Nudge the glyph outside the ring.
      const dx = (p.x - cx) / (r || 1);
      const dy = (p.y - cy) / (r || 1);
      const lx = cx + dx * (r + 13);
      const ly = cy + dy * (r + 13);
      if (lx < 4 || ly < 4 || lx > view.width - 4 || ly > view.height - 4) continue;
      ctx.fillStyle = `rgba(190, 205, 235, ${0.45 * fade})`;
      ctx.fillText(label, lx, ly);
    }
    ctx.restore();
  }

  /**
   * The LEAD speaker: the strongest halo in the sky, and a small name.
   *
   * "A star speaks when it really rises, culminates or sets — and GLOWS as it
   * sounds" (PRODUCT_WALKTHROUGH). This is that sentence, drawn.
   */
  #paintLead(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    level: number,
    reveal: number,
  ): void {
    const intensity = Math.max(this.#glow.leadIntensity, Math.sqrt(level));
    if (intensity <= 0.01) return;

    const ringR = size * (0.9 + 1.5 * intensity);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 0.5 * intensity * reveal);
    const halo = ctx.createRadialGradient(x, y, 0, x, y, ringR);
    halo.addColorStop(0, 'rgba(255,255,255,0.55)');
    halo.addColorStop(0.4, 'rgba(200,220,255,0.22)');
    halo.addColorStop(1, 'rgba(160,190,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const label = this.#glow.leadLabel;
    if (!label) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(1, 0.85 * intensity * reveal);
    ctx.font = '400 12px ui-serif, Georgia, "Times New Roman", serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232, 238, 250, 0.92)';
    ctx.fillText(label, x + ringR * 0.75 + 4, y);
    ctx.restore();
  }
}
