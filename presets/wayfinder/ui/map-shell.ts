/** The wayfinder map shell (served-module sibling of the flow component): the
 * map-first presentation — a restrained HUD (flow identity, destination,
 * derived counts, charted progress, legend, flow actions, Fit/Reset map
 * controls, and the Map/Table toggle) above the persistent full-map surface
 * (map-canvas.ts, composed by constructor). The entry keeps ONE MapShell
 * instance across renders; MapShell keeps the one MapCanvas instance, so the
 * camera and animation owner live in the same place across view switches.
 * The HUD renders from the shared presentation model's derived counts — the
 * frontier number is the blockers-closed frontier, never a recount of `ready`
 * WorkflowItems.
 *
 * The shell also owns the in-context detail drawer: a durable `selectedId`
 * separate from the transient hover/focus pulse, set when a node is engaged
 * (click/tap/Enter) and cleared by the close button, Escape, a blank-map
 * tap, or the selected WorkflowItem disappearing from a later snapshot. The
 * drawer (wayfinder-drawer.ts, composed by constructor) renders the derived
 * detail over the map body while a selection is active; blocker/dependent
 * chips navigate the selection without ever leaving the map. Local map
 * selection is the shell's own seam — the flow's route-oriented `onSelect`
 * is never used for it. */

import type { WorkflowDefResponse } from "workflow-engine/create-flow-runtime";
import type {
  FlowActionView,
  FlowComponentDeps,
  FlowViewProps,
} from "workflow-engine/workflow-types";
import type { MapCanvasElement } from "./map-canvas.ts";
import type { WayfinderView } from "./shared.ts";
import type { WayfinderDrawerElement } from "./wayfinder-drawer.ts";
import {
  type DrawerDetail,
  deriveDrawerDetail,
} from "./wayfinder-drawer-model.ts";
import type { WayfinderCounts, WayfinderMap } from "./wayfinder-map.ts";
import { wayfinderProgress } from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";

// The entries slice of the flow-view props (kept as a named alias so the
// contract below reads tightly).
type FlowViewPropsEntries = FlowViewProps["entries"];

// The public shell contract the entry syncs each render: the HUD data
// (identity, model, theme, actions), the entries/definitions/persisted
// payloads the drawer reads, the hover/focus ids forwarded to the surface,
// and the callbacks wired once at construction. Intersected with HTMLElement
// so the constructor type stays assignable to the served ElementConstructor
// contract.
export type MapShellElement = HTMLElement & {
  flowLabel: string;
  flowStatus: string;
  model: WayfinderMap;
  theme: ExpeditionTheme;
  entries: FlowViewPropsEntries;
  workflowDefs: readonly WorkflowDefResponse[];
  persistedOutputDirs: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  availableFlowActions: readonly FlowActionView[];
  hoverId: string | undefined;
  focusId: string | undefined;
  onCreate: ((actionId: string) => void) | undefined;
  onFlowAction: ((actionId: string) => void) | undefined;
  onHover: ((id: string | undefined) => void) | undefined;
  onFocus: ((id: string) => void) | undefined;
  onAction: ((id: string, actionId: string) => void) | undefined;
  onSendMessage: ((id: string, content: string) => Promise<void>) | undefined;
  onViewChange: ((view: WayfinderView) => void) | undefined;
};

export function createMapShell(options: {
  lit: FlowComponentDeps;
  // The one full-map surface class the entry registered: the shell constructs
  // it by constructor, so the constructed class must be the registered one.
  MapCanvas: new () => MapCanvasElement;
  // The in-context detail drawer class, likewise composed by constructor.
  Drawer: new () => WayfinderDrawerElement;
}): new () => MapShellElement {
  const { lit, MapCanvas, Drawer } = options;
  const { LitElement: Base, html, css, nothing } = lit;

  class MapShell extends Base {
    static properties = {
      flowLabel: { attribute: false },
      flowStatus: { attribute: false },
      model: { attribute: false },
      theme: { type: String, reflect: true, attribute: "data-theme" },
      entries: { attribute: false },
      workflowDefs: { attribute: false },
      persistedOutputDirs: { attribute: false },
      availableFlowActions: { attribute: false },
      hoverId: { attribute: false },
      focusId: { attribute: false },
      // The durable drawer selection: internal to the shell (not part of the
      // public contract), kept across re-renders and view switches.
      selectedId: { attribute: false },
      onCreate: { attribute: false },
      onFlowAction: { attribute: false },
      onHover: { attribute: false },
      onFocus: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
      onViewChange: { attribute: false },
    };

    static styles = css`
      :host {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      @media (max-width: 900px) {
        :host {
          flex: none;
        }
      }

      /* The map body hosts the surface and the in-context detail drawer: the
         drawer is absolutely positioned against it (right side on desktop,
         bottom sheet on narrow viewports), so the map stays visible behind
         it. */
      .map-body {
        flex: 1;
        min-height: 0;
        display: flex;
        position: relative;
      }
      @media (max-width: 900px) {
        .map-body {
          flex: none;
        }
      }

      .hud {
        flex-shrink: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.45rem 1rem;
        padding: 0.55rem 0.85rem;
        border: 1px solid var(--wf-paper-edge);
        border-radius: 12px;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--wf-paper) 92%, white 8%),
          var(--wf-paper)
        );
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
      }
      .hud-identity {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
      }
      .emblem {
        color: var(--wf-accent);
        font-size: 1.1rem;
        line-height: 1;
      }
      .title-group {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        min-width: 0;
      }
      .title {
        font-size: 0.82rem;
        font-weight: 700;
        color: var(--wf-ink);
      }
      .status {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .dest {
        font-size: 0.68rem;
        color: var(--wf-body);
        border-left: 1px solid var(--wf-paper-edge);
        padding-left: 0.6rem;
        max-width: 32ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hud-status {
        flex: 1;
        min-width: 260px;
        display: flex;
        flex-direction: column;
        gap: 0.32rem;
      }
      .hud-counts {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
      }
      .chip {
        font-size: 0.6rem;
        letter-spacing: 0.04em;
        color: var(--wf-body);
        border: 1px solid var(--wf-paper-edge);
        border-radius: 999px;
        padding: 0.1rem 0.55rem;
        background: color-mix(in srgb, var(--wf-paper-edge) 30%, transparent);
      }
      .chip.frontier {
        color: var(--wf-accent);
        border-color: color-mix(in srgb, var(--wf-accent) 55%, transparent);
      }

      .hud-progress {
        display: flex;
        align-items: center;
        gap: 0.55rem;
      }
      .bar-track {
        flex: 1;
        height: 7px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--wf-paper-edge) 65%, transparent);
        overflow: hidden;
      }
      .bar {
        display: block;
        height: 100%;
        border-radius: 4px;
        background: linear-gradient(
          90deg,
          var(--wf-accent),
          color-mix(in srgb, var(--wf-accent) 70%, white)
        );
      }
      .progress-label {
        font-size: 0.6rem;
        color: var(--wf-body);
        white-space: nowrap;
      }

      .hud-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.6rem;
        color: var(--wf-body);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .dot.frontier {
        background: var(--wf-accent);
      }
      .dot.blocked {
        background: #d0b3b3;
      }
      .dot.active {
        background: #d29922;
      }
      .dot.decision {
        background: #3fb950;
      }

      .hud-tools {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .hud-map-controls {
        display: flex;
        gap: 0.3rem;
      }
      .hud-map-controls button {
        font: inherit;
        font-size: 0.62rem;
        padding: 0.26rem 0.55rem;
        border-radius: 6px;
        border: 1px solid var(--wf-paper-edge);
        background: color-mix(in srgb, var(--wf-paper-edge) 40%, transparent);
        color: var(--wf-ink);
        cursor: pointer;
      }
      .hud-map-controls button:hover {
        border-color: var(--wf-accent);
        color: var(--wf-accent);
      }

      .hud-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .hud-actions button {
        font-family: inherit;
        font-size: 0.62rem;
        height: 26px;
        padding: 0 0.55rem;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        cursor: pointer;
      }
      .hud-actions button.primary {
        background: var(--success);
        color: var(--bg);
        border-color: transparent;
      }
      .hud-actions button.destructive {
        background: var(--error);
        color: white;
        border-color: transparent;
      }

      .view-toggle {
        display: inline-flex;
        border: 1px solid var(--wf-paper-edge);
        border-radius: 7px;
        overflow: hidden;
      }
      .view-toggle button {
        font: inherit;
        font-size: 0.62rem;
        padding: 0.28rem 0.6rem;
        border: none;
        background: transparent;
        color: var(--wf-body);
        cursor: pointer;
      }
      .view-toggle button.active {
        background: var(--wf-accent);
        color: var(--bg);
      }
    `;

    declare flowLabel: string;
    declare flowStatus: string;
    declare model: WayfinderMap;
    declare theme: ExpeditionTheme;
    declare entries: FlowViewPropsEntries;
    declare workflowDefs: readonly WorkflowDefResponse[];
    declare persistedOutputDirs: Readonly<
      Record<string, Readonly<Record<string, string>>>
    >;
    declare availableFlowActions: readonly FlowActionView[];
    declare hoverId: string | undefined;
    declare focusId: string | undefined;
    declare selectedId: string | undefined;
    declare onCreate: ((actionId: string) => void) | undefined;
    declare onFlowAction: ((actionId: string) => void) | undefined;
    declare onHover: ((id: string | undefined) => void) | undefined;
    declare onFocus: ((id: string) => void) | undefined;
    declare onAction: ((id: string, actionId: string) => void) | undefined;
    declare onSendMessage:
      | ((id: string, content: string) => Promise<void>)
      | undefined;
    declare onViewChange: ((view: WayfinderView) => void) | undefined;

    // The persistent map surface: constructed once and kept across renders
    // (and across view switches), so the camera and animation owner live in
    // one place. Referenced by constructor — never by tag.
    private mapView: MapCanvasElement | undefined;

    // The persistent in-context detail drawer: constructed once, attached
    // while a selection is active, detached when the selection clears.
    private drawer: WayfinderDrawerElement | undefined;

    // The derived drawer detail: recomputed in willUpdate from the current
    // selection + snapshot (derived state never lives in render).
    private drawerDetail: DrawerDetail | undefined;

    protected override willUpdate(): void {
      this.drawerDetail =
        this.selectedId === undefined
          ? undefined
          : deriveDrawerDetail({
              selectedId: this.selectedId,
              model: this.model,
              entries: this.entries,
              workflowDefs: this.workflowDefs,
              persistedOutputDirs: this.persistedOutputDirs,
            });
    }

    protected override updated(): void {
      // A live update can remove the selected WorkflowItem from the snapshot:
      // clear the selection so the drawer closes gracefully instead of
      // holding a ghost id. (The drawer also degrades to nothing on its own.)
      if (
        this.selectedId !== undefined &&
        this.model !== undefined &&
        !this.model.nodes.some((node) => node.id === this.selectedId)
      ) {
        this.selectedId = undefined;
      }
      // The persistent children are synced after every render (data flows
      // down; the callbacks are wired once at creation). Unused props stay
      // on the instance until its view renders.
      const view = this.mapView;
      if (view !== undefined) {
        view.model = this.model;
        view.theme = this.theme;
        view.hoverId = this.hoverId;
        view.focusId = this.focusId;
        view.selectedId = this.selectedId;
      }
      const drawer = this.drawer;
      if (drawer !== undefined) {
        drawer.detail = this.drawerDetail;
      }
    }

    private ensureMapView(): MapCanvasElement {
      const existing = this.mapView;
      if (existing !== undefined) return existing;
      const view: MapCanvasElement = new MapCanvas();
      view.onHover = (id) => this.onHover?.(id);
      // Engaging a node (click/tap/Enter) pulses it AND makes it the durable
      // selection — the drawer opens, the map keeps the node highlighted.
      view.onFocus = (id) => {
        this.onFocus?.(id);
        this.selectNode(id);
      };
      view.onBlankTap = () => this.clearSelection();
      this.mapView = view;
      return view;
    }

    private ensureDrawer(): WayfinderDrawerElement {
      const existing = this.drawer;
      if (existing !== undefined) return existing;
      const drawer: WayfinderDrawerElement = new Drawer();
      drawer.onClose = () => this.clearSelection();
      drawer.onNavigate = (id) => {
        this.selectNode(id);
        // Re-focus the newly selected node so the map highlight follows the
        // navigation (the pulse is transient; the selection persists).
        this.onFocus?.(id);
      };
      drawer.onAction = (id, actionId) => this.onAction?.(id, actionId);
      drawer.onSendMessage = async (id, content) => {
        await this.onSendMessage?.(id, content);
      };
      this.drawer = drawer;
      return drawer;
    }

    // The durable selection: distinct from the short-lived hover/focus pulse.
    private selectNode(id: string) {
      this.selectedId = id;
    }

    // Dismiss the drawer: the close button, Escape, or a blank-map tap.
    private clearSelection() {
      this.selectedId = undefined;
    }

    render() {
      if (this.model === undefined) return nothing;
      return html`${this.renderHud()}
        <div class="map-body">
          ${this.ensureMapView()}
          ${this.drawerDetail === undefined ? nothing : this.ensureDrawer()}
        </div>`;
    }

    private renderHud() {
      const counts = this.model.counts;
      const progress = wayfinderProgress(counts);
      return html`<div class="hud">
        <div class="hud-identity">
          <span class="emblem">▲</span>
          <div class="title-group">
            <span class="title">${this.flowLabel}</span>
            <span class="status">${this.flowStatus}</span>
          </div>
          <span class="dest">${this.model.destination}</span>
        </div>
        <div class="hud-status">
          <div class="hud-counts">
            ${HUD_CHIPS.map((chip) =>
              counts[chip.status] === 0
                ? nothing
                : html`<span class="chip ${chip.status}"
                      >${counts[chip.status]} ${chip.label}</span
                    >`
            )}
          </div>
          <div
            class="hud-progress"
            role="progressbar"
            aria-label="charted"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow=${progress}
          >
            <span class="bar-track"><span class="bar" style=${`width:${progress}%`}></span></span>
            <span class="progress-label">${progress}% charted</span>
          </div>
          <div class="hud-legend">
            ${HUD_LEGEND.map(
              (item) => html`<span class="legend-item"
                ><i class="dot ${item.status}"></i>${item.label}</span
              >`
            )}
          </div>
        </div>
        <div class="hud-tools">
          <div class="hud-map-controls">
            <button
              class="fit"
              type="button"
              title="Fit the whole map into view"
              @click=${() => this.mapView?.fit()}
            >
              Fit
            </button>
            <button
              class="reset"
              type="button"
              title="Snap back to the fitted view"
              @click=${() => this.mapView?.reset()}
            >
              Reset
            </button>
          </div>
          <div class="hud-actions">
            ${this.availableFlowActions.map((action) => {
              const onClick =
                action.createInstance !== undefined
                  ? () => this.onCreate?.(action.id)
                  : () => this.onFlowAction?.(action.id);
              return html`<button
                class=${action.variant}
                type="button"
                @click=${onClick}
              >
                ${action.label}
              </button>`;
            })}
          </div>
          <div class="view-toggle" role="group" aria-label="Expedition view">
            <button class="active" type="button" aria-pressed="true">
              Map
            </button>
            <button
              type="button"
              aria-pressed="false"
              @click=${() => this.onViewChange?.("table")}
            >
              Table
            </button>
          </div>
        </div>
      </div>`;
    }
  }

  return MapShell;
}

// The HUD count chips in journey order. Every chip renders only when its
// count is non-zero — a sparse expedition stays restrained instead of
// printing a row of zeros. Out-of-scope and implementation sit at the end so
// an empty category never crowds the journey chips.
const HUD_CHIPS: ReadonlyArray<{
  status: keyof WayfinderCounts;
  label: string;
}> = [
  { status: "fog", label: "fog" },
  { status: "frontier", label: "frontier" },
  { status: "blocked", label: "blocked" },
  { status: "active", label: "active" },
  { status: "decision", label: "decision" },
  { status: "out-of-scope", label: "out of scope" },
  { status: "implementation", label: "implementation" },
];

// The HUD legend: the journey statuses with their marker colours. The text
// labels carry the meaning — colour is an accent, never the only signal.
const HUD_LEGEND: ReadonlyArray<{
  status: keyof WayfinderCounts;
  label: string;
}> = [
  { status: "frontier", label: "frontier" },
  { status: "blocked", label: "blocked" },
  { status: "active", label: "active" },
  { status: "decision", label: "decision" },
];
