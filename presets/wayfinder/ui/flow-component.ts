/** The wayfinder flow component (served component "flow-component"): the
 * flow-level custom view rendering the WHOLE flow-instance page body. The
 * entry (the module-graph root of the served module set) owns the expedition
 * chrome — a header (emblem, destination, status, flow actions), the
 * cartographer's table (base camp, briefing deck, fog tray, on-expedition,
 * journal, depot, do-not-enter), the mini-map, and the map-open state — and
 * value-imports the sibling modules the server serves alongside it: the pure
 * map derivation (wayfinder-map.ts), the theme data (wayfinder-themes.ts),
 * the SVG drawing builders (wayfinder-drawing.ts), and the full map view
 * (map-canvas.ts, composed by constructor). Sections compose the canonical
 * <workflow-board-content> (a DEFAULT element — served modules can only
 * reference default elements by tag; the served instance cards resolve
 * through the registry inside it). The per-workflow workflow-view components
 * (expedition-map, frontier-board, build-pipeline) remain the fallback layer
 * if this component fails to load. */

import type { PropertyValues } from "lit";
import type {
  ChatMessage,
  FlowComponentDeps,
  FlowComponentRegistrations,
  FlowViewProps,
  ModelCallStatus,
} from "workflow-engine/workflow-types";
import { createMapCanvas } from "./map-canvas.ts";
import { createWayfinderDrawing } from "./wayfinder-drawing.ts";
import type { WayfinderMap } from "./wayfinder-map.ts";
import {
  deriveWayfinderMap,
  implementationTitle,
  RESOLVING_STATES,
  resolvingLabel,
  ticketTitle,
} from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";
import {
  resolveTheme,
  THEME_ACCENT,
  THEME_GLYPHS,
} from "./wayfinder-themes.ts";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing, svg } = lit;
  const MapCanvas = createMapCanvas(lit);
  const drawing = createWayfinderDrawing(lit);

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
      mapOpen: { attribute: false },
      hoverId: { attribute: false },
      focusId: { attribute: false },
      fogOrder: { attribute: false },
      openDecisionId: { attribute: false },
    };

    static styles = [
      css`
        :host {
          display: block;
          height: 100%;
        }
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
        .expedition[data-theme="stars"] .map-card,
        .expedition[data-theme="stars"] .canvas {
          color: #ffffff;
        }
        :host-context(html.light) .expedition[data-theme="stars"] .map-card,
        :host-context(html.light) .expedition[data-theme="stars"] .canvas {
          color: #0a0e15;
        }

        .header {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 0.625rem;
          flex-wrap: wrap;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
        }
        .emblem {
          color: var(--wf-accent);
          font-size: 1.25rem;
          line-height: 1;
        }
        .title-group {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
        }
        .title {
          font-size: 0.875rem;
          font-weight: 700;
          color: var(--text);
        }
        .status {
          font-size: 0.625rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
        }
        .actions {
          margin-left: auto;
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
        }
        .actions button {
          font-family: inherit;
          font-size: 0.625rem;
          height: 24px;
          padding: 0 0.5rem;
          border-radius: 4px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
          cursor: pointer;
        }
        .actions button.primary {
          background: var(--success);
          color: var(--bg);
          border-color: transparent;
        }
        .actions button.destructive {
          background: var(--error);
          color: white;
          border-color: transparent;
        }

        .table {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: minmax(0, 300px) minmax(0, 1fr) minmax(0, 280px);
          gap: 1rem;
          align-items: stretch;
          overflow: hidden;
          border-radius: 18px;
          padding: 1.25rem;
          border: 1px solid var(--border);
          background: var(--wf-paper);
        }
        .expedition[data-theme="mountain"] .table {
          background:
            radial-gradient(
              120% 90% at 50% 10%,
              rgba(255, 255, 255, 0.05),
              transparent 60%
            ),
            repeating-linear-gradient(
              90deg,
              rgba(0, 0, 0, 0.05) 0 2px,
              transparent 2px 6px
            ),
            var(--wf-paper);
        }
        .expedition[data-theme="topo"] .table {
          background:
            radial-gradient(
              120% 90% at 50% 10%,
              rgba(255, 255, 255, 0.04),
              transparent 60%
            ),
            repeating-linear-gradient(
              0deg,
              rgba(0, 0, 0, 0.04) 0 1px,
              transparent 1px 28px
            ),
            repeating-linear-gradient(
              90deg,
              rgba(0, 0, 0, 0.04) 0 1px,
              transparent 1px 28px
            ),
            var(--wf-paper);
        }
        .expedition[data-theme="stars"] .table {
          background:
            radial-gradient(
              120% 100% at 50% 0%,
              rgba(91, 192, 232, 0.08),
              transparent 60%
            ),
            repeating-linear-gradient(
              90deg,
              rgba(0, 0, 0, 0.06) 0 8px,
              transparent 8px 16px
            ),
            var(--wf-paper);
        }
        @media (max-width: 900px) {
          .expedition {
            height: auto;
          }
          .table {
            grid-template-columns: 1fr;
            overflow: visible;
          }
          .column {
            overflow-y: visible;
          }
          .column.center {
            order: -1;
            overflow: visible;
          }
          .map-card {
            height: auto;
            min-height: 60vh;
          }
        }

        .column {
          display: flex;
          flex-direction: column;
          gap: 1.1rem;
          min-width: 0;
          min-height: 0;
          overflow-y: auto;
          padding: 0.5rem 0.625rem 0.75rem;
        }
        .column.center {
          overflow: hidden;
          padding: 0;
        }
        .station-head {
          font-size: 0.68rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--wf-body);
          margin: 0 0 0.55rem;
          display: flex;
          align-items: center;
          gap: 0.45rem;
        }
        .station-head::after {
          content: "";
          flex: 1;
          height: 1px;
          background: rgba(203, 185, 143, 0.25);
        }
        .pile {
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
          min-height: 40px;
        }
        .empty {
          font-size: 0.68rem;
          color: var(--muted);
          padding: 0.4rem 0;
        }
        .card .card-title,
        .card .lbl,
        .crate .card-title,
        .crate .lbl,
        .journal .txt,
        .dest-note .name,
        .dest-note .sub {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .card .body {
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .journal .txt {
          min-width: 0;
        }

        .card {
          background: var(--wf-paper);
          border: 1px solid var(--wf-paper-edge);
          border-radius: 10px;
          padding: 0.75rem 0.85rem;
          box-shadow:
            0 2px 0 rgba(0, 0, 0, 0.3),
            0 5px 10px rgba(0, 0, 0, 0.3);
          transform: rotate(var(--rot, 0deg));
          transition:
            transform 0.15s ease,
            box-shadow 0.15s ease,
            border-color 0.15s;
        }
        .card:hover {
          transform: rotate(0deg) translateY(-2px);
        }
        .card.hl,
        .crate.hl,
        .journal .entry.hl {
          border-color: var(--wf-accent);
          box-shadow:
            0 0 0 2px color-mix(in srgb, var(--wf-accent) 60%, transparent),
            0 6px 14px rgba(0, 0, 0, 0.35);
        }
        .card.focus,
        .crate.focus,
        .journal .entry.focus {
          animation: cardglow 1s ease-in-out 2;
        }
        @keyframes cardglow {
          0%, 100% {
            box-shadow:
              0 0 0 0 color-mix(in srgb, var(--wf-accent) 0%, transparent);
          }
          50% {
            box-shadow:
              0 0 0 6px color-mix(in srgb, var(--wf-accent) 55%, transparent);
          }
        }
        .card,
        .crate,
        .journal .entry {
          cursor: pointer;
        }
        .card:focus-visible,
        .crate:focus-visible,
        .journal .entry:focus-visible {
          outline: 2px solid color-mix(in srgb, var(--wf-accent) 55%, transparent);
          outline-offset: 1px;
        }
        .card .card-title {
          font-weight: 600;
          font-size: 0.84rem;
          color: var(--wf-ink);
        }
        .card .body {
          font-size: 0.7rem;
          color: var(--wf-body);
          margin-top: 0.28rem;
        }
        .card .card-title,
        .card .body,
        .journal .txt,
        .crate .card-title,
        .dest-note .name {
          font-family: var(--wf-font);
        }
        .stamp {
          display: inline-block;
          font-size: 0.56rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--wf-accent);
          border: 1.5px solid var(--wf-accent);
          border-radius: 4px;
          padding: 0.06rem 0.34rem;
          margin-top: 0.5rem;
          transform: rotate(-3deg);
        }
        .card .lbl {
          font-size: 0.6rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .card-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: 0.5rem;
        }
        .card-actions button {
          font: inherit;
          font-size: 0.68rem;
          padding: 0.26rem 0.6rem;
          border-radius: 6px;
          border: 1px solid var(--wf-accent);
          background: transparent;
          color: var(--wf-accent);
          cursor: pointer;
        }
        .card-actions button.primary {
          background: var(--wf-accent);
          color: var(--bg);
          border-color: transparent;
        }
        .card-actions button.destructive {
          background: var(--error);
          color: white;
          border-color: transparent;
        }
        .card-actions button.secondary {
          border-color: var(--border);
          color: var(--muted);
        }
        .task-status {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          margin-top: 0.45rem;
          font-size: 0.62rem;
          color: var(--wf-body);
        }
        .task-status .pulse {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--warning);
          animation: task-pulse 1.4s ease-in-out infinite;
        }
        @keyframes task-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .task-error {
          margin-top: 0.45rem;
          font-size: 0.62rem;
          color: var(--error);
          border: 1px solid color-mix(in srgb, var(--error) 45%, transparent);
          border-radius: 6px;
          padding: 0.3rem 0.5rem;
        }
        .card-chat {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          border-top: 1px dashed var(--border);
          padding-top: 0.5rem;
          margin-top: 0.5rem;
        }
        .session-header {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .session-label {
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--wf-accent);
        }

        .fog-card {
          background: linear-gradient(
            165deg,
            var(--wf-paper),
            var(--wf-paper-edge)
          );
          border: 2px dashed var(--wf-body);
          cursor: grab;
        }
        .fog-card.dragging {
          opacity: 0.4;
        }
        .fog-title {
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }
        .fog-title .card-title {
          flex: 1;
          min-width: 0;
        }
        .fog-card .q {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 1.5px solid var(--wf-ink);
          color: var(--wf-ink);
          font-weight: 700;
          font-size: 0.85rem;
          box-shadow:
            0 0 0 4px color-mix(in srgb, var(--wf-body) 18%, transparent),
            0 0 14px color-mix(in srgb, var(--wf-body) 35%, transparent);
        }
        .fog-card .tag {
          display: inline-block;
          margin-top: 0.4rem;
          font-size: 0.56rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--wf-ink);
          background: color-mix(in srgb, var(--wf-body) 25%, transparent);
          border-radius: 999px;
          padding: 0.06rem 0.45rem;
        }

        .journal {
          background: var(--wf-paper);
          border: 1px solid var(--wf-paper-edge);
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
        }
        .journal .entry {
          padding: 0.6rem 0.8rem;
          border-bottom: 1px dashed var(--wf-paper-edge);
          display: flex;
          gap: 0.6rem;
          align-items: baseline;
        }
        .journal .entry:last-child {
          border-bottom: none;
        }
        .journal .cairn {
          color: var(--success);
        }
        .journal .txt {
          font-size: 0.8rem;
          color: var(--wf-ink);
        }
        .journal .decision {
          padding: 0 0.8rem 0.7rem 2.2rem;
          border-bottom: 1px dashed var(--wf-paper-edge);
        }
        .journal .decision:last-child {
          border-bottom: none;
        }
        .journal .decision-empty {
          font-size: 0.72rem;
          color: var(--muted);
          font-style: italic;
        }

        .crate {
          background: var(--wf-paper);
          border: 1px solid var(--wf-paper-edge);
          border-radius: 10px;
          padding: 0.7rem 0.8rem;
          border-top: 3px solid var(--warning);
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
        }
        .crate.spec {
          border-top-color: var(--wf-accent);
        }
        .crate .lbl {
          font-size: 0.6rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .crate .card-title {
          font-weight: 600;
          font-size: 0.8rem;
          color: var(--wf-ink);
        }

        .map-card {
          height: 100%;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 0.9rem;
          background: var(
            --map-backdrop,
            radial-gradient(120% 90% at 70% 20%, #172030 0%, #10151d 55%, #0c1015 100%)
          );
          position: relative;
        }
        .map-card .map-top {
          flex-shrink: 0;
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }
        .map-card .dest-note {
          flex: 1;
          min-width: 0;
        }
        .map-card .dest-note .name {
          font-weight: 700;
          font-size: 0.8rem;
        }
        .map-card .dest-note .sub {
          font-size: 0.66rem;
          color: var(--muted);
        }
        .map-card .open-map {
          flex-shrink: 0;
          font: inherit;
          font-size: 0.68rem;
          padding: 0.32rem 0.6rem;
          border-radius: 6px;
          border: 1px solid var(--wf-accent);
          background: rgba(91, 192, 232, 0.12);
          color: var(--wf-accent);
          cursor: pointer;
        }
        .map-card svg {
          display: block;
          width: 100%;
          height: 100%;
          flex: 1;
          min-height: 0;
        }
        .marker {
          transition: transform 0.15s ease, opacity 0.15s ease;
          transform-box: fill-box;
          transform-origin: center;
          cursor: pointer;
        }
        .marker.hl {
          transform: scale(1.7);
        }
        .marker.focus {
          animation: markerpulse 1s ease-in-out 2;
        }
        @keyframes markerpulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(2); }
        }
      `,
      MapCanvas.styles,
    ];

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
    declare mapOpen: boolean;
    declare hoverId: string | undefined;
    declare focusId: string | undefined;
    declare fogOrder: string[];
    declare openDecisionId: string | undefined;

    constructor() {
      super();
      this.fogOrder = [];
    }

    // The fog card currently being dragged — deliberately not a reactive
    // property (a re-render on dragstart would cancel the drag).
    private draggedFogId: string | undefined;

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

    // The durable view state (map open, fog clear order) lives in
    // sessionStorage keyed by flow id: the mount host can tear the
    // element down on a class swap or remount, so the user's view must
    // survive in storage, not in fields. Writes happen at the mutation
    // sites; restores read the keys back before the first render.
    private restoreViewState(flow: FlowViewProps["flow"]): void {
      this.mapOpen =
        sessionStorage.getItem(viewStateKey(flow.id, "map-open")) === "1";
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

    // Enter/Space focus an element the same way a click does; focus/blur
    // already mirror hover through the @focus/@blur listeners.
    private focusFromKey(event: KeyboardEvent, id: string) {
      if (event.key === "Enter" || event.key === " ") this.setFocus(id);
    }

    // Journal drill-in: one closed ticket's decision record open at a time.
    // Opening focuses the entry (map highlight + pulse); the record stays
    // open after the pulse clears, until a click (or Enter/Space) collapses
    // it or opens another.
    private toggleDecision(id: string) {
      this.openDecisionId = this.openDecisionId === id ? undefined : id;
      this.setFocus(id);
    }

    // Enter/Space on a journal entry toggles its record open, matching the
    // click affordance for keyboard users; Space must not scroll the column.
    private decisionFromKey(event: KeyboardEvent, id: string) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.toggleDecision(id);
      }
    }

    // The hl/focus class suffix shared by every card-family surface.
    private hotClass(id: string): string {
      if (this.focusId === id) return " hl focus";
      if (this.hoverId === id) return " hl";
      return "";
    }

    // The fog tray's drag-to-reorder: the dragged id stays a plain field so
    // dragstart never re-renders (which would cancel the drag); the .dragging
    // class is added imperatively and removed on dragend.
    private onFogDragStart(event: DragEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(".fog-card");
      if (card === null) return;
      const id = card.getAttribute("data-id");
      if (id === null) return;
      this.draggedFogId = id;
      card.classList.add("dragging");
      event.dataTransfer?.setData?.("text/plain", id);
    }

    private onFogDragOver(event: DragEvent) {
      event.preventDefault();
    }

    // On drop, the dragged id re-enters before the first remaining card whose
    // vertical middle sits below the pointer, and the tray re-renders from
    // the new fogOrder id-list.
    private onFogDrop(event: DragEvent) {
      event.preventDefault();
      if (this.draggedFogId === undefined) return;
      const pile = event.currentTarget;
      if (!(pile instanceof Element)) return;
      const remaining = [...pile.querySelectorAll(".fog-card")]
        .filter((card) => card.getAttribute("data-id") !== this.draggedFogId)
        .map((card) => {
          const rect = card.getBoundingClientRect();
          return {
            id: card.getAttribute("data-id") ?? "",
            middle: rect.top + rect.height / 2,
          };
        });
      const order = fogDropOrder(this.draggedFogId, remaining, event.clientY);
      this.fogOrder = order;
      this.persistViewState("fog-order", JSON.stringify(order));
    }

    private onFogDragEnd(event: DragEvent) {
      const pile = event.currentTarget;
      if (pile instanceof Element) {
        for (const card of pile.querySelectorAll(".fog-card.dragging")) {
          card.classList.remove("dragging");
        }
      }
      this.draggedFogId = undefined;
    }

    render() {
      const theme = this.theme;
      return this.mapOpen
        ? this.renderMapView(theme)
        : this.renderTableView(theme);
    }

    private renderTableView(theme: ExpeditionTheme) {
      const model = this.model;
      return html`<div class="expedition" data-theme=${theme}>
        ${this.renderHeader()}
        <div class="table">
          <div class="column left">
            ${this.renderBaseCamp()} ${this.renderBriefingDeck()}
            ${this.renderFogTray()} ${this.renderOnExpedition()}
          </div>
          <div class="column center">${this.renderMapCard(model, theme)}</div>
          <div class="column right">
            ${this.renderJournal()} ${this.renderDepot()}
            ${this.renderOutOfScope()}
          </div>
        </div>
      </div>`;
    }

    private renderMapView(theme: ExpeditionTheme) {
      const model = this.model;
      return html`<div class="expedition" data-theme=${theme}>
        ${new MapCanvas({
          model,
          theme,
          onClose: () => this.closeMap(),
          hoverId: this.hoverId,
          focusId: this.focusId,
          onHover: (id) => this.hover(id),
          onFocus: (id) => this.setFocus(id),
        }).render()}
      </div>`;
    }

    private renderHeader() {
      return html`<div class="header">
        <span class="emblem">▲</span>
        <div class="title-group">
          <span class="title">${this.flow.label}</span>
          <span class="status">${this.flow.status}</span>
        </div>
        <div class="actions">
          ${this.availableFlowActions.map((action) => {
            const onClick =
              action.createInstance !== undefined
                ? () => this.onCreate(action.id)
                : () => this.onFlowAction(action.id);
            return html`<button
              class=${action.variant}
              type="button"
              @click=${onClick}
            >
              ${action.label}
            </button>`;
          })}
        </div>
      </div>`;
    }

    // A base-camp card for each charting instance: the destination plus the
    // current session's actions (Done/Cancel for naming and frontier).
    private renderBaseCamp() {
      const charting = this.entries.filter(
        (entry) => entry.workflowId === "charting"
      );
      return html`<div class="station">
        <h2 class="station-head">Base camp</h2>
        <div class="pile">
          ${charting.map((entry, index) => {
            const destination = entry.state.workflowInstanceState.destination;
            return html`<div
              class="card${this.hotClass("base")}"
              style=${`--rot:${cardRotation(index)}`}
              data-id="base"
              tabindex="0"
              @mouseenter=${() => this.hover("base")}
              @mouseleave=${() => this.hover(undefined)}
              @focus=${() => this.hover("base")}
              @blur=${() => this.hover(undefined)}
              @click=${() => this.setFocus("base")}
              @keydown=${(event: KeyboardEvent) =>
                this.focusFromKey(event, "base")}
            >
              <div class="lbl">${entry.state.currentState}</div>
              <div class="card-title">${
                typeof destination === "string" && destination !== ""
                  ? destination
                  : "Base camp"
              }</div>
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`;
          })}
          ${
            charting.length === 0
              ? html`<div class="empty">No base camp yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    // Tickets actively being resolved (research, prototype, grilling, task,
    // recording) — the ascent in flight — with their state actions.
    private renderOnExpedition() {
      const resolving = this.entries.filter(
        (entry) =>
          entry.workflowId === "ticket" &&
          RESOLVING_STATES.includes(entry.state.currentState)
      );
      return html`<div class="station">
        <h2 class="station-head">On expedition</h2>
        <div class="pile">
          ${resolving.map((entry, index) => {
            const id = entry.id;
            return html`<div
              class="card${this.hotClass(id)}"
              style=${`--rot:${cardRotation(index)}`}
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.hover(id)}
              @mouseleave=${() => this.hover(undefined)}
              @focus=${() => this.hover(id)}
              @blur=${() => this.hover(undefined)}
              @click=${() => this.setFocus(id)}
              @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
            >
              <div class="lbl">${resolvingLabel(entry.state.currentState)}</div>
              <div class="card-title">${ticketTitle(entry)}</div>
              ${this.renderTaskStatus(entry)} ${this.renderTaskError(entry)}
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`;
          })}
          ${
            resolving.length === 0
              ? html`<div class="empty">Nothing in flight.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    // The live agent progress for an AFK task (research/prototype/grilling):
    // the model status is pushed into runningTaskContext as the call moves
    // routing -> dispatched -> thinking -> streaming, so the card shows the
    // agent is alive instead of looking frozen while upstream retries.
    private renderTaskStatus(entry: FlowViewProps["entries"][number]) {
      const state = entry.state;
      if (!state.hasRunningTask || state.runningTaskContext === null) {
        return nothing;
      }
      const ctx = state.runningTaskContext;
      if (ctx.role !== "ai-task") return nothing;
      const label = modelStatusLabel(ctx.modelStatus);
      return html`<div class="task-status">
        <span class="pulse"></span>
        <span>${label}</span>
      </div>`;
    }

    // The last agent failure: an errored resolution task (research or one of
    // the chat sessions) leaves its error in taskOutputs, so the card names
    // the reason the run stopped (the retry action sits right below).
    private renderTaskError(entry: FlowViewProps["entries"][number]) {
      if (entry.state.hasRunningTask) return nothing;
      for (const taskId of RESOLUTION_TASKS) {
        const outcome = entry.state.taskOutputs[taskId];
        if (outcome !== undefined && outcome.status === "error") {
          const error = readOutcomeError(outcome);
          return html`<div class="task-error">${error}</div>`;
        }
      }
      return nothing;
    }

    // A workflow instance's available state actions (everything is data — the
    // labels and ids come from the entry's availableActions, never hardcoded).
    private renderActions(entry: FlowViewProps["entries"][number]) {
      if (entry.availableActions.length === 0) return nothing;
      return html`<div class="card-actions">
        ${entry.availableActions.map(
          (action) => html`<button
            class=${action.variant}
            type="button"
            @click=${() => this.onAction(entry.id, action.id)}
          >
            ${action.label}
          </button>`
        )}
      </div>`;
    }

    // The live interactive session (naming, frontier, grilling, prototype,
    // task, specing), composed through the default <chat-session> element.
    private renderChat(entry: FlowViewProps["entries"][number]) {
      const state = entry.state;
      if (!state.hasRunningTask || state.runningTaskContext === null) {
        return nothing;
      }
      const ctx = state.runningTaskContext;
      if (ctx.role !== "ai-chat" || ctx.interactive !== true) return nothing;
      const workflowDef = this.workflowDefs.find(
        (def) => def.id === entry.workflowId
      );
      const stateDef = workflowDef?.states.find(
        (workflowState) => workflowState.id === state.currentState
      );
      return html`<div class="card-chat">
        <div class="session-header">
          <span class="session-label"
            >${stateDef?.label ?? state.currentState}</span
          >
        </div>
        <chat-session
          .messages=${ctx.messages}
          .sessionId=${ctx.sessionId}
          .interactive=${ctx.interactive}
          .thinking=${agentIsThinking(ctx.messages)}
          .modelStatus=${ctx.modelStatus}
          @hive-send-message=${(event: CustomEvent<{ content: string }>) => {
            this.onSendMessage(entry.id, event.detail.content);
          }}
        ></chat-session>
      </div>`;
    }

    private renderBriefingDeck() {
      const ready = this.ticketsInState("ready");
      return html`<div class="station">
        <h2 class="station-head">The briefing deck</h2>
        <div class="pile">
          ${ready.map((entry, index) => this.renderDossierCard(entry, index))}
          ${
            ready.length === 0
              ? html`<div class="empty">No claimable tickets yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderDossierCard(
      entry: FlowViewProps["entries"][number],
      index: number
    ) {
      const state = entry.state.workflowInstanceState;
      const title = ticketTitle(entry);
      const question =
        typeof state.question === "string" ? state.question : undefined;
      const type = typeof state.type === "string" ? state.type : undefined;
      const id = entry.id;
      return html`<div
        class="card${this.hotClass(id)}"
        style=${`--rot:${cardRotation(index)}`}
        data-id=${id}
        tabindex="0"
        @mouseenter=${() => this.hover(id)}
        @mouseleave=${() => this.hover(undefined)}
        @focus=${() => this.hover(id)}
        @blur=${() => this.hover(undefined)}
        @click=${() => this.setFocus(id)}
        @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
      >
        <div class="card-title">${title}</div>
        ${
          question !== undefined && question !== ""
            ? html`<div class="body">${question}</div>`
            : nothing
        }
        ${
          type !== undefined
            ? html`<span class="stamp">${type}</span>`
            : nothing
        }
        ${this.renderActions(entry)}
      </div>`;
    }

    private renderFogTray() {
      const fog = inClearOrder(this.ticketsInState("fog"), this.fogOrder);
      return html`<div class="station">
        <h2 class="station-head">The fog tray</h2>
        <div
          class="pile"
          @dragstart=${this.onFogDragStart}
          @dragover=${this.onFogDragOver}
          @drop=${this.onFogDrop}
          @dragend=${this.onFogDragEnd}
        >
          ${fog.map((entry, index) => this.renderFogCard(entry, index))}
          ${
            fog.length === 0
              ? html`<div class="empty">The fog is clear.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderFogCard(
      entry: FlowViewProps["entries"][number],
      index: number
    ) {
      const id = entry.id;
      return html`<div
        class="card fog-card${this.hotClass(id)}"
        style=${`--rot:${cardRotation(index)}`}
        data-id=${id}
        draggable="true"
        tabindex="0"
        @mouseenter=${() => this.hover(id)}
        @mouseleave=${() => this.hover(undefined)}
        @focus=${() => this.hover(id)}
        @blur=${() => this.hover(undefined)}
        @click=${() => this.setFocus(id)}
        @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
      >
        <div class="fog-title"><span class="q">?</span><span class="card-title">${ticketTitle(entry)}</span></div>
        <span class="tag">needs clarity</span>
        ${this.renderActions(entry)}
      </div>`;
    }

    private renderJournal() {
      const closed = this.ticketsInState("closed");
      return html`<div class="station">
        <h2 class="station-head">The journal</h2>
        <div class="journal">
          ${closed.map((entry) => {
            const id = entry.id;
            const record = decisionRecord(this.persistedOutputDirs, id);
            return html`<div
              class="entry${this.hotClass(id)}"
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.hover(id)}
              @mouseleave=${() => this.hover(undefined)}
              @focus=${() => this.hover(id)}
              @blur=${() => this.hover(undefined)}
              @click=${() => this.toggleDecision(id)}
              @keydown=${(event: KeyboardEvent) =>
                this.decisionFromKey(event, id)}
            >
              <span class="cairn">▴</span>
              <span class="txt">${ticketTitle(entry)}</span>
            </div>
            ${
              this.openDecisionId === id
                ? html`<div class="decision">
                    ${
                      record === undefined
                        ? html`<div class="decision-empty">
                            No decision record persisted.
                          </div>`
                        : html`<markdown-view .content=${record}></markdown-view>`
                    }
                  </div>`
                : nothing
            }`;
          })}
          ${
            closed.length === 0
              ? html`<div class="empty">No decisions recorded yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderDepot() {
      const builds = this.entries.filter(
        (entry) => entry.workflowId === "build"
      );
      const buildItems = this.entries.filter(
        (entry) => entry.workflowId === "buildItem"
      );
      const spec = this.persistedOutputs["spec.md"];
      const plan = this.persistedOutputs["build-plan.md"];
      const hasSpec = spec !== undefined && spec !== "";
      const hasPlan = plan !== undefined && plan !== "";
      const hasAny =
        hasSpec || hasPlan || builds.length > 0 || buildItems.length > 0;
      return html`<div class="station">
        <h2 class="station-head">The supply depot</h2>
        <div class="pile">
          ${
            hasSpec
              ? html`<div class="crate spec">
                <div class="lbl">manifest · spec</div>
                <div class="card-title">${firstLine(spec ?? "")}</div>
              </div>`
              : nothing
          }
          ${
            hasPlan
              ? html`<div class="crate">
                <div class="lbl">route plan</div>
                <div class="card-title">${firstLine(plan ?? "")}</div>
              </div>`
              : nothing
          }
          ${builds.map((entry, index) => {
            const id = entry.id;
            return html`<div
              class="crate${this.hotClass(id)}"
              style=${`--rot:${cardRotation(index)}`}
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.hover(id)}
              @mouseleave=${() => this.hover(undefined)}
              @focus=${() => this.hover(id)}
              @blur=${() => this.hover(undefined)}
              @click=${() => this.setFocus(id)}
              @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
            >
              <div class="lbl">build · ${entry.state.currentState}</div>
              <div class="card-title">The implementation phase</div>
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`;
          })}
          ${buildItems.map((entry, index) => {
            const id = entry.id;
            return html`<div
              class="crate${this.hotClass(id)}"
              style=${`--rot:${cardRotation(index)}`}
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.hover(id)}
              @mouseleave=${() => this.hover(undefined)}
              @focus=${() => this.hover(id)}
              @blur=${() => this.hover(undefined)}
              @click=${() => this.setFocus(id)}
              @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
            >
              <div class="lbl">gear · build item</div>
              <div class="card-title">${implementationTitle(entry)}</div>
              ${this.renderActions(entry)}
            </div>`;
          })}
          ${
            hasAny
              ? nothing
              : html`<div class="empty">No supplies yet — start a build.</div>`
          }
        </div>
      </div>`;
    }

    private renderOutOfScope() {
      const outOfScope = this.ticketsInState("out_of_scope");
      return html`<div class="station">
        <h2 class="station-head">Do not enter</h2>
        <div class="pile">
          ${outOfScope.map((entry) => {
            const id = entry.id;
            return html`<div
              class="card${this.hotClass(id)}"
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.hover(id)}
              @mouseleave=${() => this.hover(undefined)}
              @focus=${() => this.hover(id)}
              @blur=${() => this.hover(undefined)}
              @click=${() => this.setFocus(id)}
              @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
            >
              <div class="card-title">⊘ ${ticketTitle(entry)}</div>
              <span class="stamp">ruled out</span>
            </div>`;
          })}
          ${
            outOfScope.length === 0
              ? html`<div class="empty">Nothing ruled out.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderMapCard(model: WayfinderMap, theme: ExpeditionTheme) {
      return html`<div class="map-card">
        <div class="map-top">
          <div class="dest-note">
            <div class="name">${model.destination}</div>
            <div class="sub">Destination</div>
          </div>
          <button class="open-map" type="button" @click=${this.openMap}>
            Open the map view →
          </button>
        </div>
        ${this.miniMap(model, theme)}
      </div>`;
    }

    private miniMap(model: WayfinderMap, theme: ExpeditionTheme) {
      const glyphs = THEME_GLYPHS[theme];
      const accent = THEME_ACCENT[theme];
      const sx = 5.6;
      const sy = 4;
      const summit = model.nodes.find((node) => node.kind === "summit");
      return svg`<svg viewBox="0 0 560 400" role="img" aria-label="Expedition map">
        ${drawing.drawBackdrop(model.nodes, theme, sx, sy)}
        ${drawing.drawFrontier(model.nodes, sx, sy, accent)}
        ${drawing.drawTrail(model.nodes, sx, sy, accent)}
        ${
          summit !== undefined
            ? svg`<text
                x=${summit.x * sx}
                y=${summit.y * sy - 6}
                text-anchor="middle"
                font-size="20"
                fill=${accent}
              >${glyphs.summit}</text>`
            : nothing
        }
        ${model.nodes
          .filter((node) => node.kind !== "base" && node.kind !== "summit")
          .map((node) => {
            const id = node.id;
            return drawing.drawMarker(node, sx, sy, theme, {
              className: `marker${this.hotClass(id)}`,
              onEnter: () => this.hover(id),
              onLeave: () => this.hover(undefined),
              onClick: () => this.setFocus(id),
              onFocus: () => this.hover(id),
              onBlur: () => this.hover(undefined),
              onKeydown: (event) => this.focusFromKey(event, id),
            });
          })}
      </svg>`;
    }

    private ticketsInState(state: string) {
      return this.entries.filter(
        (entry) =>
          entry.workflowId === "ticket" && entry.state.currentState === state
      );
    }

    private openMap() {
      this.mapOpen = true;
      this.persistViewState("map-open", "1");
    }

    private closeMap() {
      this.mapOpen = false;
      this.persistViewState("map-open", "0");
    }
  }

  return { components: { "flow-component": FlowComponent } };
}

// The live model-call stage, human-readable for the card's status line.
function modelStatusLabel(status: ModelCallStatus | undefined): string {
  switch (status?.stage) {
    case "dispatched":
      return `researching via ${status.provider} · ${status.model}`;
    case "thinking":
      return "thinking…";
    case "streaming":
      return "writing the report…";
    case "complete":
      return "finalizing…";
    case "error":
      return `research error: ${status.message}`;
    default:
      return "routing the research call…";
  }
}

// Cards on the table sit at alternating small rotations (papers laid on a
// desk) — the sign flips per index so neighbours tilt opposite ways.
function cardRotation(index: number): string {
  const magnitude = 0.4 + ((index * 3) % 4) * 0.3;
  return `${index % 2 === 0 ? -magnitude : magnitude}deg`;
}

// The click-focus pulse plays for ~1s twice, then the focus state clears.
const FOCUS_CLEAR_MS = 2_000;

// The durable view-state keys are session-scoped per flow id: a remount or a
// page reload within the session restores the user's map view, theme
// override, and fog clear order, and one flow's state never leaks into
// another flow's keys.
function viewStateKey(flowId: string, suffix: string): string {
  return `hive:view:${flowId}:${suffix}`;
}

// The journal drill-in: the decision record for a closed ticket is the
// persisted decisions/<instanceId>.md file, read through the engine's
// persisted-output seam (flow-payload.ts reads it via readPersistedDirectory
// and ships it in the snapshot). Missing when the ticket has no record — the
// renderer degrades to a muted note rather than a broken pane.
function decisionRecord(
  dirs: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined,
  instanceId: string
): string | undefined {
  return dirs?.decisions?.[`${instanceId}.md`];
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

// Orders the fog tickets by the stored clear-order id list; entries absent
// from the list keep their natural relative order. The list is session-local
// — it survives re-renders and persists in sessionStorage keyed by flow id.
function inClearOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[]
): T[] {
  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    rank.set(id, index);
  });
  return [...items].sort((a, b) => {
    const ar = rank.get(a.id);
    const br = rank.get(b.id);
    if (ar === undefined && br === undefined) return 0;
    if (ar === undefined) return 1;
    if (br === undefined) return -1;
    return ar - br;
  });
}

// The new clear order after a fog drop: the dragged id re-enters before the
// first remaining card whose vertical middle sits below the pointer, or at
// the pile's end when the drop lands past every card.
function fogDropOrder(
  draggedId: string,
  remaining: ReadonlyArray<{ id: string; middle: number }>,
  dropY: number
): string[] {
  const rest = remaining.map((card) => card.id);
  const before = remaining.find((card) => dropY < card.middle);
  const at = before === undefined ? rest.length : rest.indexOf(before.id);
  const next = [...rest];
  next.splice(at, 0, draggedId);
  return next;
}

// The first non-empty line of a markdown file, for the depot crates' titles.
function firstLine(text: string): string {
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return first ?? text.slice(0, 60);
}

// The resolution tasks whose error can leave a ticket in a resolving state:
// research (ai-task) and the four chat resolution sessions.
const RESOLUTION_TASKS = [
  "research",
  "prototypeSession",
  "grillSession",
  "taskSession",
  "taskHitlSession",
];

// Reads the error message off a task-outcome entry (the wire shape is open;
// the read is defensive — an absent message reads as a generic failure).
function readOutcomeError(outcome: unknown): string {
  if (outcome === null || typeof outcome !== "object") return "unknown error";
  const error = (outcome as Record<string, unknown>).error;
  return typeof error === "string" && error !== "" ? error : "unknown error";
}

// The agent is composing its next reply while the transcript ends on anything
// but an assistant message (a user message it hasn't answered, or a tool
// result mid-loop).
function agentIsThinking(messages: readonly ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && last.role !== "assistant";
}
