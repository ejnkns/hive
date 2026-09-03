/** @public — the persistent wayfinder map controller: owns the camera and its
 * easing goal, the Canvas surface (theme backdrop decor + dependency edges),
 * the camera-positioned DOM node overlays, and every pointer/wheel
 * interaction (drag pan, wheel zoom around the pointer, touch pan, pinch
 * zoom) plus fit/reset. Framework-free — the map surface element mounts it
 * once and keeps it across renders, so no camera or animation owner is
 * constructed during a Lit render. mount/update/fit/reset/dispose is the
 * whole interface (plus the shared prefersReducedMotion animation-policy
 * probe); the frame loop, listeners, and resize observer live behind
 * it and are torn down on dispose. All geometry goes through the same camera
 * (map-camera), so hit testing and drawing can never drift apart. */

import {
  camerasMatch,
  clampScale,
  createMapCamera,
  fitCamera,
  type MapCamera,
  type MapViewport,
  nearestNodeId,
  panCamera,
  screenToWorld,
  stepCamera,
  zoomAt,
} from "./map-camera.ts";
import { type MapSurfaceRender, renderMapSurface } from "./map-rendering.ts";
import type { WayfinderPosition } from "./wayfinder-layout.ts";
import {
  layoutWayfinderMap,
  layoutWayfinderMapWarm,
  wayfinderLayoutBounds,
} from "./wayfinder-layout.ts";
import type { WayfinderMap } from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";

/** The controller's callbacks into the surface. */
export type MapControllerOptions = {
  /** The surface's focus affordance (a tapped node, or a click on a node). */
  onFocus(id: string): void;
  /** A tap that hit no node — the surface dismisses a selected detail
   * (click-away/blank-map dismissal). Optional: without it, a blank tap
   * simply selects nothing. */
  onBlankTap?(): void;
};

/** The pointer-movement threshold (screen px) under which a press-release is
 * a tap (and therefore a hit test) rather than a pan. */
const TAP_MOVE_PX = 5;

/** The tap hit radius around the pointer, in screen px — fingers are wider
 * than cursors. */
const TAP_HIT_PX = 24;

/** The easing rate (per second) the camera chases its goal with. */
const EASE_RATE = 12;

/** The per-frame time step is clamped so a stalled tab (or the first frame
 * after mount) never eases in one giant jump. */
const MAX_FRAME_DT = 0.05;

const DEFAULT_STAR_COLOR = "#e6edf3";

export class MapController {
  private options: MapControllerOptions;
  private host: HTMLElement | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private ctx: CanvasRenderingContext2D | null = null;
  private map: WayfinderMap | undefined;
  private theme: ExpeditionTheme = "mountain";
  private positions: Map<string, WayfinderPosition> | undefined;
  private cameraState: MapCamera = createMapCamera();
  private goalState: MapCamera = createMapCamera();
  private fitted = false;
  private viewport: MapViewport = { width: 0, height: 0 };
  private dpr = 1;
  private reducedMotion = false;
  private starColor = DEFAULT_STAR_COLOR;
  private rafId: number | undefined;
  private lastTime = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { cx: number; cy: number; d: number } | undefined;
  private drag:
    | { pointerId: number; x: number; y: number; moved: number }
    | undefined;
  private resizeObserver: ResizeObserver | undefined;

  constructor(options: MapControllerOptions) {
    this.options = options;
  }

  /** A read-only snapshot of the current (eased) camera. */
  get camera(): MapCamera {
    return { ...this.cameraState };
  }

  /** A read-only snapshot of the camera the current camera is easing toward. */
  get goal(): MapCamera {
    return { ...this.goalState };
  }

  /** Attach the controller to the map surface: locate the canvas, wire the
   * pointer/wheel listeners and the resize observer, measure the viewport,
   * and fit the map the first time. Idempotent — remounting after dispose
   * re-wires everything and keeps the persistent camera and positions. */
  mount(host: HTMLElement): void {
    if (this.host === host) return;
    this.dispose();
    this.host = host;
    this.canvas = host.querySelector<HTMLCanvasElement>("canvas") ?? undefined;
    this.ctx = this.canvas?.getContext?.("2d") ?? null;
    this.reducedMotion = prefersReducedMotion();
    this.starColor = readComputedColor(host);
    host.addEventListener("pointerdown", this.onPointerDown);
    host.addEventListener("pointermove", this.onPointerMove);
    host.addEventListener("pointerup", this.onPointerUp);
    host.addEventListener("pointercancel", this.onPointerCancel);
    host.addEventListener("wheel", this.onWheel, { passive: false });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(host);
    }
    this.measureViewport();
    if (!this.fitted) this.fit();
    this.draw();
    this.positionOverlays();
    this.requestFrame();
  }

  /** Adopt a new model snapshot and theme. Positions persist across updates:
   * the first update lays the map out cold, later updates warm-lay only the
   * new ids (wayfinder-layout), so spatial memory survives live data. The
   * camera is untouched — a live update never yanks the view. */
  update(map: WayfinderMap, theme: ExpeditionTheme): void {
    const layoutStable = this.sameNodeIds(this.map, map);
    this.map = map;
    this.theme = theme;
    if (this.host !== undefined) this.starColor = readComputedColor(this.host);
    if (!layoutStable) {
      this.positions =
        this.positions === undefined
          ? layoutWayfinderMap(map)
          : layoutWayfinderMapWarm(map, this.positions);
    }
    if (!this.fitted) this.fit();
    this.draw();
    this.positionOverlays();
  }

  /** Ease the camera to fit the whole constellation in the viewport. */
  fit(): void {
    const camera = this.fitCamera();
    if (camera === undefined) return;
    this.fitted = true;
    this.goalState = camera;
    this.requestFrame();
  }

  /** Snap the camera straight to the fit view (no easing). */
  reset(): void {
    const camera = this.fitCamera();
    if (camera === undefined) return;
    this.fitted = true;
    this.cameraState = camera;
    this.goalState = camera;
    this.draw();
    this.positionOverlays();
  }

  /** Tear everything down: cancel the frame loop, remove the listeners,
   * disconnect the resize observer, and drop the DOM references so a fresh
   * mount re-wires cleanly. The camera and positions survive (the element
   * keeps them across open/close cycles). */
  dispose(): void {
    this.cancelFrame();
    if (this.host !== undefined) {
      this.host.removeEventListener("pointerdown", this.onPointerDown);
      this.host.removeEventListener("pointermove", this.onPointerMove);
      this.host.removeEventListener("pointerup", this.onPointerUp);
      this.host.removeEventListener("pointercancel", this.onPointerCancel);
      this.host.removeEventListener("wheel", this.onWheel);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.pointers.clear();
    this.pinch = undefined;
    this.drag = undefined;
    this.host = undefined;
    this.canvas = undefined;
    this.ctx = null;
  }

  private sameNodeIds(a: WayfinderMap | undefined, b: WayfinderMap): boolean {
    if (a === undefined || a.nodes.length !== b.nodes.length) return false;
    const ids = new Set(a.nodes.map((node) => node.id));
    return b.nodes.every((node) => ids.has(node.id));
  }

  private fitCamera(): MapCamera | undefined {
    if (this.positions === undefined) return undefined;
    const bounds = wayfinderLayoutBounds(this.positions);
    if (bounds === undefined) return undefined;
    return fitCamera(bounds, this.viewport);
  }

  private measureViewport(): void {
    if (this.host === undefined) return;
    this.viewport = {
      width: this.host.clientWidth,
      height: this.host.clientHeight,
    };
    this.dpr =
      typeof devicePixelRatio === "number" ? Math.max(1, devicePixelRatio) : 1;
    if (this.canvas !== undefined) {
      const width = Math.max(1, Math.round(this.viewport.width * this.dpr));
      const height = Math.max(1, Math.round(this.viewport.height * this.dpr));
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    const map = this.map;
    const positions = this.positions;
    if (ctx === null || map === undefined || positions === undefined) return;
    const bounds = wayfinderLayoutBounds(positions);
    if (bounds === undefined) return;
    const render: MapSurfaceRender = {
      ctx,
      camera: this.cameraState,
      viewport: this.viewport,
      bounds,
      theme: this.theme,
      map,
      positions,
      time: this.reducedMotion ? 0 : nowSeconds(),
      starColor: this.starColor,
    };
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    renderMapSurface(render);
    ctx.restore();
  }

  // Position the DOM node overlays with the same camera the canvas draws
  // with: each node's CSS variables carry its world point projected to
  // screen, and the surface's CSS composes the centering/scale transforms.
  private positionOverlays(): void {
    const host = this.host;
    const positions = this.positions;
    if (host === undefined || positions === undefined) return;
    const camera = this.cameraState;
    for (const element of host.querySelectorAll<HTMLElement>(".node")) {
      const id = element.dataset.id;
      if (id === undefined) continue;
      const position = positions.get(id);
      if (position === undefined) continue;
      const sx = position.x * camera.scale + camera.x;
      const sy = position.y * camera.scale + camera.y;
      element.style.setProperty("--node-x", `${sx.toFixed(2)}px`);
      element.style.setProperty("--node-y", `${sy.toFixed(2)}px`);
    }
  }

  private onResize(): void {
    this.measureViewport();
    this.draw();
    this.positionOverlays();
  }

  private requestFrame(): void {
    if (this.rafId !== undefined) return;
    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(this.onFrame);
    } else {
      this.rafId = setTimeout(
        () => this.onFrame(nowMs()),
        16
      ) as unknown as number;
    }
  }

  private cancelFrame(): void {
    if (this.rafId === undefined) return;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    } else {
      clearTimeout(this.rafId as unknown as ReturnType<typeof setTimeout>);
    }
    this.rafId = undefined;
  }

  private onFrame = (now: number): void => {
    this.rafId = undefined;
    const dt = Math.min(
      MAX_FRAME_DT,
      Math.max(0, (now - this.lastTime) / 1000)
    );
    this.lastTime = now;
    const rate = this.reducedMotion ? Number.POSITIVE_INFINITY : EASE_RATE;
    const next = stepCamera(this.cameraState, this.goalState, dt, rate);
    this.cameraState = next;
    this.draw();
    this.positionOverlays();
    if (!camerasMatch(this.cameraState, this.goalState)) this.requestFrame();
  };

  private onPointerDown = (event: PointerEvent): void => {
    const host = this.host;
    if (host === undefined) return;
    // Buttons (fit/reset/back) handle their own pointer; everything else —
    // including the node overlays — starts a pan so the map is draggable from
    // anywhere.
    if (
      event.target instanceof Element &&
      event.target.closest("button") !== null
    ) {
      return;
    }
    // A press that starts on a node overlay must NOT capture the pointer:
    // capture retargets the node's native click to the captured surface, so
    // the node's @click never fires and selection would fall back to the
    // proximity hit-test alone — which picks the wrong node on a dense
    // constellation. Without capture the native click on the node is the
    // exact selection path, the same path the sidebar entries use. The drag
    // still tracks (pointer events bubble from the node to the surface), so
    // the map pans when a node press moves; a drag that ends on the node it
    // started on is a click, exactly like any other clickable element.
    const onNode =
      event.target instanceof Element && event.target.closest(".node") !== null;
    if (!onNode) host.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      // A second finger turns the drag into a pinch (never a tap).
      this.pinch = pinchState(this.pointers);
      this.drag = undefined;
    } else {
      this.drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: 0,
      };
      this.pinch = undefined;
    }
    this.requestFrame();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pinch !== undefined && this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const next = pinchState(this.pointers);
      // Zoom about the OLD midpoint and land it on the NEW one — pinch and
      // two-finger pan ride the same transform.
      this.goalState = zoomAt(
        this.goalState,
        this.pinch.cx,
        this.pinch.cy,
        clampScale(this.goalState.scale * (next.d / this.pinch.d)),
        next.cx,
        next.cy
      );
      this.pinch = next;
      this.requestFrame();
      return;
    }
    const drag = this.drag;
    if (drag === undefined || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    this.goalState = panCamera(this.goalState, dx, dy);
    this.requestFrame();
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pinch !== undefined) {
      if (this.pointers.size >= 2) {
        this.pinch = pinchState(this.pointers);
        return;
      }
      // Pinch collapsed to one finger: hand off to a fresh drag, not a stale
      // one, so panning continues from the remaining finger.
      this.pinch = undefined;
      const remaining = [...this.pointers.entries()][0];
      if (remaining !== undefined) {
        const [pointerId, point] = remaining;
        this.drag = { pointerId, x: point.x, y: point.y, moved: 0 };
      }
      return;
    }
    const drag = this.drag;
    if (drag === undefined || event.pointerId !== drag.pointerId) return;
    this.drag = undefined;
    if (drag.moved >= TAP_MOVE_PX) return; // it was a pan, not a tap
    // A tap hit-tests the nearest node within reach — small targets stay
    // tappable, exactly like the reference tool. A tap that started on a node
    // overlay is followed (same task) by the node's native click, which
    // selects the exact node; the hit-test is the forgiving fallback for a
    // tap that drifted off the node, and a tap that hit no node is a blank
    // tap (the shell dismisses an open drawer).
    this.hitTest(event.clientX, event.clientY);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.pinch = undefined;
    this.drag = undefined;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0012);
    this.goalState = zoomAt(
      this.goalState,
      event.clientX,
      event.clientY,
      this.goalState.scale * factor
    );
    this.requestFrame();
  };

  // Hit test in world space through the same camera used for drawing: the tap
  // screen point is projected to world coordinates and the nearest node
  // within a finger-sized radius (converted to world units) is focused. A tap
  // that hits no node is a blank tap — reported upward so the shell can
  // dismiss an open detail drawer without navigating anywhere.
  private hitTest(sx: number, sy: number): void {
    if (this.positions === undefined) return;
    const world = screenToWorld(this.cameraState, sx, sy);
    const radius = TAP_HIT_PX / this.cameraState.scale;
    const id = nearestNodeId(this.positions, world.x, world.y, radius);
    if (id !== undefined) this.options.onFocus(id);
    else this.options.onBlankTap?.();
  }
}

function pinchState(pointers: ReadonlyMap<number, { x: number; y: number }>): {
  cx: number;
  cy: number;
  d: number;
} {
  const [a, b] = [...pointers.values()];
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
  };
}

/** Whether the user asked the OS to reduce motion. The shared animation-
 * policy probe for the wayfinder map: the controller reads it once per mount
 * (snapping the camera easing and freezing the twinkle), and the map surface
 * reads it per model change to skip the entrance/flare marks. */
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The star fill resolves the surface's computed color (the stars theme's
// light-on-dark / dark-on-light switch), read once per mount/theme change —
// not per frame.
function readComputedColor(host: HTMLElement): string {
  if (typeof getComputedStyle !== "function") return DEFAULT_STAR_COLOR;
  try {
    return getComputedStyle(host).color;
  } catch {
    return DEFAULT_STAR_COLOR;
  }
}

function nowSeconds(): number {
  return nowMs() / 1000;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}
