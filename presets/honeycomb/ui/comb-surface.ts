/** The comb surface (served component "comb-surface"): the pan/zoom
 * honeycomb map. A camera-transformed world layer carries the idea cells;
 * a screen-space overlay carries the overview hive hexes (fixed-size text
 * that stays crisp at any zoom, positioned every frame by the same camera
 * the cells ride). One pure camera (comb-camera.ts) owns every transform:
 * drag pans, the wheel zooms around the cursor, clicking a hive tweens the
 * camera to its patch, and the reset control returns to the fit-all
 * overview.
 *
 * The hexagons are flat-top (flat edges on top and bottom, points left and
 * right), clipped with a hexagon clip-path; their "border" is an inset
 * fill element showing the edge color beneath the honey fill — a clipped
 * element cannot carry a real border or box-shadow (the corners cut it).
 *
 * The overview/cells handoff is calibrated between the two navigation
 * levels: fully visible hive hexagons at the fit-all overview, fully
 * faded at the zoomed reference (the smallest patch's fit — the scale you
 * land on clicking into a hive). The two layers crossfade over a narrow
 * band around the midpoint, while the pointer-events swap sits exactly at
 * the midpoint: either the group hexagons are clickable or the cells are,
 * never both, at every scale. Zooming out from inside a hive brings the
 * group hexagons back before you are anywhere near fully zoomed out.
 *
 * The pointer/click split matters: the pointer capture that makes a drag
 * smooth is only taken once the movement exceeds the click tolerance —
 * capturing on pointerdown would retarget the subsequent click to the
 * surface (real browsers dispatch the click to the capture target), and
 * cell/hive clicks would die. The camera loop mutates transforms, hive
 * positions, and layer opacities directly each frame — lit re-renders only
 * when the map data changes. */

import type { PropertyValues } from "lit";
import type { FlowComponentDeps } from "workflow-engine/workflow-types";
import {
  type CombCamera,
  combCamerasMatch,
  combWorldToScreen,
  createCombCamera,
  fitCombCamera,
  panCombCamera,
  stepCombCamera,
  zoomCombAt,
} from "./comb-camera.ts";
import { SQRT3, type WorldPoint } from "./hex-layout.ts";
import { combBounds, hiveOverviewSize } from "./honeycomb-map.ts";
import type { CombCell, HoneycombMap } from "./shared.ts";

// A drag of at most this many pixels still counts as a click.
const DRAG_CLICK_TOLERANCE = 6;

// The public surface contract the shell syncs each render: the data props,
// the callbacks wired once at construction, and the camera control the HUD
// uses. Intersected with HTMLElement so the constructor stays assignable to
// the served ElementConstructor contract.
export type CombSurfaceElement = HTMLElement & {
  map: HoneycombMap | undefined;
  // Camera scale rides along: the detail entrance/exit must start and end
  // at the cell's ON-SCREEN size, which is the cell's world size × this.
  onCellOpen:
    | ((instanceId: string, origin: WorldPoint, cameraScale: number) => void)
    | undefined;
  /** Tween the camera back to the fit-all overview (the HUD's control). */
  resetView(): void;
};

export function createCombSurface(
  lit: FlowComponentDeps
): new () => CombSurfaceElement {
  const { LitElement: Base, html, css, utilities, nothing } = lit;

  class CombSurface extends Base {
    static properties = {
      map: { attribute: false },
      onCellOpen: { attribute: false },
    };

    static styles = [
      utilities,
      css`
      :host {
        --hex: polygon(75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%, 25% 0%);
        flex: 1;
        min-height: 0;
        /* Own margin (not the shell's padding) so the detail overlay —
           which carries the same --comb-inset margin — shares exactly
           this box's coordinate space. */
        margin: 0 var(--comb-inset, 16px) var(--comb-inset, 16px);
        display: block;
        position: relative;
        overflow: hidden;
        border: 1px solid var(--hc-edge, #3d2c14);
        border-radius: 14px;
        background: var(--hc-comb-backdrop, #191106);
        font-family: var(--hc-font, system-ui, sans-serif);
        touch-action: none;
        cursor: grab;
        user-select: none;
      }
      :host([dragging]) {
        cursor: grabbing;
      }
      .world,
      .hives {
        position: absolute;
        inset: 0;
      }
      .world {
        transform-origin: 0 0;
        will-change: transform;
      }
      .hives {
        pointer-events: none;
      }
      .cell,
      .hive {
        position: absolute;
        box-sizing: border-box;
        clip-path: var(--hex);
      }
      .cell {
        cursor: pointer;
      }
      /* The hover sheen sits ABOVE the title text (pointer-events none):
         putting it beneath the text would change the text's backdrop from
         opaque to translucent on hover, and Chrome switches subpixel text
         antialiasing off over translucent backdrops — the text visibly
         "jumps". A wash over the text keeps the backdrop opaque. */
      .cell::after {
        content: "";
        position: absolute;
        inset: 2px;
        z-index: 2;
        pointer-events: none;
        background: rgba(255, 243, 214, 0.22);
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .cell:hover::after {
        opacity: 1;
      }
      .fill {
        position: absolute;
        inset: 2px;
        clip-path: var(--hex);
        pointer-events: none;
      }
      .cell-title {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 12px;
        line-height: 1.25;
        color: var(--hc-ink, #f4e9d0);
        padding: 0 13%;
        overflow: hidden;
        pointer-events: none;
      }
      .cell-title span {
        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      /* Status → honey fill, two layers: the cell's own background is the
         edge color (the visible "border" between the clipped fill and the
         hexagon edge), the inset fill is the honey. */
      .cell.status-backlog {
        background: var(--wax-edge, #4a3618);
      }
      .cell.status-backlog .fill {
        background: var(--wax-empty, #2a1e0e);
      }
      .cell.status-in-progress {
        background: var(--wax-edge, #4a3618);
      }
      .cell.status-in-progress .fill {
        background: linear-gradient(
          to top,
          var(--honey, #e8a020) 0%,
          var(--honey, #e8a020) 46%,
          var(--wax-empty, #2a1e0e) 46%
        );
      }
      .cell.status-done {
        background: var(--honey-edge, #b97a10);
      }
      .cell.status-done .fill {
        background: var(--honey, #e8a020);
      }
      .cell.status-blocked {
        background: var(--honey-crystal-edge, #a04a2a);
      }
      .cell.status-blocked .fill {
        background: var(--honey-crystal, #4a3326);
      }
      .cell.status-parked {
        background: var(--wax-edge, #4a3618);
        opacity: 0.35;
      }
      .cell.status-parked .fill {
        background: var(--wax-empty, #2a1e0e);
      }
      .hive {
        transform: translate(-50%, -50%);
        cursor: pointer;
      }
      .hive::after {
        content: "";
        position: absolute;
        inset: 2px;
        z-index: 2;
        pointer-events: none;
        background: rgba(255, 243, 214, 0.22);
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .hive:hover::after {
        opacity: 1;
      }
      .hive-inner {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        color: var(--hc-ink, #f4e9d0);
        font-size: 15px;
        text-align: center;
        padding: 0 18%;
        pointer-events: none;
      }
      .hive-label {
        font-weight: 650;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow-wrap: break-word;
        max-width: 100%;
      }
      .hive-count {
        opacity: 0.75;
        font-size: 0.8em;
      }
      .reset {
        position: absolute;
        right: 14px;
        bottom: 14px;
        z-index: 2;
        border: 1px solid var(--hc-edge, #3d2c14);
        background: color-mix(in srgb, var(--hc-paper, #241a0c) 85%, transparent);
        color: var(--hc-body, #b39b72);
        font: inherit;
        font-size: 13px;
        padding: 6px 14px;
        border-radius: 999px;
        cursor: pointer;
      }
      .reset:hover {
        color: var(--hc-ink, #f4e9d0);
      }
      .reset[hidden] {
        display: none;
      }
    `,
    ];

    declare map: HoneycombMap | undefined;
    declare onCellOpen:
      | ((instanceId: string, origin: WorldPoint, cameraScale: number) => void)
      | undefined;

    // The camera and its goal; `goalKind` tracks what the goal is, and
    // `userMoved` latches a manual pan/zoom so new map data never yanks
    // the camera back while the user is navigating themselves.
    private camera = createCombCamera();
    private goal: CombCamera = createCombCamera();
    private goalKind: "fit" | "hive" = "fit";
    private userMoved = false;
    private focusedHiveId: string | undefined;
    private fitScale = 1;
    // The camera scale at which the cells are fully visible: the smallest
    // hive's patch fit — the click-into-a-hive scale — clamped within about
    // one zoom step of the overview, so the hive→cell cross-fade plays
    // across the band between the two navigation levels instead of hanging
    // on the fit-all scale.
    private cellsAtScale = 2;
    private viewportMeasured = false;

    // Interaction state: `dragged` latches once a gesture becomes a drag
    // (the pointer capture is taken at that moment), and survives the
    // pointerup so the trailing click can be ignored.
    private dragged = false;
    private dragDistance = 0;
    private captured = false;
    private lastPointer: { x: number; y: number } | undefined;

    // The animation loop handle and the cached elements the loop drives.
    private frame = 0;
    private lastFrameTime = 0;
    private worldEl: HTMLElement | undefined;
    private cellLayer: HTMLElement | undefined;
    private hiveLayer: HTMLElement | undefined;
    private resetEl: HTMLElement | undefined;
    private hiveEls = new Map<string, HTMLElement>();
    private resizeObserver: ResizeObserver | undefined;

    connectedCallback(): void {
      super.connectedCallback();
      // Bind before adding: the handlers are prototype methods. Pointer
      // events live on the host (pan/zoom); clicks are caught on the shadow
      // root, because a host listener would miss them once a drag's pointer
      // capture retargets — and the shadow root is where the rendered
      // children's clicks bubble.
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);
      this.onWheel = this.onWheel.bind(this);
      this.onClick = this.onClick.bind(this);
      this.addEventListener("pointerdown", this.onPointerDown);
      this.addEventListener("pointermove", this.onPointerMove);
      this.addEventListener("pointerup", this.onPointerUp);
      this.addEventListener("wheel", this.onWheel, { passive: false });
    }

    disconnectedCallback(): void {
      super.disconnectedCallback();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.resizeObserver?.disconnect();
      this.resizeObserver = undefined;
      this.removeEventListener("pointerdown", this.onPointerDown);
      this.removeEventListener("pointermove", this.onPointerMove);
      this.removeEventListener("pointerup", this.onPointerUp);
      this.removeEventListener("wheel", this.onWheel);
      const shadowRoot = this.shadowRoot;
      if (shadowRoot !== null) {
        shadowRoot.removeEventListener("click", this.onClick);
      }
    }

    protected override updated(changedProperties: PropertyValues<this>): void {
      super.updated(changedProperties);
      this.cacheElements();
      if (changedProperties.has("map")) {
        // New map data: re-frame only while the user has not taken over the
        // camera — re-fit the overview, or re-frame the hive they are inside.
        if (!this.userMoved) {
          if (this.goalKind === "fit") {
            this.applyFit(true);
          } else if (this.focusedHiveId !== undefined) {
            this.focusHive(this.focusedHiveId);
          }
        }
      }
      this.startLoop();
    }

    protected firstUpdated(): void {
      // Cell/hive clicks bubble within the shadow root (rendered children
      // are replaced per render, so the root — not the children — carries
      // the listener).
      const shadowRoot = this.shadowRoot;
      if (shadowRoot !== null) {
        shadowRoot.addEventListener("click", this.onClick);
      }
      // jsdom (the test environment) has no ResizeObserver; the viewport
      // re-fit then only happens on map changes.
      if (typeof ResizeObserver === "undefined") return;
      this.resizeObserver = new ResizeObserver(() => {
        this.applyFit(this.goalKind === "fit");
      });
      this.resizeObserver.observe(this);
    }

    // Grab the elements the camera loop drives out of the fresh render.
    private cacheElements(): void {
      const root = this.renderRoot;
      this.worldEl = root.querySelector<HTMLElement>(".world") ?? undefined;
      this.cellLayer = root.querySelector<HTMLElement>(".cells") ?? undefined;
      this.hiveLayer = root.querySelector<HTMLElement>(".hives") ?? undefined;
      this.resetEl = root.querySelector<HTMLElement>(".reset") ?? undefined;
      const hives = new Map<string, HTMLElement>();
      root.querySelectorAll<HTMLElement>("[data-hive]").forEach((el) => {
        const id = el.getAttribute("data-hive");
        if (id !== null) hives.set(id, el);
      });
      this.hiveEls = hives;
    }

    /** Recompute the camera references from the current map + viewport:
     * the fit-all overview (framing the representative hive hexagons) and
     * the zoomed reference (the smallest patch fit — the scale you land on
     * clicking into a hive). When `retarget`, the goal (and, before the
     * first measured viewport, the camera itself — snapping the initial
     * view rather than animating from the default) moves to the overview. */
    private applyFit(retarget: boolean): void {
      const map = this.map;
      if (map === undefined) return;
      const bounds = combBounds(map);
      const viewport = { width: this.clientWidth, height: this.clientHeight };
      const fit =
        bounds !== undefined ? fitCombCamera(bounds, viewport, 60) : undefined;
      if (fit === undefined) return;
      this.fitScale = fit.scale;
      // The zoomed reference: the scale where the smallest patch is framed
      // — the scale you land on clicking any hive — clamped so the fade
      // band stays within ~2.2× of the overview even when one hive is much
      // larger than the rest.
      const patchFits = map.hives
        .map(
          (hive) =>
            fitCombCamera(
              {
                minX: hive.x - hive.patchRadius,
                minY: hive.y - hive.patchRadius,
                maxX: hive.x + hive.patchRadius,
                maxY: hive.y + hive.patchRadius,
              },
              viewport,
              30
            )?.scale
        )
        .filter((scale): scale is number => scale !== undefined);
      const patchMin =
        patchFits.length > 0 ? Math.min(...patchFits) : this.fitScale;
      this.cellsAtScale = Math.max(
        this.fitScale * 1.25,
        Math.min(patchMin, this.fitScale * 2.2)
      );
      if (retarget) {
        if (!this.viewportMeasured) {
          this.camera = fit;
          this.viewportMeasured = true;
        }
        this.goal = fit;
        this.goalKind = "fit";
        this.userMoved = false;
        this.applyCameraFrame();
      }
    }

    private startLoop(): void {
      if (this.frame !== 0) return;
      this.lastFrameTime = performance.now();
      const step = (now: number): void => {
        const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
        this.lastFrameTime = now;
        if (!combCamerasMatch(this.camera, this.goal)) {
          this.camera = stepCombCamera(this.camera, this.goal, dt);
          this.applyCameraFrame();
        }
        this.frame = requestAnimationFrame(step);
      };
      this.frame = requestAnimationFrame(step);
    }

    /** One camera frame: the world transform, the hive positions, the
     * overview cross-fade, and the reset control all read the same camera. */
    private applyCameraFrame(): void {
      const world = this.worldEl;
      if (world === undefined) return;
      const { x, y, scale } = this.camera;
      world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      const map = this.map;
      if (map === undefined) return;
      // The layer handoff: a NARROW crossfade around the band's midpoint,
      // with the pointer handoff still at the exact midpoint — so the
      // transition between the two states is animated, but the two states
      // are never both clickable, and the crossfade is over before either
      // layer is meaningfully interactive at a mixed opacity.
      const midpoint = (this.fitScale + this.cellsAtScale) / 2;
      const fadeHalf = (this.cellsAtScale - this.fitScale) * 0.12;
      const cellsOn = scale >= midpoint;
      const mix = Math.max(
        0,
        Math.min(1, (scale - (midpoint - fadeHalf)) / (fadeHalf * 2))
      );
      if (this.cellLayer !== undefined) {
        this.cellLayer.style.opacity = `${mix}`;
        this.cellLayer.style.pointerEvents = cellsOn ? "auto" : "none";
      }
      if (this.hiveLayer !== undefined) {
        this.hiveLayer.style.opacity = `${1 - mix}`;
        this.hiveLayer.style.pointerEvents = cellsOn ? "none" : "auto";
      }
      // The reset control shows while the camera is meaningfully zoomed
      // past the fit-all overview (the user is inside a hive).
      if (this.resetEl !== undefined) {
        this.resetEl.hidden = scale <= this.fitScale * 1.05;
      }
      for (const hive of map.hives) {
        const el = this.hiveEls.get(hive.id);
        if (el === undefined) continue;
        const screen = combWorldToScreen(this.camera, hive.x, hive.y);
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
        const size = hiveOverviewSize(hive) * scale;
        el.style.width = `${size * 2}px`;
        el.style.height = `${size * SQRT3}px`;
      }
    }

    /** Tween the camera to frame one hive's patch bounds. */
    focusHive(hiveId: string): void {
      const hive = this.map?.hives.find((h) => h.id === hiveId);
      if (hive === undefined) return;
      const fit = fitCombCamera(
        {
          minX: hive.x - hive.patchRadius,
          minY: hive.y - hive.patchRadius,
          maxX: hive.x + hive.patchRadius,
          maxY: hive.y + hive.patchRadius,
        },
        { width: this.clientWidth, height: this.clientHeight },
        30
      );
      if (fit === undefined) return;
      this.goal = fit;
      this.goalKind = "hive";
      this.focusedHiveId = hiveId;
      this.userMoved = false;
    }

    /** Tween the camera back to the fit-all overview. */
    resetView(): void {
      this.userMoved = false;
      this.applyFit(true);
    }

    private onPointerDown(event: Event): void {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      this.dragged = false;
      this.dragDistance = 0;
      this.captured = false;
      this.lastPointer = { x: event.clientX, y: event.clientY };
    }

    private onPointerMove(event: Event): void {
      if (!(event instanceof PointerEvent) || this.lastPointer === undefined) {
        return;
      }
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.dragDistance += Math.hypot(dx, dy);
      if (this.dragDistance <= DRAG_CLICK_TOLERANCE) return;
      // Now it is a drag, not a click: latch the flags (the trailing click
      // must be ignored, and map changes must never yank the camera back)
      // and only now take the capture that keeps the pan smooth outside
      // the surface.
      this.dragged = true;
      this.userMoved = true;
      this.setAttribute("dragging", "");
      if (!this.captured && this.hasPointerCapture(event.pointerId) === false) {
        try {
          this.setPointerCapture(event.pointerId);
          this.captured = true;
        } catch {
          // Capture is a smoothness nicety; panning works without it.
        }
      }
      this.camera = panCombCamera(this.camera, dx, dy);
      this.goal = this.camera;
      this.applyCameraFrame();
    }

    private onPointerUp(event: Event): void {
      if (!(event instanceof PointerEvent)) return;
      this.lastPointer = undefined;
      if (this.captured) {
        try {
          this.releasePointerCapture(event.pointerId);
        } catch {
          // The capture may already be gone.
        }
      }
      this.captured = false;
      this.removeAttribute("dragging");
    }

    private onWheel(event: Event): void {
      if (!(event instanceof WheelEvent)) return;
      event.preventDefault();
      const rect = this.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0012);
      this.camera = zoomCombAt(
        this.camera,
        event.clientX - rect.left,
        event.clientY - rect.top,
        this.camera.scale * factor
      );
      this.goal = this.camera;
      this.userMoved = true;
      this.applyCameraFrame();
    }

    private onClick(event: Event): void {
      if (this.dragged) {
        this.dragged = false;
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const hiveEl = target.closest("[data-hive]");
      if (hiveEl instanceof Element) {
        this.focusHive(hiveEl.getAttribute("data-hive") ?? "");
        return;
      }
      const cellEl = target.closest("[data-cell]");
      if (cellEl instanceof Element) {
        const id = cellEl.getAttribute("data-cell");
        const opened = this.map?.hives
          .flatMap((hive) => hive.cells)
          .find((cell) => cell.id === id);
        if (opened !== undefined) {
          this.onCellOpen?.(
            opened.id,
            combWorldToScreen(this.camera, opened.x, opened.y),
            this.camera.scale
          );
        }
      }
    }

    render() {
      const map = this.map;
      if (map === undefined) return nothing;
      return html`
        <div class="world">
          <div class="cells">
            ${map.hives.flatMap((hive) =>
              hive.cells.map((cell) => this.renderCell(cell))
            )}
          </div>
        </div>
        <div class="hives">
          ${map.hives.map((hive, hiveIndex) => this.renderHive(hive, hiveIndex))}
        </div>
        <button class="reset" hidden @click=${() => this.resetView()}>
          Whole hive
        </button>
      `;
    }

    private renderHive(hive: HoneycombMap["hives"][number], index: number) {
      const size = hiveOverviewSize(hive);
      const hue = 36 + index * 7;
      return html`
        <div
          class="hive"
          data-hive=${hive.id}
          style="left:0;top:0;background:hsl(${hue} 70% 30%);width:${size * 2}px;height:${size * SQRT3}px"
        >
          <div class="fill" style="background:hsl(${hue} 55% 24%)"></div>
          <div class="hive-inner">
            <span class="hive-label">${hive.label}</span>
            <span class="hive-count"
              >${hive.cells.length}
              ${hive.cells.length === 1 ? "idea" : "ideas"}</span
            >
          </div>
        </div>
      `;
    }

    private renderCell(cell: CombCell) {
      const scale = this.map?.cellScale ?? 58;
      return html`
        <div
          class="cell status-${cell.status}"
          data-cell=${cell.id}
          style="left:${cell.x - scale}px;top:${
            cell.y - (SQRT3 * scale) / 2
          }px;width:${scale * 2}px;height:${SQRT3 * scale}px"
          title=${cell.title}
        >
          <div class="fill"></div>
          <span class="cell-title"><span>${cell.title}</span></span>
        </div>
      `;
    }
  }

  return CombSurface;
}
