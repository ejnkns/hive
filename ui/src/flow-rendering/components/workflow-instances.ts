import { css, html, LitElement, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { CustomRenderKind } from "workflow-engine/workflow-types";
import { getComponentRenderer } from "../renderer-registry.ts";
import "./dynamic-element-host.ts";
import "./flow-overview.ts";
import {
  boardContentStyles,
  renderBoardContent,
} from "./workflow-instances/board-content.ts";
import { computeFlowOverview } from "./workflow-instances/flow-overview.ts";

// The grouped per-workflow render: one section per workflow definition, each a
// state-column board (a derived view — instances grouped by currentState in the
// workflow's declared state order), with flow-declared custom instance
// components replacing the default card where one is registered. A workflow
// declaring a workflow-level custom view (def.ui.workflowComponent — a served
// component rendering the entire workflow-instances section) replaces the
// middle content; the section header and page furniture stay standard.
export class WorkflowInstances extends LitElement {
  static properties = {
    flowId: { type: String },
    workflowDefs: { attribute: false },
    instances: { attribute: false },
    customKinds: { attribute: false },
  };

  static styles = [
    css`
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
    `,
    boardContentStyles,
  ];

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
      ${this.renderOverview()}
      ${repeat(
        [...entriesByWorkflow.entries()],
        ([workflowId]) => workflowId,
        ([workflowId, entries]) => {
          const def = defById.get(workflowId);
          if (def === undefined) return nothing;
          const collapsed = this.isCollapsed(workflowId);
          const running = entries.some((entry) => entry.state.hasRunningTask);
          return html`<div class="flow" data-workflow-id=${workflowId}>
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
              ${entries.length > 1 ? html`<span class="flow-count">${entries.length} workflow instances</span>` : nothing}
              ${running ? html`<span class="running-pulse"></span>` : nothing}
            </button>
            ${collapsed ? nothing : this.renderSectionContent(def, entries)}
          </div>`;
        }
      )}
    `;
  }

  // The workflow-instances section content: the registered workflow-level
  // custom view when the definition declares one (registry-resolved — an
  // unknown or failed component falls back to the canonical board), otherwise
  // the canonical grouped board/list.
  private renderSectionContent(
    def: WorkflowDefResponse,
    entries: WorkflowInstanceEntry[]
  ) {
    const customView = getComponentRenderer(def.ui?.workflowComponent);
    if (customView !== undefined) {
      return html`<dynamic-element-host
        .elementClass=${customView}
        .props=${{
          workflowDef: def,
          entries,
          customKinds: this.customKinds,
          onAction: (
            instanceId: string,
            actionId: string,
            payload?: Record<string, unknown>
          ) => {
            this.emitAction(instanceId, actionId, payload);
          },
          onSendMessage: (instanceId: string, content: string) => {
            this.emitSendMessage(instanceId, content);
          },
          onSelect: (instanceId: string) => {
            this.emitSelect(instanceId);
          },
        }}
      ></dynamic-element-host>`;
    }
    return renderBoardContent(def, entries, this.customKinds, {
      onAction: (
        instanceId: string,
        actionId: string,
        payload?: Record<string, unknown>
      ) => {
        this.emitAction(instanceId, actionId, payload);
      },
      onSendMessage: (instanceId: string, content: string) => {
        this.emitSendMessage(instanceId, content);
      },
      onPatchState: (instanceId: string, values: Record<string, unknown>) => {
        this.emitPatchState(instanceId, values);
      },
    });
  }

  // The flow-level overview bar: shown when the flow has more than one
  // workflow or more than one instance — a single bare workflow needs no
  // at-a-glance summary.
  private renderOverview() {
    const overview = computeFlowOverview(this.workflowDefs, this.instances);
    if (overview.byWorkflow.length <= 1 && overview.totals.instances <= 1) {
      return nothing;
    }
    return html`<flow-overview
      .overview=${overview}
      @hive-focus-workflow=${this.handleFocusWorkflow}
    ></flow-overview>`;
  }

  // Focus a workflow from an overview chip: expand its section (if collapsed)
  // and scroll it into view. The collapse state is persisted per flow like the
  // manual toggle; the scroll runs after the re-render settles.
  private handleFocusWorkflow = (
    event: CustomEvent<{ workflowId: string }>
  ) => {
    const workflowId = event.detail.workflowId;
    if (this.collapsedIds.has(workflowId)) {
      this.collapsedIds.delete(workflowId);
      localStorage.removeItem(`hive:collapse:${this.flowId}:${workflowId}`);
      this.requestUpdate();
    }
    setTimeout(() => {
      const header = this.renderRoot.querySelector(
        `[data-workflow-id="${workflowId}"] .flow-header`
      );
      header?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

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

  private emitAction(
    instanceId: string,
    actionId: string,
    payload?: Record<string, unknown>
  ): void {
    this.dispatchEvent(
      new CustomEvent("hive-action", {
        detail: { flowId: this.flowId, instanceId, actionId, payload },
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

  private emitPatchState(
    instanceId: string,
    values: Record<string, unknown>
  ): void {
    this.dispatchEvent(
      new CustomEvent("hive-patch-state", {
        detail: { flowId: this.flowId, instanceId, values },
        bubbles: true,
        composed: true,
      })
    );
  }

  private emitSelect(instanceId: string): void {
    this.dispatchEvent(
      new CustomEvent("hive-select", {
        detail: { flowId: this.flowId, instanceId },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("workflow-instances", WorkflowInstances);
