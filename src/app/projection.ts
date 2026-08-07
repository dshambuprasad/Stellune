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
 * Fit the dome to the part of the screen you can actually see.
 *
 * Two things this has to get right, and the phone is where both bite:
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
 */
export function fitViewport(
  width: number,
  height: number,
  occludedBottom = 0,
  occludedTop = 0,
  inset = 0.94,
): Viewport {
  const visibleHeight = Math.max(120, height - occludedBottom - occludedTop);
  const radius = (Math.min(width, visibleHeight) / 2) * inset;
  return { width, height, cx: width / 2, cy: occludedTop + visibleHeight / 2, radius };
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
