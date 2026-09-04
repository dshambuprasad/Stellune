/**
 * Phase 4 — the dome, and the camera that looks around it.
 *
 * THE CAMERA IS YOUR EYES (PRODUCT_WALKTHROUGH, "the one principle"). Nothing
 * in this file may ever be read by the audio path. Pan, pinch and zoom change
 * what you SEE and never what you hear; that is not a preference, it is the
 * contract the product is built on. The camera state therefore lives here, on
 * its own, with no route to the engine — the cheapest way to keep a rule is to
 * make breaking it require an import that does not exist.
 *
 * PROJECTION: stereographic azimuthal, zenith at the centre of the disc and the
 * horizon on its rim. Stereographic rather than the simpler equidistant fisheye
 * because it is conformal — it preserves angles, so constellations keep their
 * real shapes all the way down to the horizon instead of smearing sideways. The
 * shape of a constellation is the thing the ear is being taught to recognise
 * (MUSICAL_VISION §2.1); distorting it on screen would undo that.
 *
 *   r = R · tan(zenithAngle / 2)     — 0 at the zenith, exactly R at the horizon
 *
 * ORIENTATION: north at the top, east to the LEFT. This is a view looking UP at
 * the sky, not down at a map, and it is the standard all-sky convention. The
 * cardinal marks on the horizon ring say so out loud, because it is the one
 * thing about an all-sky chart people reliably misread.
 */

const DEG = Math.PI / 180;

export interface Camera {
  /** 1 = the whole dome fits the viewport. */
  zoom: number;
  /** Pan offset in CSS pixels, applied after zoom. */
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export function createCamera(): Camera {
  return { zoom: 1, panX: 0, panY: 0 };
}

export interface Viewport {
  /** CSS pixels. */
  width: number;
  height: number;
  /** Centre of the dome before panning. */
  cx: number;
  cy: number;
  /** Dome radius at zoom 1, CSS pixels. */
  radius: number;
}

/**
 * How much room the cardinal marks need OUTSIDE the horizon ring.
 *
 * `Starfield.#paintHorizon` puts each glyph's centre at `radius + 13` and draws
 * it at 11px with a middle baseline, so it reaches about seven pixels further.
 * The fit reserves exactly that, which is what makes "nothing occludes the
 * horizon circle or its cardinals" a property of the geometry rather than a
 * thing someone checks in a screenshot.
 *
 * Before Slice B3 it was reserved nowhere, and both halves of that showed: `S`
 * was drawn behind the Tonight pill on every screen, and on a 390 px phone `E`
 * and `W` fell outside the viewport and were silently skipped — a dome whose
 * one job is to say which way you are facing, missing two of its four answers.
 */
export const CARDINAL_OFFSET_PX = 13;
/**
 * How far the glyph itself reaches past its centre, plus breathing room. An 11px
 * cap on a middle baseline is about six pixels tall and four wide, and a mark
 * that merely fails to be clipped still reads as a mistake when it kisses the
 * edge of the screen — which is what `E` and `W` did on a 390px phone.
 */
const CARDINAL_GLYPH_REACH_PX = 11;
export const CARDINAL_MARGIN_PX = CARDINAL_OFFSET_PX + CARDINAL_GLYPH_REACH_PX;

/**
 * Fit the dome to the part of the screen you can actually see.
 *
 * Three things this has to get right, and the phone is where they all bite:
 *
 *   SIZE. The screen is much taller than it is wide, and a dome sized to the
 *   height would run off both sides. Sizing to the smaller dimension keeps the
 *   whole sky in view at rest — "put the phone down and it plays on" does not
 *   work if half the sky is off-screen to begin with.
 *
 *   PLACE. The controls sit over the bottom of the screen. Centring the dome in
 *   the full viewport therefore buries its lower half, including the southern
 *   horizon, under the panel. `occludedBottom` is how much of the screen the
 *   panel covers; the dome is centred in — and sized to — what is left.
 *
 *   THE RING IS PART OF THE DOME. The cardinal marks sit outside the horizon
 *   circle, so the thing that has to fit is `radius + CARDINAL_MARGIN_PX`, not
 *   `radius`. `inset` is then free to be 1: the breathing room is stated once,
 *   in pixels, by the thing that needs it, instead of hidden in a 0.94 that
 *   happened to be nearly enough on a desktop and not enough anywhere else.
 */
export function fitViewport(
  width: number,
  height: number,
  occludedBottom = 0,
  occludedTop = 0,
  inset = 1,
): Viewport {
  const visibleHeight = Math.max(120, height - occludedBottom - occludedTop);
  const span = Math.min(width, visibleHeight);
  const radius = Math.max(40, (span / 2 - CARDINAL_MARGIN_PX) * inset);
  return { width, height, cx: width / 2, cy: occludedTop + visibleHeight / 2, radius };
}

/**
 * Everything the dome occupies at rest, cardinals included — the rectangle that
 * nothing else may cover. Asserted in `test/livingSky.test.ts` and, on the real
 * layout, in `e2e/b3-ux.spec.ts`.
 */
export function domeBounds(view: Viewport): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const reach = view.radius + CARDINAL_MARGIN_PX;
  return {
    left: view.cx - reach,
    right: view.cx + reach,
    top: view.cy - reach,
    bottom: view.cy + reach,
  };
}

/** Distance from the zenith, normalised so the horizon sits at exactly 1. */
export function zenithRadius(altitudeDeg: number): number {
  return Math.tan(((90 - altitudeDeg) / 2) * DEG);
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Alt/az in degrees → CSS pixels. Azimuth is 0 = north, increasing eastward. */
export function project(
  altitudeDeg: number,
  azimuthDeg: number,
  view: Viewport,
  camera: Camera,
): ScreenPoint {
  const r = zenithRadius(altitudeDeg) * view.radius * camera.zoom;
  const a = azimuthDeg * DEG;
  return {
    x: view.cx + camera.panX - r * Math.sin(a),
    y: view.cy + camera.panY - r * Math.cos(a),
  };
}

/**
 * Keep the dome reachable.
 *
 * Panning is unrestricted in feel but bounded in fact: you can always drag the
 * horizon ring to the edge of the screen and no further, so it is impossible to
 * lose the sky and be left staring at black with no way back.
 */
export function clampCamera(camera: Camera, view: Viewport): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
  const reach = view.radius * zoom;
  const maxX = Math.max(0, reach - view.width * 0.28);
  const maxY = Math.max(0, reach - view.height * 0.28);
  return {
    zoom,
    panX: Math.min(maxX, Math.max(-maxX, camera.panX)),
    panY: Math.min(maxY, Math.max(-maxY, camera.panY)),
  };
}

/** Zoom about a point, so pinching and wheeling feel anchored under the finger. */
export function zoomAbout(
  camera: Camera,
  view: Viewport,
  factor: number,
  screenX: number,
  screenY: number,
): Camera {
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  const applied = nextZoom / camera.zoom;
  // The point under the cursor must land back under the cursor.
  const originX = view.cx + camera.panX;
  const originY = view.cy + camera.panY;
  const nextPanX = camera.panX + (originX - screenX) * (applied - 1);
  const nextPanY = camera.panY + (originY - screenY) * (applied - 1);
  return clampCamera({ zoom: nextZoom, panX: nextPanX, panY: nextPanY }, view);
}

/** The four cardinal marks, in the order they are drawn. */
export const CARDINALS: ReadonlyArray<{ label: string; azimuth: number }> = [
  { label: 'N', azimuth: 0 },
  { label: 'E', azimuth: 90 },
  { label: 'S', azimuth: 180 },
  { label: 'W', azimuth: 270 },
];
