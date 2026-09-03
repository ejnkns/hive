/** The wayfinder table shell (served-module sibling of the flow component):
 * the explicit alternate table/workbench mode's chrome — a header carrying
 * the expedition identity, the data-driven flow actions, and the Map/Table
 * toggle — above the focused cartographer's-table workbench
 * (wayfinder-table.ts, composed by constructor). Kept a separate module from
 * the map shell so the map-first presentation and the table stay independent
 * renderers; the entry composes whichever the current view selects. */

import type { WorkflowDefResponse } from "workflow-engine/create-flow-runtime";
import type {
  FlowActionView,
  FlowComponentDeps,
  FlowViewProps,
} from "workflow-engine/workflow-types";
import type { WayfinderView } from "./shared.ts";
import type { WayfinderMap } from "./wayfinder-map.ts";
import type { WayfinderTableElement } from "./wayfinder-table.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";

// The entries slice of the flow-view props (kept as a named alias so the
// contract below reads tightly).
type FlowViewPropsEntries = FlowViewProps["entries"];

// The public shell contract the entry syncs each render: the flow identity,
// the presentation model + theme, the full entries/definitions/persisted
// payloads the workbench reads, the data-driven actions, and the callbacks
// the entry wires once at construction. Intersected with HTMLElement so the
// constructor type stays assignable to the served ElementConstructor
// contract.
export type TableShellElement = HTMLElement & {
  flowLabel: string;
  flowStatus: string;
  model: WayfinderMap;
  theme: ExpeditionTheme;
  entries: FlowViewPropsEntries;
  workflowDefs: readonly WorkflowDefResponse[];
  persistedOutputs: Readonly<Record<string, string>>;
  persistedOutputDirs: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  availableFlowActions: readonly FlowActionView[];
  hoverId: string | undefined;
  focusId: string | undefined;
  fogOrder: string[];
  onAction: ((id: string, actionId: string) => void) | undefined;
  onSendMessage: ((id: string, content: string) => Promise<void>) | undefined;
  onCreate: ((actionId: string) => void) | undefined;
  onFlowAction: ((actionId: string) => void) | undefined;
  onHover: ((id: string | undefined) => void) | undefined;
  onFocus: ((id: string) => void) | undefined;
  onFogOrderChange: ((order: string[]) => void) | undefined;
  onViewChange: ((view: WayfinderView) => void) | undefined;
};

export function createTableShell(options: {
  lit: FlowComponentDeps;
  // The focused table workbench class the entry registered: the shell
  // constructs it by constructor, so the constructed class must be the
  // registered one.
  Table: new () => WayfinderTableElement;
}): new () => TableShellElement {
  const { lit, Table } = options;
  const { LitElement: Base, html, css, utilities, nothing } = lit;

  class TableShell extends Base {
    static properties = {
      flowLabel: { attribute: false },
      flowStatus: { attribute: false },
      model: { attribute: false },
      theme: { type: String, reflect: true, attribute: "data-theme" },
      entries: { attribute: false },
      workflowDefs: { attribute: false },
      persistedOutputs: { attribute: false },
      persistedOutputDirs: { attribute: false },
      availableFlowActions: { attribute: false },
      hoverId: { attribute: false },
      focusId: { attribute: false },
      fogOrder: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
      onCreate: { attribute: false },
      onFlowAction: { attribute: false },
      onHover: { attribute: false },
      onFocus: { attribute: false },
      onFogOrderChange: { attribute: false },
      onViewChange: { attribute: false },
    };

    static styles = [
      utilities,
      css`
        :host {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        @media (max-width: 900px) {
          :host {
            flex: none;
          }
        }

        .header {
          gap: 0.625rem;
          padding: 0.5rem 0.75rem;
        }
        .emblem {
          color: var(--wf-accent);
          font-size: 1.25rem;
          line-height: 1;
        }
        .title-group {
          gap: 0.125rem;
        }
        .title {
          font-size: 0.875rem;
          color: var(--text);
        }
        .status {
          font-size: 0.625rem;
          letter-spacing: 0.06em;
        }
        .actions {
          margin-left: auto;
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
        .view-toggle {
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
      `,
    ];

    declare flowLabel: string;
    declare flowStatus: string;
    declare model: WayfinderMap;
    declare theme: ExpeditionTheme;
    declare entries: FlowViewPropsEntries;
    declare workflowDefs: readonly WorkflowDefResponse[];
    declare persistedOutputs: Readonly<Record<string, string>>;
    declare persistedOutputDirs: Readonly<
      Record<string, Readonly<Record<string, string>>>
    >;
    declare availableFlowActions: readonly FlowActionView[];
    declare hoverId: string | undefined;
    declare focusId: string | undefined;
    declare fogOrder: string[];
    declare onAction: ((id: string, actionId: string) => void) | undefined;
    declare onSendMessage:
      | ((id: string, content: string) => Promise<void>)
      | undefined;
    declare onCreate: ((actionId: string) => void) | undefined;
    declare onFlowAction: ((actionId: string) => void) | undefined;
    declare onHover: ((id: string | undefined) => void) | undefined;
    declare onFocus: ((id: string) => void) | undefined;
    declare onFogOrderChange: ((order: string[]) => void) | undefined;
    declare onViewChange: ((view: WayfinderView) => void) | undefined;

    // The persistent table workbench: constructed once and kept across
    // renders (and view switches), so the open journal drill-in and the fog
    // drag state survive a re-render. Referenced by constructor — never by
    // tag.
    private tableView: WayfinderTableElement | undefined;

    private ensureTableView(): WayfinderTableElement {
      const existing = this.tableView;
      if (existing !== undefined) return existing;
      const view: WayfinderTableElement = new Table();
      view.onAction = (id, actionId) => this.onAction?.(id, actionId);
      view.onSendMessage = async (id, content) => {
        await this.onSendMessage?.(id, content);
      };
      view.onHover = (id) => this.onHover?.(id);
      view.onFocus = (id) => this.onFocus?.(id);
      view.onFogOrderChange = (order) => this.onFogOrderChange?.(order);
      view.onViewChange = (selected) => this.onViewChange?.(selected);
      this.tableView = view;
      return view;
    }

    protected override updated(): void {
      // The persistent workbench is synced after every render (data flows
      // down; the callbacks are wired once at creation).
      const view = this.tableView;
      if (view === undefined) return;
      view.model = this.model;
      view.theme = this.theme;
      view.entries = this.entries;
      view.workflowDefs = this.workflowDefs;
      view.persistedOutputs = this.persistedOutputs;
      view.persistedOutputDirs = this.persistedOutputDirs;
      view.hoverId = this.hoverId;
      view.focusId = this.focusId;
      view.fogOrder = this.fogOrder;
    }

    render() {
      if (this.model === undefined) return nothing;
      return html`${this.renderHeader()} ${this.ensureTableView()}`;
    }

    private renderHeader() {
      return html`<div class="header flex-none flex items-center flex-wrap border rounded-lg bg-surface py-2 px-3">
        <span class="emblem">▲</span>
        <div class="title-group flex flex-col min-w-0">
          <span class="title font-bold">${this.flowLabel}</span>
          <span class="status text-muted uppercase">${this.flowStatus}</span>
        </div>
        <div class="actions flex flex-wrap">
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
        <div class="view-toggle inline-flex" role="group" aria-label="Expedition view">
          <button
            type="button"
            aria-pressed="false"
            @click=${() => this.onViewChange?.("map")}
          >
            Map
          </button>
          <button class="active" type="button" aria-pressed="true">
            Table
          </button>
        </div>
      </div>`;
    }
  }

  return TableShell;
}
