/** The wayfinder flow component (served component "flow-component"): the
 * flow-level custom view rendering the WHOLE flow-instance page body. The
 * entry (the module-graph root of the served module set) is the conductor:
 * it owns the expedition chrome (the theme wrapper with its per-theme
 * variables), the session-scoped view state (map-first for a populated
 * expedition, the Base Camp empty state for a newly created flow, and the
 * explicit Map/Table toggle), the hover/focus pulse, the persisted fog clear
 * order, and the four renderers it composes — the Base Camp empty state
 * (base-camp.ts), the map-first shell with its HUD (map-shell.ts), and the
 * alternate cartographer's table (the table-shell.ts chrome composing the
 * focused wayfinder-table.ts workbench). The shells are separate
 * modules so neither the map nor the table can regress into a monolith; the
 * entry keeps one persistent instance of each (the map shell keeps the one
 * persistent map surface, so the camera and animation owner survive view
 * switches). It value-imports the sibling modules the server serves
 * alongside it. Sections compose the canonical <workflow-board-content> (a
 * DEFAULT element — served modules can only reference default elements by
 * tag; the served instance cards resolve through the registry inside it).
 * There is no per-workflow fallback layer: the wayfinder preset declares no
 * workflowComponent views, so if this component fails to load, the generic
 * Hive sections (board/list) render — the canonical degraded path. */

import type { PropertyValues } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  FlowViewProps,
} from "workflow-engine/workflow-types";
import { type BaseCampElement, createBaseCamp } from "./base-camp.ts";
import { createMapCanvas } from "./map-canvas.ts";
import { createMapShell, type MapShellElement } from "./map-shell.ts";
import type { WayfinderView } from "./shared.ts";
import { createTableShell, type TableShellElement } from "./table-shell.ts";
import { createWayfinderDrawer } from "./wayfinder-drawer.ts";
import {
  deriveWayfinderMap,
  expeditionIsEmpty,
  type WayfinderMap,
} from "./wayfinder-map.ts";
import {
  createWayfinderTable,
  type WayfinderTableElement,
} from "./wayfinder-table.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";
import { resolveTheme } from "./wayfinder-themes.ts";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css } = lit;
  const MapCanvas = createMapCanvas(lit);
  const Drawer = createWayfinderDrawer(lit);
  const MapShell = createMapShell({ lit, MapCanvas, Drawer });
  const Table = createWayfinderTable(lit);
  const TableShell = createTableShell({ lit, Table });
  const BaseCamp = createBaseCamp(lit);

  class FlowComponent extends Base {
    static properties = {
      flow: { attribute: false },
      workflowDefs: { attribute: false },
      entries: { attribute: false },
      customKinds: { attribute: false },
      workflowCounts: { attribute: false },
      availableFlowActions: { attribute: false },
      persistedOutputs: { attribute: false },
      persistedOutputDirs: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
      onPatchState: { attribute: false },
      onSelect: { attribute: false },
      onFlowAction: { attribute: false },
      onCreate: { attribute: false },
      view: { attribute: false },
      hoverId: { attribute: false },
      focusId: { attribute: false },
      fogOrder: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
        height: 100%;
      }
      /* The expedition chrome: the theme wrapper every renderer sits inside.
         The per-theme --wf-* variables and --map-backdrop are defined here so
         the shells (separate shadow roots) inherit them through the DOM. */
      .expedition {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        --wf-accent: #4a9fe0;
        --wf-paper: #241f18;
        --wf-paper-edge: #352d22;
        --wf-ink: #f0ead9;
        --wf-body: #b7ad97;
        --wf-font:
          system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial,
          sans-serif;
        font-family: var(--wf-font);
        transition:
          --wf-accent var(--dur-slow) var(--ease-in-out),
          --wf-paper var(--dur-slow) var(--ease-in-out),
          --wf-paper-edge var(--dur-slow) var(--ease-in-out),
          --wf-ink var(--dur-slow) var(--ease-in-out),
          --wf-body var(--dur-slow) var(--ease-in-out);
      }
      .expedition[data-theme="mountain"] {
        --wf-accent: #4a9fe0;
        --wf-paper: #241f18;
        --wf-paper-edge: #352d22;
        --wf-ink: #f0ead9;
        --wf-body: #b7ad97;
      }
      .expedition[data-theme="topo"] {
        --wf-accent: #58a06a;
        --wf-paper: #25221a;
        --wf-paper-edge: #3a3426;
        --wf-ink: #f0ead9;
        --wf-body: #b7ad97;
      }
      .expedition[data-theme="stars"] {
        --wf-accent: #5bc0e8;
        --wf-paper: #10161f;
        --wf-paper-edge: #1e2a3a;
        --wf-ink: #d6e6f5;
        --wf-body: #8ba6c2;
      }
      :host-context(html.light) .expedition {
        --wf-accent: #2f7bb5;
        --wf-paper: #f2ead9;
        --wf-paper-edge: #d9c7a3;
        --wf-ink: #2a2418;
        --wf-body: #6b5f4a;
      }
      :host-context(html.light) .expedition[data-theme="topo"] {
        --wf-accent: #3f7d4d;
        --wf-paper: #f0f2e6;
        --wf-paper-edge: #ccd2b0;
        --wf-ink: #23281a;
        --wf-body: #5f6b4a;
      }
      :host-context(html.light) .expedition[data-theme="stars"] {
        --wf-accent: #2f86b5;
        --wf-paper: #e8eef4;
        --wf-paper-edge: #c3d0e0;
        --wf-ink: #1a2430;
        --wf-body: #4a5b6a;
      }

      /* The map backdrop surface, keyed by theme and light/dark mode. The
         mountain theme is a sky with a fog bank across the valley floor;
         topo stays all-green; stars is pure black (white in light mode so
         the currentColor starfield draws black). Both the table's mini-map
         card and the full map view's canvas read --map-backdrop. */
      .expedition[data-theme="mountain"] {
        --map-backdrop: linear-gradient(
          180deg,
          #0a1226 0%,
          #16284a 30%,
          #24395c 46%,
          #6c7c8c 68%,
          #b7c1c9 86%,
          #dde4e8 100%
        );
      }
      .expedition[data-theme="topo"] {
        --map-backdrop: radial-gradient(
          130% 110% at 50% 5%,
          #1c3626 0%,
          #152b1c 52%,
          #0c1e11 100%
        );
      }
      .expedition[data-theme="stars"] {
        --map-backdrop: #000000;
      }
      :host-context(html.light) .expedition[data-theme="mountain"] {
        --map-backdrop: linear-gradient(
          180deg,
          #66b4e8 0%,
          #8ec4ea 34%,
          #a9cbd9 52%,
          #c2d2d7 72%,
          #e0e7ea 90%,
          #f1f4f6 100%
        );
      }
      :host-context(html.light) .expedition[data-theme="topo"] {
        --map-backdrop: radial-gradient(
          130% 110% at 50% 5%,
          #cfe5bd 0%,
          #b4d3a1 52%,
          #97c283 100%
        );
      }
      :host-context(html.light) .expedition[data-theme="stars"] {
        --map-backdrop: #ffffff;
      }

      @media (max-width: 900px) {
        .expedition {
          height: auto;
        }
      }
    `;

    declare flow: FlowViewProps["flow"];
    declare workflowDefs: FlowViewProps["workflowDefs"];
    declare entries: FlowViewProps["entries"];
    declare customKinds: FlowViewProps["customKinds"];
    declare workflowCounts: FlowViewProps["workflowCounts"];
    declare availableFlowActions: FlowViewProps["availableFlowActions"];
    declare persistedOutputs: FlowViewProps["persistedOutputs"];
    declare persistedOutputDirs: FlowViewProps["persistedOutputDirs"];
    declare onAction: FlowViewProps["onAction"];
    declare onSendMessage: FlowViewProps["onSendMessage"];
    declare onPatchState: FlowViewProps["onPatchState"];
    declare onSelect: FlowViewProps["onSelect"];
    declare onFlowAction: FlowViewProps["onFlowAction"];
    declare onCreate: FlowViewProps["onCreate"];
    // The map-first / table view mode; the empty expedition renders Base
    // Camp regardless (the stored choice applies once the flow populates).
    declare view: WayfinderView;
    declare hoverId: string | undefined;
    declare focusId: string | undefined;
    declare fogOrder: string[];

    constructor() {
      super();
      this.view = "map";
      this.fogOrder = [];
    }

    // The three renderers are persistent instances: constructed once and kept
    // across renders (and view switches), so the map surface's camera and
    // animation owner live in one place (the map shell owns the one map
    // surface). The entry references them by constructor — never by tag.
    private mapShell: MapShellElement | undefined;
    private tableShell: TableShellElement | undefined;
    private baseCamp: BaseCampElement | undefined;

    // The flow id whose durable view state has been restored into this
    // instance; undefined until the flow prop arrives, so a reused instance
    // re-restores when the mount host points it at a different flow.
    private viewStateFlowId: string | undefined;

    // Restore the durable view state once per flow id, before the first
    // render: the mount host assigns the flow prop before this first update
    // runs, so the restore lands before the user ever sees a default frame.
    protected override willUpdate(
      _changedProperties: PropertyValues<this>
    ): void {
      const flow = this.flow;
      if (flow === undefined || flow.id === this.viewStateFlowId) return;
      this.viewStateFlowId = flow.id;
      this.restoreViewState(flow);
    }

    // The durable view state (view mode, fog clear order) lives in
    // sessionStorage keyed by flow id: the mount host can tear the element
    // down on a class swap or remount, so the user's view must survive in
    // storage, not in fields. Writes happen at the mutation sites; restores
    // read the keys back before the first render.
    private restoreViewState(flow: FlowViewProps["flow"]): void {
      const stored = sessionStorage.getItem(viewStateKey(flow.id, "view"));
      if (stored === "map" || stored === "table") {
        this.view = stored;
      } else {
        // The pre-view-mode key: the map-open flag ("1" = the map was open,
        // "0" = the table). Read for compatibility with sessions that wrote
        // it before the Map/Table view mode existed.
        const legacy = sessionStorage.getItem(
          viewStateKey(flow.id, "map-open")
        );
        if (legacy === "1") this.view = "map";
        else if (legacy === "0") this.view = "table";
      }
      this.fogOrder = storedFogOrder(
        sessionStorage.getItem(viewStateKey(flow.id, "fog-order"))
      );
    }

    private persistViewState(suffix: string, value: string): void {
      const flowId = this.flow?.id;
      if (flowId === undefined) return;
      sessionStorage.setItem(viewStateKey(flowId, suffix), value);
    }

    private focusTimer: ReturnType<typeof setTimeout> | undefined;

    private get theme(): ExpeditionTheme {
      return resolveTheme(this.flow.config);
    }

    private get model(): WayfinderMap {
      return deriveWayfinderMap(this.entries);
    }

    // Hover sync is one reactive id: every surfaced element (card, node,
    // entry, marker) renders the .hl class when its data-id is the hovered
    // id, so the paired elements light up together in both views.
    private hover(id: string | undefined) {
      this.hoverId = id;
    }

    // Click focus lights the target's .hl too, pulses it via .focus, and
    // clears itself after a beat (the timer is replaced on each new focus).
    private setFocus(id: string) {
      this.hoverId = id;
      this.focusId = id;
      if (this.focusTimer !== undefined) clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => {
        this.focusId = undefined;
        this.hoverId = undefined;
      }, FOCUS_CLEAR_MS);
    }

    // The durable view mode: switching persists immediately so a remount or
    // reload within the session restores the user's surface.
    private switchView(view: WayfinderView) {
      this.view = view;
      this.persistViewState("view", view);
    }

    // The fog tray's drag reorder is table-only; the order persists here,
    // session-scoped per flow id.
    private onFogOrderChange(order: string[]) {
      this.fogOrder = order;
      this.persistViewState("fog-order", JSON.stringify(order));
    }

    private ensureMapShell(): MapShellElement {
      const existing = this.mapShell;
      if (existing !== undefined) return existing;
      const shell: MapShellElement = new MapShell();
      shell.onCreate = (actionId) => this.onCreate(actionId);
      shell.onFlowAction = (actionId) => this.onFlowAction(actionId);
      shell.onHover = (id) => this.hover(id);
      shell.onFocus = (id) => this.setFocus(id);
      shell.onAction = (id, actionId) => this.onAction(id, actionId);
      shell.onSendMessage = (id, content) => this.onSendMessage(id, content);
      shell.onViewChange = (view) => this.switchView(view);
      this.mapShell = shell;
      return shell;
    }

    private ensureTableShell(): TableShellElement {
      const existing = this.tableShell;
      if (existing !== undefined) return existing;
      const shell: TableShellElement = new TableShell();
      shell.onAction = (id, actionId) => this.onAction(id, actionId);
      shell.onSendMessage = (id, content) => this.onSendMessage(id, content);
      shell.onCreate = (actionId) => this.onCreate(actionId);
      shell.onFlowAction = (actionId) => this.onFlowAction(actionId);
      shell.onHover = (id) => this.hover(id);
      shell.onFocus = (id) => this.setFocus(id);
      shell.onFogOrderChange = (order) => this.onFogOrderChange(order);
      shell.onViewChange = (view) => this.switchView(view);
      this.tableShell = shell;
      return shell;
    }

    private ensureBaseCamp(): BaseCampElement {
      const existing = this.baseCamp;
      if (existing !== undefined) return existing;
      const camp: BaseCampElement = new BaseCamp();
      camp.onAction = (id, actionId) => this.onAction(id, actionId);
      camp.onSendMessage = (id, content) => this.onSendMessage(id, content);
      camp.onCreate = (actionId) => this.onCreate(actionId);
      camp.onFlowAction = (actionId) => this.onFlowAction(actionId);
      camp.onViewChange = (view) => this.switchView(view);
      this.baseCamp = camp;
      return camp;
    }

    protected override updated(changedProperties: PropertyValues<this>): void {
      super.updated(changedProperties);
      // The shells are persistent instances: sync their data props after
      // every render (data flows down; the callbacks are wired once at
      // creation). Unused props stay on the instance until its view renders.
      const identity = {
        flowLabel: this.flow.label,
        flowStatus: this.flow.status,
      };
      if (this.baseCamp !== undefined) {
        Object.assign(this.baseCamp, {
          ...identity,
          model: this.model,
          theme: this.theme,
          entries: this.entries,
          workflowDefs: this.workflowDefs,
          availableFlowActions: this.availableFlowActions,
        });
      }
      if (this.mapShell !== undefined) {
        Object.assign(this.mapShell, {
          ...identity,
          model: this.model,
          theme: this.theme,
          entries: this.entries,
          workflowDefs: this.workflowDefs,
          persistedOutputs: this.persistedOutputs,
          persistedOutputDirs: this.persistedOutputDirs,
          availableFlowActions: this.availableFlowActions,
          hoverId: this.hoverId,
          focusId: this.focusId,
        });
      }
      if (this.tableShell !== undefined) {
        Object.assign(this.tableShell, {
          ...identity,
          model: this.model,
          theme: this.theme,
          entries: this.entries,
          workflowDefs: this.workflowDefs,
          persistedOutputs: this.persistedOutputs,
          persistedOutputDirs: this.persistedOutputDirs,
          availableFlowActions: this.availableFlowActions,
          hoverId: this.hoverId,
          focusId: this.focusId,
          fogOrder: this.fogOrder,
        });
      }
    }

    render() {
      const theme = this.theme;
      const model = this.model;
      // The table is always the table — even for an empty expedition, the
      // stations are a useful workbench and the stored view applies. The map
      // of an empty expedition has nothing to show, so the Base Camp empty
      // state stands in for it until the first content node exists.
      if (this.view === "table") {
        return html`<div class="expedition" data-theme=${theme}>
          ${this.ensureTableShell()}
        </div>`;
      }
      if (expeditionIsEmpty(model)) {
        return html`<div class="expedition" data-theme=${theme}>
          ${this.ensureBaseCamp()}
        </div>`;
      }
      return html`<div class="expedition" data-theme=${theme}>
        ${this.ensureMapShell()}
      </div>`;
    }
  }

  return {
    components: {
      "flow-component": FlowComponent,
      // The shells and the full-map surface are registered beside the entry
      // so they get defined tags (constructing an unregistered Lit subclass
      // throws); the entry composes them by constructor, never by tag.
      "wayfinder-map-view": MapCanvas,
      "wayfinder-map-shell": MapShell,
      "wayfinder-drawer": Drawer,
      "wayfinder-table": Table,
      "wayfinder-table-shell": TableShell,
      "wayfinder-base-camp": BaseCamp,
    },
  };
}

// The durable view-state keys are session-scoped per flow id: a remount or a
// page reload within the session restores the user's view mode, fog clear
// order, and (historically) the map-open flag, and one flow's state never
// leaks into another flow's keys.
function viewStateKey(flowId: string, suffix: string): string {
  return `hive:view:${flowId}:${suffix}`;
}

// The stored fog clear order is a JSON id list; malformed or non-list values
// fall back to the natural order (a missing or empty list is the default —
// entries absent from the list keep their natural relative order).
function storedFogOrder(stored: string | null): string[] {
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      Array.isArray(parsed) &&
      parsed.every((value: unknown) => typeof value === "string")
    ) {
      return parsed as string[];
    }
  } catch {
    // Malformed storage falls back to the natural order.
  }
  return [];
}

// The click-focus pulse plays for ~1s twice, then the focus state clears.
const FOCUS_CLEAR_MS = 2_000;
