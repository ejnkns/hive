/** The wayfinder build card (served component "build-card"). Renders a build
 * instance: the spec excerpt, the planner's ticket count (plan progress), and
 * the state actions. Self-contained; the lit runtime arrives via the factory. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  InstanceComponentProps,
} from "workflow-engine/workflow-types";

const PLAN_TASK = "plan";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class BuildCard extends Base {
    static properties = {
      workflowDef: { attribute: false },
      instanceEntry: { attribute: false },
      customKinds: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
      }
      .build {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        padding: 0.75rem 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .build-state {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--flow-accent, var(--accent));
      }
      .build-title {
        font-weight: 700;
        font-size: 0.8125rem;
        color: var(--text);
      }
      .spec-excerpt {
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
      .plan-progress {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--muted);
      }
      .build-actions {
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
    `;

    declare workflowDef: InstanceComponentProps["workflowDef"];
    declare instanceEntry: InstanceComponentProps["instanceEntry"];
    declare customKinds: InstanceComponentProps["customKinds"];
    declare onAction: InstanceComponentProps["onAction"] | undefined;
    declare onSendMessage: InstanceComponentProps["onSendMessage"] | undefined;

    render() {
      const state = this.instanceEntry.state;
      const instanceState = state.workflowInstanceState;
      const stateDef = this.workflowDef.states.find(
        (s) => s.id === state.currentState
      );
      const spec = instanceState.spec as string | undefined;
      const plan = state.taskOutputs[PLAN_TASK];
      const ticketCount = readOutputArrayLength(plan);
      const actions = this.instanceEntry.availableActions ?? [];

      return html`<div class="build">
        <div class="build-state">${stateDef?.label ?? state.currentState}</div>
        <div class="build-title">
          ${instanceState.destination ?? "Build phase"}
        </div>
        ${
          spec !== undefined && spec !== ""
            ? html`<pre class="spec-excerpt">${excerpt(spec, 280)}</pre>`
            : nothing
        }
        ${
          ticketCount > 0
            ? html`<div class="plan-progress"
              >${ticketCount} plan tickets</div
            >`
            : nothing
        }
        ${
          actions.length > 0
            ? html`<div class="build-actions">
              ${actions.map(
                (a) => html`<button
                  type="button"
                  @click=${() => this.onAction?.(a.id)}
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

  return { components: { "build-card": BuildCard } };
}

// The number of tickets the plan task produced (progress toward the fan-out).
function readOutputArrayLength(outcome: unknown): number {
  if (outcome === null || typeof outcome !== "object") return 0;
  const output = (outcome as Record<string, unknown>).output;
  if (output === null || typeof output !== "object") return 0;
  const tickets = (output as Record<string, unknown>).tickets;
  return Array.isArray(tickets) ? tickets.length : 0;
}

function excerpt(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
