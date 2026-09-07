// The pure honeycomb camera: transforms, pan, zoom-around-a-point, fitting,
// and easing toward a goal. Tested with node --test like the other pure
// geometry suites (the wayfinder camera pattern).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampCombScale,
  combCamerasMatch,
  combScreenToWorld,
  combWorldToScreen,
  createCombCamera,
  fitCombCamera,
  panCombCamera,
  stepCombCamera,
  zoomCombAt,
} from "../../../../presets/honeycomb/ui/comb-camera.ts";

describe("combWorldToScreen / combScreenToWorld", () => {
  it("are exact inverses", () => {
    const camera = createCombCamera(300, -120, 0.7);
    const world = combScreenToWorld(camera, 512, 384);
    const screen = combWorldToScreen(camera, world.x, world.y);
    assert.ok(Math.abs(screen.x - 512) < 1e-9);
    assert.ok(Math.abs(screen.y - 384) < 1e-9);
  });

  it("applies scale and offset", () => {
    const camera = createCombCamera(100, 50, 2);
    assert.deepEqual(combWorldToScreen(camera, 10, 5), { x: 120, y: 60 });
  });
});

describe("panCombCamera", () => {
  it("translates by screen pixels, keeping scale", () => {
    const panned = panCombCamera(createCombCamera(0, 0, 0.5), 30, -12);
    assert.deepEqual(panned, { x: 30, y: -12, scale: 0.5 });
  });
});

describe("clampCombScale", () => {
  it("clamps into the zoom limits", () => {
    assert.ok(clampCombScale(0.001) > 0);
    assert.ok(clampCombScale(50) <= 2);
  });
});

describe("zoomCombAt", () => {
  it("keeps the world point under the focus point fixed", () => {
    const camera = createCombCamera(40, 40, 0.5);
    const focusX = 200;
    const focusY = 150;
    const worldBefore = combScreenToWorld(camera, focusX, focusY);
    const zoomed = zoomCombAt(camera, focusX, focusY, 1.1);
    const worldAfter = combScreenToWorld(zoomed, focusX, focusY);
    assert.ok(Math.abs(worldAfter.x - worldBefore.x) < 1e-9);
    assert.ok(Math.abs(worldAfter.y - worldBefore.y) < 1e-9);
    assert.equal(zoomed.scale, 1.1);
  });

  it("clamps the scale", () => {
    const zoomed = zoomCombAt(createCombCamera(), 100, 100, 999);
    assert.ok(zoomed.scale <= 2);
  });
});

describe("fitCombCamera", () => {
  it("fits bounds into the viewport, centered, honoring the pad", () => {
    const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 200 };
    const fit = fitCombCamera(bounds, { width: 500, height: 400 }, 50)!;
    assert.ok(Math.abs(fit.scale - 1) < 1e-9); // 400/400 = 1 vs 300/200 → 1
    const center = combWorldToScreen(fit, 200, 100);
    assert.ok(Math.abs(center.x - 250) < 1e-9);
    assert.ok(Math.abs(center.y - 200) < 1e-9);
  });

  it("is undefined with no extent", () => {
    assert.equal(
      fitCombCamera(
        { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        { width: 100, height: 100 }
      ),
      undefined
    );
    assert.equal(
      fitCombCamera(
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        { width: 0, height: 0 }
      ),
      undefined
    );
  });
});

describe("stepCombCamera", () => {
  it("eases toward the goal, frame-rate independently", () => {
    const start = createCombCamera(0, 0, 1);
    const goal = createCombCamera(100, 0, 2);
    const rate = 10;
    const afterOne = stepCombCamera(start, goal, 0.05, rate);
    // Two 25ms steps cover the same fraction as one 50ms step.
    const afterTwo = stepCombCamera(
      stepCombCamera(start, goal, 0.025, rate),
      goal,
      0.025,
      rate
    );
    assert.ok(Math.abs(afterTwo.x - afterOne.x) < 0.01);
    assert.ok(Math.abs(afterTwo.scale - afterOne.scale) < 0.01);
    assert.ok(afterOne.x > 0);
    assert.ok(afterOne.x < 100);
  });

  it("returns the camera unchanged for a non-positive dt", () => {
    const start = createCombCamera(0, 0, 1);
    const goal = createCombCamera(100, 0, 2);
    assert.deepEqual(stepCombCamera(start, goal, 0), start);
  });
});

describe("combCamerasMatch", () => {
  it("matches within the epsilon only", () => {
    const a = createCombCamera(0, 0, 1);
    assert.ok(combCamerasMatch(a, createCombCamera(0.0005, 0, 1)));
    assert.ok(!combCamerasMatch(a, createCombCamera(0.1, 0, 1)));
  });
});
