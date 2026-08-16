/** The wayfinder build pipeline (served component "build-pipeline"): the build
 * workflow's custom workflow-instances view. Renders each build instance as a
 * stage along spec → planned → proposed → accepted, with the spec excerpt and
 * the planner's ticket count. The pipeline IS the build section's content (the
 * list view it replaces was the generic fallback). */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  WorkflowViewProps,
} from "workflow-engine/workflow-types";

const PLAN_TASK = "plan";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class BuildPipeline extends Base {
    static properties = {
      workflowDef: { attribute: false },
      entries: { attribute: false },
      customKinds: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
      onSelect: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
      }
      .pipeline {
        padding-top: 0.625rem;
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }
      .stage {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        padding: 0.75rem 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .stage-head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .stage-state {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--flow-accent, var(--accent));
      }
      .stage-title {
        font-weight: 700;
        font-size: 0.8125rem;
        color: var(--text);
      }
      .stage-spec {
        font-size: 0.625rem;
        color: var(--muted);
        white-space: pre-wrap;
        max-height: 6rem;
        overflow-y: auto;
        margin: 0;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0.5rem 0.625rem;
      }
      .stage-tickets {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--muted);
      }
      .stage-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }
      button {
        font-family: inherit;
        font-size: 0.625rem;
        height: 24px;
        padding: 0 0.5rem;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: var(--bg);
        color: var(--text);
        cursor: pointer;
      }
      .empty {
        padding: 1.5rem 1rem;
        text-align: center;
        color: var(--muted);
        font-size: 0.6875rem;
        border: 1px dashed var(--border);
        border-radius: 8px;
      }
    `;

    declare workflowDef: WorkflowViewProps["workflowDef"];
    declare entries: WorkflowViewProps["entries"];
    declare customKinds: WorkflowViewProps["customKinds"];
    declare onAction: WorkflowViewProps["onAction"] | undefined;
    declare onSendMessage: WorkflowViewProps["onSendMessage"] | undefined;
    declare onSelect: WorkflowViewProps["onSelect"] | undefined;

    render() {
      const entries = [...this.entries].sort(
        (a, b) =>
          stageIndex(a.state.currentState) - stageIndex(b.state.currentState)
      );
      if (entries.length === 0) {
        return html`<div class="pipeline">
          <div class="empty">No build phase yet — Start build once the map is clear.</div>
        </div>`;
      }
      return html`<div class="pipeline">
        ${entries.map((entry) => this.renderStage(entry))}
      </div>`;
    }

    private renderStage(entry: WorkflowViewProps["entries"][number]) {
      const state = entry.state;
      const instanceState = state.workflowInstanceState;
      const stateDef = this.workflowDef.states.find(
        (s) => s.id === state.currentState
      );
      const spec = instanceState.spec as string | undefined;
      const ticketCount = readTicketsLength(state.taskOutputs[PLAN_TASK]);
      const actions = entry.availableActions ?? [];
      return html`<div class="stage">
        <div class="stage-head">
          <span class="stage-state">${stateDef?.label ?? state.currentState}</span>
        </div>
        <div class="stage-title">
          ${(instanceState.destination as string | undefined) ?? "Build phase"}
        </div>
        ${
          spec !== undefined && spec !== ""
            ? html`<pre class="stage-spec">${excerpt(spec, 220)}</pre>`
            : nothing
        }
        ${
          ticketCount > 0
            ? html`<div class="stage-tickets">${ticketCount} plan tickets</div>`
            : nothing
        }
        ${
          actions.length > 0
            ? html`<div class="stage-actions">
              ${actions.map(
                (a) => html`<button
                  type="button"
                  @click=${() => this.onAction?.(entry.id, a.id)}
                >
                  ${a.label}
                </button>`
              )}
            </div>`
            : nothing
        }
      </div>`;
    }
  }

  return { components: { "build-pipeline": BuildPipeline } };
}

// The build progression order: specing → planned → proposed → finalizing →
// accepted (entries sort into the pipeline).
function stageIndex(currentState: string): number {
  switch (currentState) {
    case "specing":
      return 0;
    case "planned":
      return 1;
    case "proposed":
      return 2;
    case "finalizing":
      return 3;
    case "accepted":
      return 4;
    default:
      return 0;
  }
}

function readTicketsLength(outcome: unknown): number {
  if (outcome === null || typeof outcome !== "object") return 0;
  const output = (outcome as Record<string, unknown>).output;
  if (output === null || typeof output !== "object") return 0;
  const tickets = (output as Record<string, unknown>).tickets;
  return Array.isArray(tickets) ? tickets.length : 0;
}

function excerpt(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
