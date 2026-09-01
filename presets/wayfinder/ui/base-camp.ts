/** The wayfinder Base Camp (served-module sibling of the flow component): the
 * empty-state presentation for a newly created flow — an expedition with no
 * content nodes yet. The entry renders this instead of the map/table shells
 * while the shared presentation model reports an empty expedition: the flow
 * identity, the destination (or its absence), the charting session's live
 * card (its actions start the journey), and a hint that the map opens once
 * the frontier is charted. The Map/Table toggle stays visible: the table is
 * always reachable (its stations are a useful workbench even empty), and the
 * sparse map degrades back to the Base Camp. */

import type { WorkflowDefResponse } from "workflow-engine/create-flow-runtime";
import type {
  FlowActionView,
  FlowComponentDeps,
  FlowViewProps,
} from "workflow-engine/workflow-types";
import type { WayfinderView } from "./shared.ts";
import type { WayfinderMap } from "./wayfinder-map.ts";
import { agentIsThinking } from "./wayfinder-status.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";

// The entries slice of the flow-view props.
type FlowViewPropsEntries = FlowViewProps["entries"];

// The public Base Camp contract the entry syncs each render: the flow
// identity, the empty presentation model (its destination), the charting
// entries/definitions the camp card reads, the data-driven flow actions, and
// the callbacks wired once at construction. Intersected with HTMLElement so
// the constructor type stays assignable to the served ElementConstructor
// contract.
export type BaseCampElement = HTMLElement & {
  flowLabel: string;
  flowStatus: string;
  model: WayfinderMap;
  theme: ExpeditionTheme;
  entries: FlowViewPropsEntries;
  workflowDefs: readonly WorkflowDefResponse[];
  availableFlowActions: readonly FlowActionView[];
  onAction: ((id: string, actionId: string) => void) | undefined;
  onSendMessage: ((id: string, content: string) => Promise<void>) | undefined;
  onCreate: ((actionId: string) => void) | undefined;
  onFlowAction: ((actionId: string) => void) | undefined;
  onViewChange: ((view: WayfinderView) => void) | undefined;
};

export function createBaseCamp(
  lit: FlowComponentDeps
): new () => BaseCampElement {
  const { LitElement: Base, html, css, nothing } = lit;

  class BaseCamp extends Base {
    static properties = {
      flowLabel: { attribute: false },
      flowStatus: { attribute: false },
      model: { attribute: false },
      theme: { type: String, reflect: true, attribute: "data-theme" },
      entries: { attribute: false },
      workflowDefs: { attribute: false },
      availableFlowActions: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
      onCreate: { attribute: false },
      onFlowAction: { attribute: false },
      onViewChange: { attribute: false },
    };

    static styles = css`
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
        .base-panel {
          overflow: visible;
        }
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
      .base-panel {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 1rem;
        max-width: 46rem;
        width: 100%;
        margin: 0 auto;
        padding: 1.5rem 1.25rem;
        border: 1px solid var(--wf-paper-edge);
        border-radius: 18px;
        background: var(--wf-paper);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      }
      .base-dest {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .base-dest .name {
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--wf-ink);
      }
      .base-dest .sub {
        font-size: 0.62rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--wf-body);
      }
      .card-notes {
        font-size: 0.72rem;
        line-height: 1.4;
        color: var(--wf-body);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
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
      .card {
        background: var(--wf-paper);
        border: 1px solid var(--wf-paper-edge);
        border-radius: 10px;
        padding: 0.75rem 0.85rem;
        box-shadow:
          0 2px 0 rgba(0, 0, 0, 0.3),
          0 5px 10px rgba(0, 0, 0, 0.3);
      }
      .card .lbl {
        font-size: 0.6rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .card .card-title {
        font-weight: 600;
        font-size: 0.84rem;
        color: var(--wf-ink);
        font-family: var(--wf-font);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
      .card-actions button.secondary {
        border-color: var(--border);
        color: var(--muted);
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
      .empty {
        font-size: 0.68rem;
        color: var(--muted);
        padding: 0.4rem 0;
      }
      .base-hint {
        margin: 0;
        font-size: 0.72rem;
        color: var(--wf-body);
        border-top: 1px dashed var(--wf-paper-edge);
        padding-top: 0.9rem;
      }
    `;

    declare flowLabel: string;
    declare flowStatus: string;
    declare model: WayfinderMap;
    declare theme: ExpeditionTheme;
    declare entries: FlowViewPropsEntries;
    declare workflowDefs: readonly WorkflowDefResponse[];
    declare availableFlowActions: readonly FlowActionView[];
    declare onAction: ((id: string, actionId: string) => void) | undefined;
    declare onSendMessage:
      | ((id: string, content: string) => Promise<void>)
      | undefined;
    declare onCreate: ((actionId: string) => void) | undefined;
    declare onFlowAction: ((actionId: string) => void) | undefined;
    declare onViewChange: ((view: WayfinderView) => void) | undefined;

    render() {
      if (this.model === undefined) return nothing;
      return html`${this.renderHeader()}
        <div class="base-panel">
          <div class="base-dest">
            <span class="name">${
              this.model.destination !== ""
                ? this.model.destination
                : "Uncharted territory"
            }</span>
            <span class="sub">destination</span>
          </div>
          ${this.renderChartingStation()}
          <p class="base-hint">
            The map is empty — chart the frontier to begin the expedition.
          </p>
        </div>`;
    }

    private renderHeader() {
      return html`<div class="header">
        <span class="emblem">▲</span>
        <div class="title-group">
          <span class="title">${this.flowLabel}</span>
          <span class="status">${this.flowStatus}</span>
        </div>
        <div class="actions">
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
          <button
            type="button"
            aria-pressed="true"
            @click=${() => this.onViewChange?.("map")}
          >
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
      </div>`;
    }

    // The charting session card — the one live thing on a new expedition:
    // its state label, the destination, and the session's actions (Start
    // charting / naming / frontier) plus the live chat while a session runs.
    private renderChartingStation() {
      const charting = this.entries.filter(
        (entry) => entry.workflowId === "charting"
      );
      return html`<div class="station">
        <h2 class="station-head">Base camp</h2>
        ${charting.map((entry) => {
          const destination = entry.state.workflowInstanceState.destination;
          const notes = entry.state.workflowInstanceState.notes;
          return html`<div class="card" data-id="base">
            <div class="lbl">${entry.state.currentState}</div>
            <div class="card-title">${
              typeof destination === "string" && destination !== ""
                ? destination
                : "Base camp"
            }</div>
            ${
              typeof notes === "string" && notes !== ""
                ? html`<div class="card-notes">${notes}</div>`
                : nothing
            }
            ${this.renderActions(entry)} ${this.renderChat(entry)}
          </div>`;
        })}
        ${
          charting.length === 0
            ? html`<div class="empty">No base camp yet.</div>`
            : nothing
        }
      </div>`;
    }

    private renderActions(entry: FlowViewPropsEntries[number]) {
      if (entry.availableActions.length === 0) return nothing;
      return html`<div class="card-actions">
        ${entry.availableActions.map(
          (action) => html`<button
            class=${action.variant}
            type="button"
            @click=${() => this.onAction?.(entry.id, action.id)}
          >
            ${action.label}
          </button>`
        )}
      </div>`;
    }

    // The live interactive naming/frontier session, composed through the
    // default <chat-session> element.
    private renderChat(entry: FlowViewPropsEntries[number]) {
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
            this.onSendMessage?.(entry.id, event.detail.content);
          }}
        ></chat-session>
      </div>`;
    }
  }

  return BaseCamp;
}
