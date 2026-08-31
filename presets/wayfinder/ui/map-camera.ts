/** @public — the pure wayfinder map camera: world/screen transforms, pan,
 * zoom-around-a-screen-point with scale clamping, viewport fitting, frame
 * easing toward a goal, and nearest-node hit testing. No DOM, no animation
 * ownership — the map controller holds a camera and a goal and steps one
 * toward the other each frame, so every interaction (drag pan, wheel zoom,
 * pinch, fit/reset) and every draw shares one transform. Pure so the geometry
 * is testable without Canvas. */

import type {
  WayfinderLayoutBounds,
  WayfinderPosition,
} from "./wayfinder-layout.ts";

/** The camera: the screen position of the world origin (x, y) plus the scale
 * from world units to screen pixels. screen = world * scale + camera. */
export type MapCamera = {
  x: number;
  y: number;
  scale: number;
};

/** A viewport size in CSS pixels (the map surface's client box). */
export type MapViewport = {
  width: number;
  height: number;
};

/** The zoom limits the camera clamps to, carried over from the reference
 * tool's camera (0.15x .. 4x). */
export const MIN_MAP_SCALE = 0.15;
export const MAX_MAP_SCALE = 4;

/** The default camera: world origin at the viewport origin, 1:1 scale. */
export function createMapCamera(x = 0, y = 0, scale = 1): MapCamera {
  return { x, y, scale };
}

/** World coordinates to screen pixels. */
export function worldToScreen(
  camera: MapCamera,
  wx: number,
  wy: number
): { x: number; y: number } {
  return { x: wx * camera.scale + camera.x, y: wy * camera.scale + camera.y };
}

/** Screen pixels to world coordinates — the exact inverse of worldToScreen. */
export function screenToWorld(
  camera: MapCamera,
  sx: number,
  sy: number
): { x: number; y: number } {
  return {
    x: (sx - camera.x) / camera.scale,
    y: (sy - camera.y) / camera.scale,
  };
}

/** A camera translated by screen pixels (drag pan). */
export function panCamera(
  camera: MapCamera,
  dx: number,
  dy: number
): MapCamera {
  return { x: camera.x + dx, y: camera.y + dy, scale: camera.scale };
}

/** The scale clamped into the reference zoom limits. */
export function clampScale(scale: number): number {
  return Math.min(MAX_MAP_SCALE, Math.max(MIN_MAP_SCALE, scale));
}

/** Zoom to `scale` keeping the world point under the screen point
 * (focusX, focusY) fixed. When the gesture also moves the anchor — a two-finger
 * pinch lands the OLD midpoint on the NEW one — pass the new anchor so the
 * zoom and the pan of the pinch ride the same transform. */
export function zoomAt(
  camera: MapCamera,
  focusX: number,
  focusY: number,
  scale: number,
  newX = focusX,
  newY = focusY
): MapCamera {
  const clamped = clampScale(scale);
  const wx = (focusX - camera.x) / camera.scale;
  const wy = (focusY - camera.y) / camera.scale;
  return { x: newX - wx * clamped, y: newY - wy * clamped, scale: clamped };
}

/** The camera that fits `bounds` into `viewport` with `pad` of breathing room
 * on every side, centered. The layout bounds already carry their own padding
 * (wayfinderLayoutBounds), so the default pad is 0. Undefined when the
 * viewport has no size or the bounds have no extent. */
export function fitCamera(
  bounds: WayfinderLayoutBounds,
  viewport: MapViewport,
  pad = 0
): MapCamera | undefined {
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
  const scale = clampScale(
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
 * frame-rate-independent fraction `1 - exp(-rate * dt)`. An infinite rate
 * (reduced motion) snaps straight to the goal. */
export function stepCamera(
  camera: MapCamera,
  goal: MapCamera,
  dt: number,
  rate = 12
): MapCamera {
  if (dt <= 0) return camera;
  const fraction = 1 - Math.exp(-rate * dt);
  return {
    x: camera.x + (goal.x - camera.x) * fraction,
    y: camera.y + (goal.y - camera.y) * fraction,
    scale: camera.scale + (goal.scale - camera.scale) * fraction,
  };
}

/** Whether two cameras are close enough to call equal — the loop stops easing
 * once the camera matches its goal within a sub-pixel/sub-1e-3-scale gap. */
export function camerasMatch(
  a: MapCamera,
  b: MapCamera,
  epsilon = 0.001
): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.scale - b.scale) < epsilon
  );
}

/** The id of the node whose position is nearest to (x, y) within `radius`
 * (world units), or undefined when none is. The radius is distance-squared
 * compared, so the caller converts screen-space hit tolerance to world units
 * through the same camera the drawing uses. */
export function nearestNodeId(
  positions: ReadonlyMap<string, WayfinderPosition>,
  x: number,
  y: number,
  radius: number
): string | undefined {
  let best: string | undefined;
  let bestDistanceSquared = radius * radius;
  for (const [id, position] of positions) {
    const dx = position.x - x;
    const dy = position.y - y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      best = id;
    }
  }
  return best;
}
