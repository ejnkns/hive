/** @public — the pure honeycomb camera: world/screen transforms, pan,
 * zoom-around-a-screen-point with scale clamping, viewport fitting, and
 * frame-rate-independent easing toward a goal. No DOM, no animation
 * ownership — the comb surface holds a camera and a goal and steps one
 * toward the other each frame, so every interaction (drag pan, wheel zoom,
 * hive focus, fit-all reset) and every render shares one transform. Pure so
 * the geometry is testable without a browser. */

import type { WorldPoint } from "./hex-layout.ts";

/** The camera: the screen position of the world origin (x, y) plus the
 * scale from world units to screen pixels. screen = world * scale + camera. */
export type CombCamera = { x: number; y: number; scale: number };

/** A viewport size in CSS pixels (the comb surface's client box). */
export type CombViewport = { width: number; height: number };

// The zoom limits: wide enough below the fit-all scale that the overview
// hives stay comfortable on any data size, high enough that cells fill the
// screen when focused.
export const MIN_COMB_SCALE = 0.05;
export const MAX_COMB_SCALE = 2;

export function createCombCamera(x = 0, y = 0, scale = 1): CombCamera {
  return { x, y, scale };
}

/** World coordinates to screen pixels. */
export function combWorldToScreen(
  camera: CombCamera,
  wx: number,
  wy: number
): WorldPoint {
  return { x: wx * camera.scale + camera.x, y: wy * camera.scale + camera.y };
}

/** Screen pixels to world coordinates — the exact inverse. */
export function combScreenToWorld(
  camera: CombCamera,
  sx: number,
  sy: number
): WorldPoint {
  return {
    x: (sx - camera.x) / camera.scale,
    y: (sy - camera.y) / camera.scale,
  };
}

/** A camera translated by screen pixels (drag pan). */
export function panCombCamera(
  camera: CombCamera,
  dx: number,
  dy: number
): CombCamera {
  return { x: camera.x + dx, y: camera.y + dy, scale: camera.scale };
}

export function clampCombScale(scale: number): number {
  return Math.min(MAX_COMB_SCALE, Math.max(MIN_COMB_SCALE, scale));
}

/** Zoom to `scale` keeping the world point under the screen point
 * (focusX, focusY) fixed. */
export function zoomCombAt(
  camera: CombCamera,
  focusX: number,
  focusY: number,
  scale: number
): CombCamera {
  const clamped = clampCombScale(scale);
  const wx = (focusX - camera.x) / camera.scale;
  const wy = (focusY - camera.y) / camera.scale;
  return { x: focusX - wx * clamped, y: focusY - wy * clamped, scale: clamped };
}

/** The camera that fits `bounds` into `viewport` with `pad` of breathing
 * room on every side, centered. Undefined when either has no extent. */
export function fitCombCamera(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: CombViewport,
  pad = 0
): CombCamera | undefined {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  const scale = clampCombScale(
    Math.min(
      (viewport.width - pad * 2) / width,
      (viewport.height - pad * 2) / height
    )
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    x: viewport.width / 2 - cx * scale,
    y: viewport.height / 2 - cy * scale,
    scale,
  };
}

/** One easing step toward the goal: the camera closes the gap by a
 * frame-rate-independent fraction. An infinite rate snaps straight to the
 * goal. */
export function stepCombCamera(
  camera: CombCamera,
  goal: CombCamera,
  dt: number,
  rate = 10
): CombCamera {
  if (dt <= 0) return camera;
  const fraction = 1 - Math.exp(-rate * dt);
  return {
    x: camera.x + (goal.x - camera.x) * fraction,
    y: camera.y + (goal.y - camera.y) * fraction,
    scale: camera.scale + (goal.scale - camera.scale) * fraction,
  };
}

/** Whether two cameras are close enough to call equal — the loop stops
 * easing once the camera matches its goal. */
export function combCamerasMatch(
  a: CombCamera,
  b: CombCamera,
  epsilon = 0.001
): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.scale - b.scale) < epsilon
  );
}
