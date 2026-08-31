// The wayfinder map controller (W4): the persistent camera/animation owner —
// mount/update/fit/reset/dispose plus the pointer/wheel interaction wiring —
// tested in a real DOM (vitest jsdom). Canvas 2d context is unavailable in
// jsdom, so the controller must mount, fit, pan, zoom, hit-test, and clean up
// with a null context; the pure geometry it runs on is pinned separately in
// map-camera.test.ts / map-visuals.test.ts, and the visual output is verified
// by eye in a real browser (ticket 10).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fitCamera,
  type MapCamera,
} from "../../../../presets/wayfinder/ui/map-camera.ts";
import { MapController } from "../../../../presets/wayfinder/ui/map-controller.ts";
import {
  layoutWayfinderMap,
  wayfinderLayoutBounds,
} from "../../../../presets/wayfinder/ui/wayfinder-layout.ts";
import {
  deriveWayfinderMap,
  type WayfinderMap,
} from "../../../../presets/wayfinder/ui/wayfinder-map.ts";
import { wayfinderFixtureEntries } from "./wayfinder-fixtures.ts";

// A minimal map surface: a host with the canvas and a node-overlay layer,
// sized by stubbed client metrics (jsdom does no layout).
function surfaceHost(size: { width: number; height: number }) {
  const host = document.createElement("div");
  host.innerHTML = "<canvas></canvas><div class='map-nodes'></div>";
  Object.defineProperty(host, "clientWidth", {
    value: size.width,
    configurable: true,
  });
  Object.defineProperty(host, "clientHeight", {
    value: size.height,
    configurable: true,
  });
  document.body.appendChild(host);
  return host;
}

const VIEWPORT = { width: 800, height: 600 };

// The baseline snapshot's derived model — the same fixture every wayfinder
// UI test builds on.
function baselineModel(): WayfinderMap {
  return deriveWayfinderMap(wayfinderFixtureEntries());
}

// The node-overlay divs the surface would render; the controller positions
// them from the model's ids.
function addOverlayNodes(host: HTMLElement, model: WayfinderMap) {
  for (const node of model.nodes) {
    const el = document.createElement("div");
    el.className = "node";
    el.dataset.id = node.id;
    host.querySelector(".map-nodes")?.appendChild(el);
  }
}

function pointerDown(host: HTMLElement, x: number, y: number, pointerId = 1) {
  host.dispatchEvent(
    new PointerEvent("pointerdown", { clientX: x, clientY: y, pointerId })
  );
}

function pointerMove(host: HTMLElement, x: number, y: number, pointerId = 1) {
  host.dispatchEvent(
    new PointerEvent("pointermove", { clientX: x, clientY: y, pointerId })
  );
}

function pointerUp(host: HTMLElement, x: number, y: number, pointerId = 1) {
  host.dispatchEvent(
    new PointerEvent("pointerup", { clientX: x, clientY: y, pointerId })
  );
}

describe("wayfinder map controller", () => {
  // jsdom cannot provide a Canvas 2d context; the controller guards the null
  // context (drawing is verified in a real browser). Stub getContext so the
  // jsdom warning stays out of the suite output.
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof originalGetContext;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("mounts, measures the viewport, and fits the first map into view", async () => {
    vi.useFakeTimers();
    const host = surfaceHost(VIEWPORT);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    // The initial fit eases the camera to the fit of the layout bounds;
    // recompute the expectation independently at the pure seam.
    const model = baselineModel();
    const bounds = wayfinderLayoutBounds(layoutWayfinderMap(model));
    const expected: MapCamera | undefined =
      bounds === undefined ? undefined : fitCamera(bounds, VIEWPORT);
    expect(expected).toBeDefined();
    await vi.advanceTimersByTimeAsync(1_000);
    const camera = controller.camera;
    expect(camera.scale).toBeCloseTo(expected?.scale ?? 0, 4);
    expect(camera.x).toBeCloseTo(expected?.x ?? 0, 2);
    expect(camera.y).toBeCloseTo(expected?.y ?? 0, 2);
    document.body.removeChild(host);
  });

  it("lays out positions from the shared model and positions the overlays", () => {
    const host = surfaceHost(VIEWPORT);
    const model = baselineModel();
    addOverlayNodes(host, model);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(model, "mountain");
    const nodes = host.querySelectorAll(".node");
    expect(nodes.length).toBe(model.nodes.length);
    // Every overlay carries the camera-projected position in CSS variables.
    for (const el of nodes) {
      const x = (el as HTMLElement).style.getPropertyValue("--node-x");
      expect(x).toMatch(/px$/);
    }
    document.body.removeChild(host);
  });

  it("keeps the camera and positions stable across a re-render of the same model", () => {
    const host = surfaceHost(VIEWPORT);
    const model = baselineModel();
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(model, "mountain");
    controller.reset();
    const before = controller.camera;
    controller.update(model, "mountain");
    expect(controller.camera).toEqual(before);
    document.body.removeChild(host);
  });

  it("pans the goal by the drag delta and eases the camera after it", async () => {
    vi.useFakeTimers();
    const host = surfaceHost(VIEWPORT);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    const before = controller.camera;
    pointerDown(host, 100, 100);
    pointerMove(host, 160, 40);
    pointerUp(host, 160, 40);
    expect(controller.goal.x).toBeCloseTo(before.x + 60);
    expect(controller.goal.y).toBeCloseTo(before.y - 60);
    // The frame loop eases the camera toward the new goal.
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.camera.x).toBeGreaterThan(before.x + 55);
    document.body.removeChild(host);
  });

  it("zooms around the pointer on wheel, keeping the world point under it fixed", () => {
    const host = surfaceHost(VIEWPORT);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    const before = controller.camera;
    const screen = { x: 300, y: 200 };
    host.dispatchEvent(
      new WheelEvent("wheel", {
        clientX: screen.x,
        clientY: screen.y,
        deltaY: -240,
        cancelable: true,
      })
    );
    expect(controller.goal.scale).toBeGreaterThan(before.scale);
    // Project the world point under the pointer through both cameras.
    const worldBefore = {
      x: (screen.x - before.x) / before.scale,
      y: (screen.y - before.y) / before.scale,
    };
    const worldAfter = {
      x: (screen.x - controller.goal.x) / controller.goal.scale,
      y: (screen.y - controller.goal.y) / controller.goal.scale,
    };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 5);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 5);
    document.body.removeChild(host);
  });

  it("hit-tests a background tap through the camera and focuses the nearest node", () => {
    const host = surfaceHost(VIEWPORT);
    const onFocus = vi.fn();
    const controller = new MapController({ onFocus });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    // The base camp is pinned at the world origin; with the fit camera the
    // origin lands at a known screen point — tap there.
    const origin = { x: controller.camera.x, y: controller.camera.y };
    pointerDown(host, origin.x, origin.y);
    pointerUp(host, origin.x, origin.y);
    expect(onFocus).toHaveBeenCalledWith("base");
    document.body.removeChild(host);
  });

  it("does not hit-test a drag: movement beyond the tap threshold pans instead", () => {
    const host = surfaceHost(VIEWPORT);
    const onFocus = vi.fn();
    const controller = new MapController({ onFocus });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    pointerDown(host, 100, 100);
    pointerMove(host, 140, 140);
    pointerUp(host, 140, 140);
    expect(onFocus).not.toHaveBeenCalled();
    document.body.removeChild(host);
  });

  it("focuses a node tapped through the camera (canvas-aligned hit testing)", () => {
    const host = surfaceHost(VIEWPORT);
    const onFocus = vi.fn();
    const controller = new MapController({ onFocus });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    // Project a known node through the same camera the controller uses, and
    // tap its screen position — the tap must select that node.
    const position = layoutWayfinderMap(baselineModel()).get("summit");
    expect(position).toBeDefined();
    const camera = controller.camera;
    const screen = {
      x: (position?.x ?? 0) * camera.scale + camera.x,
      y: (position?.y ?? 0) * camera.scale + camera.y,
    };
    pointerDown(host, screen.x, screen.y);
    pointerUp(host, screen.x, screen.y);
    expect(onFocus).toHaveBeenCalledWith("summit");
    document.body.removeChild(host);
  });

  it("fit eases the goal to the fit view; reset snaps the camera to it", () => {
    const host = surfaceHost(VIEWPORT);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    // Pan away, then ask for a fit.
    pointerDown(host, 100, 100);
    pointerMove(host, 400, 300);
    pointerUp(host, 400, 300);
    const panned = controller.camera;
    controller.fit();
    expect(controller.goal.x).not.toBeCloseTo(panned.x);
    controller.reset();
    expect(controller.camera).toEqual(controller.goal);
    document.body.removeChild(host);
  });

  it("dispose tears the wiring down: pointer and wheel no longer move the camera", () => {
    const host = surfaceHost(VIEWPORT);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    controller.dispose();
    const before = controller.camera;
    pointerDown(host, 100, 100);
    pointerMove(host, 200, 200);
    pointerUp(host, 200, 200);
    host.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
    expect(controller.camera).toEqual(before);
    document.body.removeChild(host);
  });

  it("remounts cleanly after dispose (map reopen) and keeps the camera", () => {
    const host = surfaceHost(VIEWPORT);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    const before = controller.camera;
    controller.dispose();
    controller.mount(host);
    expect(controller.camera).toEqual(before);
    // Wiring is live again.
    pointerDown(host, 100, 100);
    pointerMove(host, 130, 130);
    pointerUp(host, 130, 130);
    expect(controller.goal.x).not.toEqual(before.x);
    document.body.removeChild(host);
  });

  it("resize re-measures the viewport and redraws (camera stays put)", () => {
    let callback: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        constructor(cb: () => void) {
          callback = cb;
        }
      }
    );
    const host = surfaceHost(VIEWPORT);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    const before = controller.camera;
    const canvas = host.querySelector("canvas");
    expect(canvas?.width).toBe(VIEWPORT.width);
    // The surface grows; the observer fires and the backing store follows.
    Object.defineProperty(host, "clientWidth", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(host, "clientHeight", {
      value: 700,
      configurable: true,
    });
    callback?.();
    expect(canvas?.width).toBe(1000);
    expect(controller.camera).toEqual(before);
    document.body.removeChild(host);
  });

  it("honors reduced motion: the camera snaps to the goal instead of easing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "",
        addEventListener() {},
        removeEventListener() {},
      }))
    );
    const host = surfaceHost(VIEWPORT);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(baselineModel(), "mountain");
    controller.reset();
    const before = controller.camera;
    pointerDown(host, 100, 100);
    pointerMove(host, 400, 300);
    pointerUp(host, 400, 300);
    await vi.advanceTimersByTimeAsync(50);
    expect(controller.camera).toEqual(controller.goal);
    expect(controller.camera.x).toBeCloseTo(before.x + 300);
    document.body.removeChild(host);
  });

  it("accepts a theme change without re-laying out (positions persist)", () => {
    const host = surfaceHost(VIEWPORT);
    const model = baselineModel();
    addOverlayNodes(host, model);
    const controller = new MapController({ onFocus: () => {} });
    controller.mount(host);
    controller.update(model, "mountain");
    controller.update(model, "stars");
    const nodes = host.querySelectorAll(".node");
    expect(nodes.length).toBe(model.nodes.length);
    document.body.removeChild(host);
  });
});
