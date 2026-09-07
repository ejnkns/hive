/** The comb shell (served component "comb-shell"): the flow-level body —
 * the HUD chrome (brand, the Map toggle, Import notes), the comb surface,
 * the detail flip, the map.md side panel, and the empty state. The shell
 * owns the selection (which cell's detail is open) and the panel state;
 * the surface owns the camera. The shells and surfaces are persistent
 * instances constructed once and kept across renders, so the camera and
 * animation owners survive every re-render. */

import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import type {
  FlowComponentDeps,
  FlowViewProps,
} from "workflow-engine/workflow-types";
import type { CombDetailElement } from "./comb-detail.ts";
import type { CombEmptyElement } from "./comb-empty.ts";
import type { CombSurfaceElement } from "./comb-surface.ts";
import type { WorldPoint } from "./hex-layout.ts";
import { deriveHoneycombMap } from "./honeycomb-map.ts";
import type { CombCell, HoneycombMap } from "./shared.ts";

export type CombShellDeps = {
  lit: FlowComponentDeps;
  Surface: new () => CombSurfaceElement;
  Detail: new () => CombDetailElement;
  Empty: new () => CombEmptyElement;
};

export type CombShellElement = HTMLElement & {
  flow: FlowViewProps["flow"] | undefined;
  entries: WorkflowInstanceEntry[];
  persistedOutputs: FlowViewProps["persistedOutputs"] | undefined;
  availableFlowActions: FlowViewProps["availableFlowActions"] | undefined;
  onAction: ((instanceId: string, actionId: string) => void) | undefined;
  onPatchState:
    | ((instanceId: string, values: Record<string, unknown>) => void)
    | undefined;
  onCreate: ((actionId: string) => void) | undefined;
};

export function createCombShell(
  options: CombShellDeps
): new () => CombShellElement {
  const { lit, Surface, Detail, Empty } = options;
  const { LitElement: Base, html, css, nothing } = lit;

  class CombShell extends Base {
    static properties = {
      flow: { attribute: false },
      entries: { attribute: false },
      persistedOutputs: { attribute: false },
      availableFlowActions: { attribute: false },
      selectedId: { attribute: false },
      origin: { attribute: false },
      mapOpen: { type: Boolean, attribute: "data-map-open", reflect: true },
      onAction: { attribute: false },
      onPatchState: { attribute: false },
      onCreate: { attribute: false },
    };

    static styles = css`
      :host {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        font-family: var(--hc-font, system-ui, sans-serif);
      }
      .hud {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 16px 8px;
        color: var(--hc-ink, #f4e9d0);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .brand .emblem {
        color: var(--honey, #e8a020);
        font-size: 1.3rem;
        line-height: 1;
      }
      .brand h1 {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 650;
        letter-spacing: 0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hud-actions {
        display: flex;
        gap: 8px;
        flex: none;
      }
      .hud-actions button {
        font: inherit;
        font-size: 0.85rem;
        padding: 7px 14px;
        border-radius: 999px;
        cursor: pointer;
        border: 1px solid var(--hc-edge, #3d2c14);
        background: var(--hc-field, #1d1409);
        color: var(--hc-body, #cbb990);
      }
      .hud-actions button:hover {
        color: var(--hc-ink, #f4e9d0);
      }
      .hud-actions button.primary {
        background: var(--honey, #e8a020);
        border-color: var(--honey-edge, #b97a10);
        color: #241a0c;
        font-weight: 650;
      }
      .hud-actions button.primary:hover {
        filter: brightness(1.12);
        color: #241a0c;
      }
      .hud-actions button[aria-pressed="true"] {
        border-color: var(--honey, #e8a020);
        color: var(--honey, #e8a020);
      }
      .body {
        flex: 1;
        min-height: 0;
        position: relative;
        display: flex;
        padding: 0 16px 16px;
        box-sizing: border-box;
      }
      .map-panel {
        position: absolute;
        top: 0;
        right: 16px;
        bottom: 16px;
        width: min(420px, 86vw);
        background: var(--hc-paper, #241a0c);
        border: 1px solid var(--hc-edge, #3d2c14);
        border-radius: 14px 0 0 14px;
        display: flex;
        flex-direction: column;
        transform: translateX(calc(100% + 16px));
        visibility: hidden;
        transition:
          transform 0.3s cubic-bezier(0.3, 0.8, 0.3, 1),
          visibility 0s 0.3s;
        z-index: 5;
      }
      :host([data-map-open]) .map-panel {
        transform: translateX(0);
        visibility: visible;
        transition:
          transform 0.3s cubic-bezier(0.3, 0.8, 0.3, 1),
          visibility 0s 0s;
      }
      .map-panel header {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--hc-edge, #3d2c14);
        color: var(--hc-ink, #f4e9d0);
        font-weight: 650;
        font-size: 0.9rem;
      }
      .map-panel .close {
        border: none;
        background: none;
        color: var(--hc-body, #b39b72);
        font-size: 1em;
        cursor: pointer;
      }
      .map-panel .close:hover {
        color: var(--hc-ink, #f4e9d0);
      }
      .map-panel pre {
        flex: 1;
        margin: 0;
        padding: 16px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--hc-body, #cbb990);
        font-size: 0.82rem;
        line-height: 1.55;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .map-panel pre.empty {
        color: var(--hc-body, #8a7a5c);
        font-style: italic;
      }
    `;

    declare flow: FlowViewProps["flow"] | undefined;
    declare entries: WorkflowInstanceEntry[];
    declare persistedOutputs: FlowViewProps["persistedOutputs"] | undefined;
    declare availableFlowActions:
      | FlowViewProps["availableFlowActions"]
      | undefined;
    declare selectedId: string | undefined;
    declare origin: WorldPoint | undefined;
    declare mapOpen: boolean;
    declare onAction:
      | ((instanceId: string, actionId: string) => void)
      | undefined;
    declare onPatchState:
      | ((instanceId: string, values: Record<string, unknown>) => void)
      | undefined;
    declare onCreate: ((actionId: string) => void) | undefined;

    constructor() {
      super();
      this.flow = undefined;
      this.entries = [];
      this.persistedOutputs = undefined;
      this.availableFlowActions = [];
      this.mapOpen = false;
    }

    // The persistent instances: the surface keeps its camera; the detail
    // keeps its animation state.
    private surface: CombSurfaceElement | undefined;
    private detail: CombDetailElement | undefined;
    private empty: CombEmptyElement | undefined;

    // The derived map, cached on the entries array's identity: the host
    // re-renders (and re-delivers snapshots) far more often than the idea
    // set changes, and a re-derived map object would churn every
    // downstream identity — retriggering camera re-fits and the detail
    // entrance on unrelated renders.
    private mapCache:
      | { entries: WorkflowInstanceEntry[]; map: HoneycombMap }
      | undefined;

    private get map(): HoneycombMap {
      const entries = this.entries;
      if (this.mapCache !== undefined && this.mapCache.entries === entries) {
        return this.mapCache.map;
      }
      const map = deriveHoneycombMap(entries);
      this.mapCache = { entries, map };
      return map;
    }

    // The selected cell, resolved from the CURRENT map each render — the
    // detail face always shows the latest snapshot data even while open.
    private get selectedCell(): CombCell | undefined {
      const id = this.selectedId;
      if (id === undefined) return undefined;
      return this.map.hives
        .flatMap((hive) => hive.cells)
        .find((cell) => cell.id === id);
    }

    // The flow-level action that opens a create dialog (Import notes).
    private get importActionId(): string | undefined {
      return (
        this.availableFlowActions?.find(
          (action) => action.createInstance !== undefined
        )?.id ?? undefined
      );
    }

    private ensureSurface(): CombSurfaceElement {
      const existing = this.surface;
      if (existing !== undefined) return existing;
      const surface: CombSurfaceElement = new Surface();
      surface.onCellOpen = (id, origin) => {
        this.selectedId = id;
        this.origin = origin;
      };
      this.surface = surface;
      return surface;
    }

    private ensureDetail(): CombDetailElement {
      const existing = this.detail;
      if (existing !== undefined) return existing;
      const detail: CombDetailElement = new Detail();
      detail.onPatchState = (id, values) => this.onPatchState?.(id, values);
      detail.onAction = (id, actionId) => this.onAction?.(id, actionId);
      detail.onClose = () => {
        this.selectedId = undefined;
        this.origin = undefined;
      };
      this.detail = detail;
      return detail;
    }

    private ensureEmpty(): CombEmptyElement {
      const existing = this.empty;
      if (existing !== undefined) return existing;
      const empty: CombEmptyElement = new Empty();
      empty.onImport = () => {
        const actionId = this.importActionId;
        if (actionId !== undefined) this.onCreate?.(actionId);
      };
      this.empty = empty;
      return empty;
    }

    protected override updated(changedProperties: Map<string, unknown>): void {
      super.updated(changedProperties);
      // Data flows down into the persistent instances after every render —
      // but only when a value's identity actually changed, so an unrelated
      // re-render never restarts the surface's camera logic or the detail's
      // entrance animation.
      const map = this.map;
      const labels = map.hives.map((hive) => hive.label);
      const cell = this.selectedCell;
      if (this.surface !== undefined && this.surface.map !== map) {
        this.surface.map = map;
      }
      if (this.detail !== undefined) {
        if (this.detail.cell !== cell) {
          this.detail.cell = cell;
        }
        if (this.detail.origin !== this.origin) {
          this.detail.origin = this.origin;
        }
        if (this.detail.hiveLabels.join("|") !== labels.join("|")) {
          this.detail.hiveLabels = labels;
        }
      }
      if (this.empty !== undefined) {
        this.empty.flowLabel = this.flow?.label ?? "";
      }
    }

    render() {
      const map = this.map;
      const importActionId = this.importActionId;
      const mapMarkdown = this.persistedOutputs?.["map.md"];
      return html`
        <header class="hud">
          <div class="brand">
            <span class="emblem">⬡</span>
            <h1>${this.flow?.label ?? "Honeycomb"}</h1>
          </div>
          <div class="hud-actions">
            ${
              map.total > 0
                ? html`<button
                  aria-pressed=${this.mapOpen ? "true" : "false"}
                  @click=${() => {
                    this.mapOpen = !this.mapOpen;
                  }}
                >
                  Map
                </button>`
                : nothing
            }
            ${
              importActionId !== undefined
                ? html`<button
                  class="primary"
                  @click=${() => this.onCreate?.(importActionId)}
                >
                  Import notes
                </button>`
                : nothing
            }
          </div>
        </header>
        <div class="body">
          ${map.total === 0 ? this.ensureEmpty() : this.ensureSurface()}
          ${this.ensureDetail()}
          <aside class="map-panel" aria-label="map.md">
            <header>
              <span>map.md</span>
              <button
                class="close"
                @click=${() => {
                  this.mapOpen = false;
                }}
              >
                ✕
              </button>
            </header>
            ${
              typeof mapMarkdown === "string" && mapMarkdown !== ""
                ? html`<pre>${mapMarkdown}</pre>`
                : html`<pre class="empty">No map built yet — run the Map workflow to build map.md.</pre>`
            }
          </aside>
        </div>
      `;
    }
  }

  return CombShell;
}
