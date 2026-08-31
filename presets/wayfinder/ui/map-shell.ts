/** The wayfinder map shell (served-module sibling of the flow component): the
 * map-first presentation — a restrained HUD (flow identity, destination,
 * derived counts, charted progress, legend, flow actions, Fit/Reset map
 * controls, and the Map/Table toggle) above the persistent full-map surface
 * (map-canvas.ts, composed by constructor). The entry keeps ONE MapShell
 * instance across renders; MapShell keeps the one MapCanvas instance, so the
 * camera and animation owner live in the same place across view switches.
 * The HUD renders from the shared presentation model's derived counts — the
 * frontier number is the blockers-closed frontier, never a recount of `ready`
 * WorkflowItems. */

import type {
  FlowActionView,
  FlowComponentDeps,
} from "workflow-engine/workflow-types";
import type { MapCanvasElement } from "./map-canvas.ts";
import type { WayfinderView } from "./shared.ts";
import type { WayfinderCounts, WayfinderMap } from "./wayfinder-map.ts";
import { wayfinderProgress } from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";

// The public shell contract the entry syncs each render: the HUD data
// (identity, model, theme, actions), the hover/focus ids forwarded to the
// surface, and the callbacks wired once at construction. Intersected with
// HTMLElement so the constructor type stays assignable to the served
// ElementConstructor contract.
export type MapShellElement = HTMLElement & {
  flowLabel: string;
  flowStatus: string;
  model: WayfinderMap;
  theme: ExpeditionTheme;
  availableFlowActions: readonly FlowActionView[];
  hoverId: string | undefined;
  focusId: string | undefined;
  onCreate: ((actionId: string) => void) | undefined;
  onFlowAction: ((actionId: string) => void) | undefined;
  onHover: ((id: string | undefined) => void) | undefined;
  onFocus: ((id: string) => void) | undefined;
  onViewChange: ((view: WayfinderView) => void) | undefined;
};

export function createMapShell(options: {
  lit: FlowComponentDeps;
  // The one full-map surface class the entry registered: the shell constructs
  // it by constructor, so the constructed class must be the registered one.
  MapCanvas: new () => MapCanvasElement;
}): new () => MapShellElement {
  const { lit, MapCanvas } = options;
  const { LitElement: Base, html, css, nothing } = lit;

  class MapShell extends Base {
    static properties = {
      flowLabel: { attribute: false },
      flowStatus: { attribute: false },
      model: { attribute: false },
      theme: { type: String, reflect: true, attribute: "data-theme" },
      availableFlowActions: { attribute: false },
      hoverId: { attribute: false },
      focusId: { attribute: false },
      onCreate: { attribute: false },
      onFlowAction: { attribute: false },
      onHover: { attribute: false },
      onFocus: { attribute: false },
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
    declare availableFlowActions: readonly FlowActionView[];
    declare hoverId: string | undefined;
    declare focusId: string | undefined;
    declare onCreate: ((actionId: string) => void) | undefined;
    declare onFlowAction: ((actionId: string) => void) | undefined;
    declare onHover: ((id: string | undefined) => void) | undefined;
    declare onFocus: ((id: string) => void) | undefined;
    declare onViewChange: ((view: WayfinderView) => void) | undefined;

    // The persistent map surface: constructed once and kept across renders
    // (and across view switches), so the camera and animation owner live in
    // one place. Referenced by constructor — never by tag.
    private mapView: MapCanvasElement | undefined;

    protected override updated(): void {
      // The map surface is a persistent instance: sync its data props after
      // every render (data flows down; the callbacks are wired once at
      // creation).
      const view = this.mapView;
      if (view === undefined) return;
      view.model = this.model;
      view.theme = this.theme;
      view.hoverId = this.hoverId;
      view.focusId = this.focusId;
    }

    private ensureMapView(): MapCanvasElement {
      const existing = this.mapView;
      if (existing !== undefined) return existing;
      const view: MapCanvasElement = new MapCanvas();
      view.onHover = (id) => this.onHover?.(id);
      view.onFocus = (id) => this.onFocus?.(id);
      this.mapView = view;
      return view;
    }

    render() {
      if (this.model === undefined) return nothing;
      return html`${this.renderHud()}${this.ensureMapView()}`;
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
