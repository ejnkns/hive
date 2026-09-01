import { css, html, LitElement, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  CustomRenderKind,
  ElementConstructor,
  FlowViewProps,
  WorkflowViewProps,
} from "workflow-engine/workflow-types";
import type { FlowLevelAction } from "../../flow-api.ts";
import { getComponentRenderer } from "../renderer-registry.ts";
import "./dynamic-element-host.ts";
import "./flow-actions-bar.ts";
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
    flow: { attribute: false },
    flowComponent: { type: String },
    workflowDefs: { attribute: false },
    instances: { attribute: false },
    customKinds: { attribute: false },
    availableFlowActions: { attribute: false },
    persistedOutputs: { attribute: false },
    persistedOutputDirs: { attribute: false },
  };

  static styles = [
    css`
      :host {
        display: block;
        height: 100%;
      }
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
  flow: FlowViewProps["flow"] | undefined = undefined;
  flowComponent: string | undefined = undefined;
  workflowDefs: WorkflowDefResponse[] = [];
  instances: WorkflowInstanceEntry[] = [];
  customKinds: readonly CustomRenderKind[] = [];
  availableFlowActions: FlowLevelAction[] = [];
  persistedOutputs: Record<string, string> = {};
  persistedOutputDirs: Record<string, Record<string, string>> = {};

  // Collapsed workflow sections, persisted to localStorage per flow. Lazy-loaded
  // so the set reflects each flow's stored state without a separate pass.
  private collapsedIds = new Set<string>();

  // The last flow-level custom class rendered, keyed to the flowComponent id
  // it was resolved for: a transient registry miss (async load in progress,
  // the cleanup window between unregister and re-register) keeps rendering the
  // last known class instead of flashing the default per-workflow boards.
  // Keyed by id so switching to a different component never reuses a stale
  // class from a previous flow.
  private lastFlowView:
    | { componentId: string | undefined; cls: ElementConstructor }
    | undefined;

  render() {
    const flowView = this.flowViewClass();
    if (flowView !== undefined) {
      return html`<dynamic-element-host
        .elementClass=${flowView}
        .props=${this.flowViewProps()}
      ></dynamic-element-host>`;
    }
    const defById = new Map(this.workflowDefs.map((def) => [def.id, def]));
    const entriesByWorkflow = new Map<string, WorkflowInstanceEntry[]>();
    for (const entry of this.instances) {
      const list = entriesByWorkflow.get(entry.workflowId) ?? [];
      list.push(entry);
      entriesByWorkflow.set(entry.workflowId, list);
    }

    return html`
      ${this.renderFlowActions()}
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

  // The flow-level custom class to render: the registry's current holder when
  // present, otherwise the last known class for this flowComponent id. Only
  // the first-ever mount (no class ever resolved for this component) falls
  // back to the default per-workflow boards.
  private flowViewClass(): ElementConstructor | undefined {
    const current = getComponentRenderer(this.flowComponent);
    if (current !== undefined) {
      this.lastFlowView = { componentId: this.flowComponent, cls: current };
      return current;
    }
    if (
      this.lastFlowView !== undefined &&
      this.lastFlowView.componentId === this.flowComponent
    ) {
      return this.lastFlowView.cls;
    }
    return undefined;
  }

  // The whole-body props a flow-level custom component receives (the trimmed
  // flow projection, every workflow + instance, the cross-workflow counts, the
  // declared persisted outputs, and the shell callbacks).
  private flowViewProps(): FlowViewProps {
    return {
      flow: this.flow ?? {
        id: this.flowId,
        label: this.flowId,
        status: "idle",
        config: {},
      },
      workflowDefs: this.workflowDefs,
      entries: this.instances,
      customKinds: this.customKinds,
      workflowCounts: this.workflowCounts(),
      availableFlowActions: this.availableFlowActions,
      persistedOutputs: this.persistedOutputs,
      persistedOutputDirs: this.persistedOutputDirs,
      onAction: (instanceId, actionId, payload) =>
        this.emitAction(instanceId, actionId, payload),
      onSendMessage: async (instanceId, content) => {
        this.emitSendMessage(instanceId, content);
      },
      onPatchState: (instanceId, values) =>
        this.emitPatchState(instanceId, values),
      onSelect: (instanceId) => this.emitSelect(instanceId),
      onFlowAction: (actionId) => this.emitFlowAction(actionId),
      onCreate: (actionId) => this.emitCreate(actionId),
    };
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
          workflowCounts: this.workflowCounts(),
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

  // The cross-workflow state counts the custom workflow views receive: per
  // workflow, the instance count by current state plus the engine-evaluated
  // dependency aggregates (waiting vs satisfied). A derived view over the
  // same snapshot the sections render — a workflow-level view uses it to
  // present sibling-workflow context and waiting-vs-actionable counts
  // without sibling entries.
  private workflowCounts(): WorkflowViewProps["workflowCounts"] {
    const entriesByWorkflow = new Map<string, WorkflowInstanceEntry[]>();
    for (const entry of this.instances) {
      const list = entriesByWorkflow.get(entry.workflowId) ?? [];
      list.push(entry);
      entriesByWorkflow.set(entry.workflowId, list);
    }
    return this.workflowDefs.map((def) => {
      const entries = entriesByWorkflow.get(def.id) ?? [];
      const byState: Record<string, number> = {};
      let waitingOnDependencies = 0;
      let dependenciesSatisfied = 0;
      for (const entry of entries) {
        byState[entry.state.currentState] =
          (byState[entry.state.currentState] ?? 0) + 1;
        if (entry.dependencies.unsatisfied.length > 0) {
          waitingOnDependencies += 1;
        } else if (entry.dependencies.blockers.length > 0) {
          dependenciesSatisfied += 1;
        }
      }
      return {
        workflowId: def.id,
        label: def.label,
        total: entries.length,
        byState,
        waitingOnDependencies,
        dependenciesSatisfied,
      };
    });
  }

  // The flow-level action strip (Add ticket / fog / build). The bar only
  // signals intent — the create-form dialog and the dispatch live in the
  // Svelte shell, which handles the hive-create / hive-flow-action events.
  private renderFlowActions() {
    if (this.availableFlowActions.length === 0) return nothing;
    return html`<flow-actions-bar
      .actions=${this.availableFlowActions}
      .onFlowAction=${(actionId: string) => this.emitFlowAction(actionId)}
      .onCreate=${(actionId: string) => this.emitCreate(actionId)}
    ></flow-actions-bar>`;
  }

  // The flow-level overview bar: shown when the flow has more than one
  // workflow or more than one instance — a single bare workflow needs no
  // at-a-glance summary.
  private renderOverview() {
    const overview = computeFlowOverview(this.workflowDefs, this.instances);
    // The overview summarizes breadth or urgency; it is noise when there is
    // nothing to summarize. A single workflow with instances (or none) needs
    // no at-a-glance bar — the section header shows the count, the boards
    // show the work, and a custom workflow view (the map) is already the
    // center. Show it only when several workflows hold instances, or any
    // workflow is running / waiting / errored.
    const activeWorkflows = overview.byWorkflow.filter(
      (workflow) => workflow.total > 0
    );
    const hasBreadth = activeWorkflows.length >= 2;
    const hasUrgency =
      overview.totals.running > 0 ||
      overview.totals.waiting > 0 ||
      overview.totals.error > 0;
    if (!hasBreadth && !hasUrgency) {
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

  private emitFlowAction(actionId: string): void {
    this.dispatchEvent(
      new CustomEvent("hive-flow-action", {
        detail: { flowId: this.flowId, actionId },
        bubbles: true,
        composed: true,
      })
    );
  }

  private emitCreate(actionId: string): void {
    this.dispatchEvent(
      new CustomEvent("hive-create", {
        detail: { flowId: this.flowId, actionId },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("workflow-instances", WorkflowInstances);
