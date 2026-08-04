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

// The grouped per-workflow render: one section per workflow definition, with
// its workflow instances as cards (or a flow-declared custom instance
// component when one is registered, defaulting to WorkflowInstanceCard).
export class WorkflowInstances extends LitElement {
  static properties = {
    flowId: { type: String },
    workflowDefs: { attribute: false },
    instances: { attribute: false },
    customKinds: { attribute: false },
  };

  static styles = css`
    .flow {
      margin-bottom: 0.5rem;
    }

    .flow-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0;
    }

    .flow-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .flow-count {
      font-size: 0.5625rem;
      color: var(--muted);
      font-family: monospace;
    }

    .flow-instances {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
  `;

  flowId = "";
  workflowDefs: WorkflowDefResponse[] = [];
  instances: WorkflowInstanceEntry[] = [];
  customKinds: readonly CustomRenderKind[] = [];

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
          return html`<div class="flow">
            <div class="flow-header">
              <span class="flow-label">${def.label}</span>
              <span class="flow-count"
                >${entries.length}
                workflow instance${entries.length !== 1 ? "s" : ""}</span
              >
            </div>
            <div class="flow-instances">
              ${repeat(
                entries,
                (entry) => entry.id,
                (entry) => this.renderInstance(def, entry)
              )}
            </div>
          </div>`;
        }
      )}
    `;
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
