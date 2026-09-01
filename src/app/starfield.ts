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

/**
 * One constellation's stick figure, as polylines of catalogue star ids.
 *
 * Ids, not coordinates: `scripts/build-data.mjs` resolved every vertex of
 * d3-celestial's line set to a star in our own subset at build time, so a line
 * is drawn between the exact points this renderer has just drawn the stars at.
 * See `public/data/ATTRIBUTION.md` for the source, its pinned revision and its
 * BSD-3-Clause notice.
 */
export interface ConstellationFigure {
  id: string;
  lines: string[][];
}

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

// Slice B2 widened the radius range along with steepening the curve — see
// `starStyle.magToScale`. The brightest star is bigger and the faintest is
// smaller, which is the whole of "first-magnitude stars clearly dominate".
const FULL: Tuning = { maxRadius: 4.6, minRadius: 0.26, magLimit: 6.6 };
const LOW: Tuning = { maxRadius: 4.1, minRadius: 0.32, magLimit: 5.2 };

/**
 * The sizing `toRenderStars` should be given, exported so it cannot drift.
 *
 * It was a literal at the call site and was already stale by the time B2
 * widened the range — harmless only because `toRenderStars` reads the alpha and
 * not the radius out of `magToScale`. One exported constant instead.
 */
export const STAR_TUNING = { maxRadius: FULL.maxRadius, minRadius: FULL.minRadius };

/**
 * How faint the constellation lines are.
 *
 * The brief's word was "well below the stars, visible on a dark screen without
 * shouting", and that is a real constraint in both directions: a chart-like
 * line destroys the radical calm, and a line nobody can see is a build step
 * that produced nothing. This is the alpha at full reveal, before the
 * horizon-extinction fade that every star also gets.
 */
const FIGURE_ALPHA = 0.13;
/** Lines fade out as their stars near the horizon, exactly as the stars do. */
const FIGURE_EXTINCTION_DEGREES = 12;

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

  /** The constellation figures, as loaded. Empty until `setFigures`. */
  #figures: ConstellationFigure[] = [];
  /** Only the stars that a figure actually touches — ~700 of ~8,800. */
  #figureStars: RenderStar[] = [];
  /** Reused per frame: star id → where it was projected. No per-frame alloc. */
  readonly #figureScreen = new Map<string, { x: number; y: number; extinction: number }>();
  /** Reused per frame: the stars that earned a standing name and are on screen. */
  #labelled: Array<{ label: string; x: number; y: number; radius: number; extinction: number }> = [];

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
    this.#indexFigureStars();
  }

  /**
   * The constellation stick figures. Safe to call before or after `setStars`;
   * the index is rebuilt either way.
   */
  setFigures(figures: ConstellationFigure[]): void {
    this.#figures = figures;
    this.#indexFigureStars();
  }

  /**
   * Narrow the per-frame figure pass to the stars a figure actually touches.
   *
   * Without this the lines would cost a second full sweep of the catalogue
   * every frame to find ~700 stars. With it the extra pass is under a tenth of
   * the main loop, which is what lets the lines exist at all inside the 16 ms
   * budget the module header commits to.
   */
  #indexFigureStars(): void {
    if (this.#figures.length === 0 || this.#stars.length === 0) {
      this.#figureStars = [];
      return;
    }
    const wanted = new Set<string>();
    for (const figure of this.#figures) {
      for (const line of figure.lines) for (const id of line) wanted.add(id);
    }
    this.#figureStars = this.#stars.filter((rs) => wanted.has(rs.star.id));
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

    // The figures go UNDER the stars, in both senses: drawn first, so a star
    // composites on top of its own lines, and faint enough that the sky is
    // still a sky. `lighter` is deliberately not used here — additive strokes
    // brighten where lines cross, and every crossing would become a knot.
    this.#projectFigureStars(originX, originY, scale, sinLat, cosLat, lst, view);
    this.#paintFigures(ctx, reveal);

    ctx.globalCompositeOperation = 'lighter';

    let drawn = 0;
    this.#labelled.length = 0;
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

      // Collected, not drawn: text is `source-over` and the field is `lighter`,
      // and a name is only worth reading once the sky behind it is finished.
      if (rs.label !== null) {
        this.#labelled.push({ label: rs.label, x, y, radius: half, extinction });
      }

      drawn++;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.#drawn = drawn;

    this.#paintStandingLabels(ctx, reveal);
    this.#paintHorizon(ctx, view, camera);

    this.#frameMs += performance.now() - started;
    this.#frames++;
  }

  /**
   * Project just the figure stars, into the reusable map.
   *
   * Identical trigonometry to the main loop — deliberately so, because the
   * lines have to land on the stars to the pixel. Stars below the horizon are
   * simply absent from the map, and `#paintFigures` treats an absent endpoint
   * as a segment that does not exist: half a figure below the horizon draws the
   * half that is up, and no line dives into the ground.
   */
  #projectFigureStars(
    originX: number,
    originY: number,
    scale: number,
    sinLat: number,
    cosLat: number,
    lst: number,
    view: Viewport,
  ): void {
    this.#figureScreen.clear();
    if (this.#figureStars.length === 0) return;

    const margin = 24;
    for (const rs of this.#figureStars) {
      const h = (lst - rs.raDeg) * DEG;
      const cosH = Math.cos(h);
      const sinAlt = rs.sinDec * sinLat + rs.cosDec * cosLat * cosH;
      if (sinAlt <= 0) continue;

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
      const extinction =
        altitude < FIGURE_EXTINCTION_DEGREES
          ? 0.35 + 0.65 * (altitude / FIGURE_EXTINCTION_DEGREES)
          : 1;
      this.#figureScreen.set(rs.star.id, { x, y, extinction });
    }
  }

  /**
   * The stick figures: the thing that turns 8,849 points into Orion.
   *
   * "Nothing for people to recognise" was the review gate's phrase, and this is
   * the direct answer to it — the shapes everyone already knows, drawn from the
   * real geometry, at an alpha chosen so you notice them without being shown
   * them. Each segment takes the fainter of its two endpoints' extinction, so a
   * figure setting into the horizon haze dims as one thing rather than fraying.
   */
  #paintFigures(ctx: CanvasRenderingContext2D, reveal: number): void {
    if (this.#figureScreen.size === 0 || reveal <= 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const figure of this.#figures) {
      for (const line of figure.lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = this.#figureScreen.get(line[i] as string);
          const b = this.#figureScreen.get(line[i + 1] as string);
          if (!a || !b) continue;
          const alpha = FIGURE_ALPHA * reveal * Math.min(a.extinction, b.extinction);
          if (alpha < 0.004) continue;
          ctx.strokeStyle = `rgba(150, 175, 225, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /**
   * The standing names — the first-magnitude stars, labelled at rest.
   *
   * Not a chart: 21 stars qualify in the whole sky and about ten are ever up at
   * once, so this adds a handful of quiet words rather than a layer of text.
   * They sit to the star's right at a fixed offset from its own drawn radius,
   * so a bright star's name clears its halo instead of sitting inside it.
   *
   * The LEAD's label is drawn separately, in `#paintLead`, and is untouched: it
   * is brighter, it breathes with the phrase, and it can name any star the sky
   * happens to be speaking through — including a faint one with no standing
   * name of its own. When the LEAD is one of these 21 the two coincide, which
   * reads as the name brightening rather than as a second label.
   */
  #paintStandingLabels(ctx: CanvasRenderingContext2D, reveal: number): void {
    if (this.#labelled.length === 0 || reveal <= 0) return;

    const width = this.#view.width;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '400 11px ui-serif, Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'middle';
    for (const item of this.#labelled) {
      // The LEAD paints its own, brighter name in the same place.
      if (this.#glow.leadStarId !== null && this.#glow.leadLabel === item.label) continue;
      const alpha = 0.52 * reveal * item.extinction;
      if (alpha < 0.01) continue;

      // Flip to the star's left rather than run off the edge. On a 390 px
      // phone Arcturus sits near the right rim and "Arcturus" became "A" — a
      // truncated name is worse than no name, because it reads as a bug in the
      // sky rather than as a star that happens to be near the edge.
      const gap = item.radius + 5;
      const flip = item.x + gap + ctx.measureText(item.label).width > width - 6;
      ctx.textAlign = flip ? 'right' : 'left';
      ctx.fillStyle = `rgba(214, 226, 246, ${alpha})`;
      ctx.fillText(item.label, flip ? item.x - gap : item.x + gap, item.y);
    }
    ctx.restore();
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
