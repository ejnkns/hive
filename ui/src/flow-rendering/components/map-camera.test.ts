// The wayfinder map camera: pure world/screen transforms, zoom-around-point,
// scale clamping, viewport fitting, frame easing, and nearest-node hit
// testing. Tested at the pure seam (a named export of the map-camera module,
// imported directly as TypeScript) so the camera geometry is pinned before any
// canvas draws or pointer wiring.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  camerasMatch,
  clampScale,
  createMapCamera,
  fitCamera,
  MAX_MAP_SCALE,
  MIN_MAP_SCALE,
  nearestNodeId,
  panCamera,
  screenToWorld,
  stepCamera,
  worldToScreen,
  zoomAt,
} from "../../../../presets/wayfinder/ui/map-camera.ts";
import type { WayfinderPosition } from "../../../../presets/wayfinder/ui/wayfinder-layout.ts";

describe("map camera transforms", () => {
  it("worldToScreen and screenToWorld are exact inverses", () => {
    const camera = createMapCamera(120, -40, 2.5);
    const screen = worldToScreen(camera, 30, -10);
    assert.equal(screen.x, 30 * 2.5 + 120);
    assert.equal(screen.y, -10 * 2.5 - 40);
    const world = screenToWorld(camera, screen.x, screen.y);
    assert.equal(world.x, 30);
    assert.equal(world.y, -10);
  });

  it("panCamera translates the camera by screen pixels", () => {
    const camera = createMapCamera(10, 20, 1.5);
    const panned = panCamera(camera, 8, -4);
    assert.deepEqual(panned, { x: 18, y: 16, scale: 1.5 });
    // The original camera is untouched (pure functions return new cameras).
    assert.deepEqual(camera, { x: 10, y: 20, scale: 1.5 });
  });
});

describe("map camera zoom", () => {
  it("zoomAt keeps the world point under the focus fixed", () => {
    const camera = createMapCamera(100, 50, 1);
    // World point under screen (160, 90): ((160-100)/1, (90-50)/1) = (60, 40).
    const zoomed = zoomAt(camera, 160, 90, 2);
    assert.equal(zoomed.scale, 2);
    // The same world point must land back on (160, 90).
    const back = worldToScreen(zoomed, 60, 40);
    assert.ok(Math.abs(back.x - 160) < 1e-9);
    assert.ok(Math.abs(back.y - 90) < 1e-9);
  });

  it("zoomAt clamps the scale to the reference limits", () => {
    const camera = createMapCamera(0, 0, 1);
    assert.equal(zoomAt(camera, 0, 0, 100).scale, MAX_MAP_SCALE);
    assert.equal(zoomAt(camera, 0, 0, 0.001).scale, MIN_MAP_SCALE);
  });

  it("clampScale clamps into [MIN_MAP_SCALE, MAX_MAP_SCALE]", () => {
    assert.equal(clampScale(0.01), MIN_MAP_SCALE);
    assert.equal(clampScale(99), MAX_MAP_SCALE);
    assert.equal(clampScale(1.7), 1.7);
  });
});

describe("map camera fit", () => {
  it("fitCamera centers the bounds in the viewport at the tightest scale", () => {
    // A 100x50 world bounds centered on (50, 25) into a 400x200 viewport:
    // the horizontal ratio is 4, the vertical ratio is 4, so scale 4 fits.
    const camera = fitCamera(
      { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      { width: 400, height: 200 }
    );
    assert.ok(camera !== undefined);
    assert.equal(camera?.scale, 4);
    // Center of bounds (50, 25) maps to viewport center (200, 100).
    const center = worldToScreen(camera as NonNullable<typeof camera>, 50, 25);
    assert.ok(Math.abs(center.x - 200) < 1e-9);
    assert.ok(Math.abs(center.y - 100) < 1e-9);
  });

  it("fitCamera picks the limiting axis (landscape bounds in a narrower viewport)", () => {
    // Bounds wider than the viewport; the horizontal axis limits the fit.
    const camera = fitCamera(
      { minX: 0, minY: 0, maxX: 600, maxY: 100 },
      { width: 400, height: 300 }
    );
    assert.ok(camera !== undefined);
    assert.ok(Math.abs((camera?.scale ?? 0) - 400 / 600) < 1e-9);
  });

  it("fitCamera subtracts the requested padding from the viewport", () => {
    const camera = fitCamera(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { width: 300, height: 300 },
      50
    );
    // Effective viewport 200x200 -> scale 2.
    assert.equal(camera?.scale, 2);
  });

  it("fitCamera returns undefined for a zero-size viewport or an empty bounds", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    assert.equal(fitCamera(bounds, { width: 0, height: 300 }), undefined);
    assert.equal(fitCamera(bounds, { width: 300, height: 0 }), undefined);
    assert.equal(
      fitCamera(
        { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        { width: 300, height: 300 }
      ),
      undefined
    );
  });
});

describe("map camera easing", () => {
  it("stepCamera moves toward the goal and converges", () => {
    const camera = createMapCamera(0, 0, 1);
    const goal = createMapCamera(100, 50, 2);
    let current = camera;
    for (let i = 0; i < 300; i += 1) {
      current = stepCamera(current, goal, 1 / 60, 12);
    }
    assert.ok(camerasMatch(current, goal));
  });

  it("stepCamera with an infinite rate snaps to the goal (reduced motion)", () => {
    const camera = createMapCamera(0, 0, 1);
    const goal = createMapCamera(100, 50, 2);
    const snapped = stepCamera(camera, goal, 1 / 60, Number.POSITIVE_INFINITY);
    assert.deepEqual(snapped, goal);
  });

  it("stepCamera with zero dt leaves the camera unchanged", () => {
    const camera = createMapCamera(5, 5, 1);
    assert.deepEqual(stepCamera(camera, createMapCamera(9, 9, 2), 0, 12), {
      x: 5,
      y: 5,
      scale: 1,
    });
  });

  it("camerasMatch tolerates sub-millisecond drift", () => {
    assert.ok(
      camerasMatch(
        { x: 1, y: 2, scale: 1.5 },
        { x: 1.0004, y: 1.9996, scale: 1.5 }
      )
    );
    assert.ok(
      !camerasMatch({ x: 1, y: 2, scale: 1.5 }, { x: 1.01, y: 2, scale: 1.5 })
    );
  });
});

describe("map hit testing", () => {
  const positions = new Map<string, WayfinderPosition>([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 10, y: 0 }],
    ["c", { x: 100, y: 100 }],
  ]);

  it("nearestNodeId returns the closest node within the radius", () => {
    assert.equal(nearestNodeId(positions, 8, 0, 6), "b");
    assert.equal(nearestNodeId(positions, 2, 2, 6), "a");
  });

  it("nearestNodeId returns undefined when nothing is within the radius", () => {
    assert.equal(nearestNodeId(positions, 50, 50, 6), undefined);
  });

  it("nearestNodeId handles an empty position map", () => {
    assert.equal(nearestNodeId(new Map(), 0, 0, 10), undefined);
  });
});
