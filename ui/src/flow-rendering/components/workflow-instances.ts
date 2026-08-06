import { css, html, LitElement, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { CustomRenderKind } from "workflow-engine/workflow-types";
import { getComponentRenderer } from "../renderer-registry";
import "./dynamic-element-host";
import { WorkflowInstanceCard } from "./workflow-instance-card";
import { groupInstancesByState } from "./workflow-instances/group-by-state";

// The structural column shape groupInstancesByState returns; declared locally
// so the renderer does not import a type from the private grouping module.
type Column = {
  stateId: string;
  label: string;
  category: string;
  entries: WorkflowInstanceEntry[];
};

// The grouped per-workflow render: one section per workflow definition, each a
// state-column board (a derived view — instances grouped by currentState in the
// workflow's declared state order), with flow-declared custom instance
// components replacing the default card where one is registered.
export class WorkflowInstances extends LitElement {
  static properties = {
    flowId: { type: String },
    workflowDefs: { attribute: false },
    instances: { attribute: false },
    customKinds: { attribute: false },
  };

  static styles = css`
    .flow {
      margin-bottom: 1rem;
    }

    .flow:last-child {
      margin-bottom: 0;
    }

    .flow-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0 0.5rem;
      border-bottom: 1px solid var(--border);
      background: transparent;
      border-top: none;
      border-left: none;
      border-right: none;
      width: 100%;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .flow-chevron {
      display: inline-block;
      width: 0;
      height: 0;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 5px solid var(--muted);
      transition: transform 0.15s;
    }

    .flow-chevron[data-collapsed="true"] {
      transform: rotate(-90deg);
    }

    .flow-label {
      font-size: 0.6875rem;
      font-weight: 700;
      color: var(--text);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .flow-count {
      font-size: 0.5625rem;
      color: var(--muted);
      font-family: monospace;
    }

    .running-pulse {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--warning);
      animation: live-pulse 1.6s ease-in-out infinite;
    }

    @keyframes live-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.3;
      }
    }

    .flow-board {
      display: flex;
      align-items: flex-start;
      gap: 0.625rem;
      overflow-x: auto;
      padding-top: 0.625rem;
    }

    .board-column {
      flex: 1 1 0;
      min-width: 200px;
      max-width: 300px;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .board-column[data-empty="true"] {
      min-width: 150px;
      opacity: 0.45;
    }

    .column-header {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      font-size: 0.5625rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .column-header[data-category="initial"] {
      color: var(--muted);
    }

    .column-header[data-category="terminal"] {
      color: var(--success);
      border-color: var(--success);
    }

    .column-header[data-category="error"] {
      color: var(--error);
      border-color: var(--error);
    }

    .column-count {
      margin-left: auto;
      color: var(--muted);
      font-family: monospace;
    }

    .column-body {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
  `;

  flowId = "";
  workflowDefs: WorkflowDefResponse[] = [];
  instances: WorkflowInstanceEntry[] = [];
  customKinds: readonly CustomRenderKind[] = [];

  // Collapsed workflow sections, persisted to localStorage per flow. Lazy-loaded
  // so the set reflects each flow's stored state without a separate pass.
  private collapsedIds = new Set<string>();

  render() {
    const defById = new Map(this.workflowDefs.map((def) => [def.id, def]));
    const entriesByWorkflow = new Map<string, WorkflowInstanceEntry[]>();
    for (const entry of this.instances) {
      const list = entriesByWorkflow.get(entry.workflowId) ?? [];
      list.push(entry);
      entriesByWorkflow.set(entry.workflowId, list);
    }

    return html`
      ${repeat(
        [...entriesByWorkflow.entries()],
        ([workflowId]) => workflowId,
        ([workflowId, entries]) => {
          const def = defById.get(workflowId);
          if (def === undefined) return nothing;
          const collapsed = this.isCollapsed(workflowId);
          const running = entries.some((entry) => entry.state.hasRunningTask);
          return html`<div class="flow">
            <button
              class="flow-header"
              type="button"
              aria-expanded=${!collapsed}
              @click=${() => this.toggle(workflowId)}
            >
              <span
                class="flow-chevron"
                data-collapsed=${collapsed ? "true" : "false"}
              ></span>
              <span class="flow-label">${def.label}</span>
              <span class="flow-count"
                >${entries.length}
                workflow instance${entries.length !== 1 ? "s" : ""}</span
              >
              ${running ? html`<span class="running-pulse"></span>` : nothing}
            </button>
            ${
              collapsed
                ? nothing
                : html`<div class="flow-board">
                    ${groupInstancesByState(def.states, entries).map((column) =>
                      this.renderColumn(def, column)
                    )}
                  </div>`
            }
          </div>`;
        }
      )}
    `;
  }

  private isCollapsed(workflowId: string): boolean {
    if (!this.collapsedIds.has(workflowId)) {
      const stored = localStorage.getItem(
        `hive:collapse:${this.flowId}:${workflowId}`
      );
      if (stored === "1") this.collapsedIds.add(workflowId);
    }
    return this.collapsedIds.has(workflowId);
  }

  private toggle(workflowId: string): void {
    const key = `hive:collapse:${this.flowId}:${workflowId}`;
    if (this.collapsedIds.has(workflowId)) {
      this.collapsedIds.delete(workflowId);
      localStorage.setItem(key, "0");
    } else {
      this.collapsedIds.add(workflowId);
      localStorage.setItem(key, "1");
    }
    this.requestUpdate();
  }

  private renderColumn(def: WorkflowDefResponse, column: Column) {
    return html`<div
      class="board-column"
      data-category=${column.category}
      data-empty=${column.entries.length === 0 ? "true" : "false"}
    >
      <div class="column-header" data-category=${column.category}>
        <span class="column-label">${column.label}</span>
        <span class="column-count">${column.entries.length}</span>
      </div>
      ${
        column.entries.length > 0
          ? html`<div class="column-body">
            ${repeat(
              column.entries,
              (entry) => entry.id,
              (entry) => this.renderInstance(def, entry)
            )}
          </div>`
          : nothing
      }
    </div>`;
  }

  private renderInstance(
    def: WorkflowDefResponse,
    entry: WorkflowInstanceEntry
  ) {
    const customComponent = getComponentRenderer(def.ui?.instanceComponent);
    const component = customComponent ?? WorkflowInstanceCard;
    return html`<dynamic-element-host
      .elementClass=${component}
      .props=${{
        workflowDef: def,
        instanceEntry: entry,
        customKinds: this.customKinds,
        onAction: (actionId: string) => {
          this.emitAction(entry.id, actionId);
        },
        onSendMessage: (content: string) => {
          this.emitSendMessage(entry.id, content);
        },
      }}
    ></dynamic-element-host>`;
  }

  private emitAction(instanceId: string, actionId: string): void {
    this.dispatchEvent(
      new CustomEvent("hive-action", {
        detail: { flowId: this.flowId, instanceId, actionId },
        bubbles: true,
        composed: true,
      })
    );
  }

  private emitSendMessage(instanceId: string, content: string): void {
    this.dispatchEvent(
      new CustomEvent("hive-send-message", {
        detail: { flowId: this.flowId, instanceId, content },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("workflow-instances", WorkflowInstances);
