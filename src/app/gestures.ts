/**
 * Phase 4 — pan, pinch and wheel over the dome.
 *
 * VISUAL ONLY. This module imports the camera and nothing else; it has no
 * reference to the engine, the session or the audio, and it must never acquire
 * one. "Pan, pinch, zoom, scroll change what you SEE, never what you hear"
 * (PRODUCT_WALKTHROUGH). Exploration is for the eyes; the music follows the
 * sky's own clock.
 */

import type { Camera, Viewport } from './projection.ts';
import { clampCamera, zoomAbout } from './projection.ts';

export interface CameraHost {
  camera: Camera;
  readonly view: Viewport;
}

/**
 * Attach pointer handling to an element. Returns a teardown function.
 *
 * Uses Pointer Events throughout, so a mouse, a trackpad, a pen and two fingers
 * all take the same path — one implementation, no touch/mouse divergence.
 */
export function attachCameraGestures(element: HTMLElement, host: CameraHost): () => void {
  const active = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let pinchCentre = { x: 0, y: 0 };
  let dragged = false;

  const positions = (): Array<{ x: number; y: number }> => [...active.values()];

  const onPointerDown = (event: PointerEvent): void => {
    element.setPointerCapture(event.pointerId);
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged = false;
    if (active.size === 2) {
      const [a, b] = positions();
      if (a && b) {
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        pinchCentre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const previous = active.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    active.set(event.pointerId, next);

    if (active.size === 1) {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) dragged = true;
      host.camera = clampCamera(
        { ...host.camera, panX: host.camera.panX + dx, panY: host.camera.panY + dy },
        host.view,
      );
      return;
    }

    if (active.size === 2) {
      const [a, b] = positions();
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDistance > 0 && distance > 0) {
        const rect = element.getBoundingClientRect();
        host.camera = zoomAbout(
          host.camera,
          host.view,
          distance / pinchDistance,
          pinchCentre.x - rect.left,
          pinchCentre.y - rect.top,
        );
      }
      // Two-finger drag pans as well as pinches — the gesture people actually make.
      const dx = centre.x - pinchCentre.x;
      const dy = centre.y - pinchCentre.y;
      host.camera = clampCamera(
        { ...host.camera, panX: host.camera.panX + dx, panY: host.camera.panY + dy },
        host.view,
      );
      pinchDistance = distance;
      pinchCentre = centre;
      dragged = true;
    }
  };

  const release = (event: PointerEvent): void => {
    active.delete(event.pointerId);
    if (active.size < 2) pinchDistance = 0;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    // ctrl+wheel is what a trackpad pinch sends; treat it as a stronger zoom.
    const strength = event.ctrlKey ? 0.012 : 0.0022;
    const factor = Math.exp(-event.deltaY * strength);
    host.camera = zoomAbout(
      host.camera,
      host.view,
      factor,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (dragged) return;
    const rect = element.getBoundingClientRect();
    host.camera = zoomAbout(
      host.camera,
      host.view,
      host.camera.zoom > 1.5 ? 1 / host.camera.zoom : 2,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('dblclick', onDoubleClick);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', release);
    element.removeEventListener('pointercancel', release);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('dblclick', onDoubleClick);
  };
}
