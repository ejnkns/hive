import { css, html, LitElement, nothing } from "lit";
import type {
  FlowOverview,
  WorkflowOverview,
} from "./workflow-instances/flow-overview.ts";

// The flow-level overview bar: a derived, at-a-glance summary of the whole
// flow instance — flow totals plus one chip per workflow WITH instances
// (label, count, status dot, actionable marker). Rendered above the
// per-workflow boards by workflow-instances; clicking a chip focuses that
// workflow's section. Workflows with no instances render no chip — an empty
// section has nothing to focus.
export class FlowOverviewBar extends LitElement {
  static properties = {
    overview: { attribute: false },
  };

  static styles = css`
    .overview {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      padding: 0.5rem 0 0.75rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 0.75rem;
    }

    .totals {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }

    .total {
      font-size: 0.6875rem;
      padding: 0.125rem 0.5rem;
      border-radius: 999px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
      white-space: nowrap;
    }

    .total b {
      color: var(--text);
      font-weight: 700;
    }

    .chips {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-family: inherit;
      font-size: 0.6875rem;
      padding: 0.25rem 0.625rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .chip:hover {
      background: var(--border);
      border-color: var(--muted);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--border);
      flex: none;
    }

    .dot-error {
      background: var(--error);
    }

    .dot-running {
      background: var(--flow-accent, var(--accent));
    }

    .dot-waiting {
      background: var(--flow-accent, var(--accent));
      opacity: 0.6;
    }

    .dot-complete {
      background: var(--success);
    }

    .chip-count {
      font-weight: 700;
    }

    .chip-actionable {
      color: var(--muted);
      border-left: 1px solid var(--border);
      padding-left: 0.375rem;
    }
  `;

  overview: FlowOverview = {
    totals: {
      instances: 0,
      running: 0,
      waiting: 0,
      error: 0,
      terminal: 0,
      actionable: 0,
    },
    byWorkflow: [],
  };

  render() {
    const { totals } = this.overview;
    return html`<div class="overview">
      <div class="totals">
        <span class="total"><b>${totals.instances}</b> instances</span>
        ${
          totals.running > 0
            ? html`<span class="total"><b>${totals.running}</b> running</span>`
            : nothing
        }
        ${
          totals.waiting > 0
            ? html`<span class="total"><b>${totals.waiting}</b> waiting</span>`
            : nothing
        }
        ${
          totals.error > 0
            ? html`<span class="total"><b>${totals.error}</b> error</span>`
            : nothing
        }
        ${
          totals.actionable > 0
            ? html`<span class="total"><b>${totals.actionable}</b> actionable</span>`
            : nothing
        }
      </div>
      <div class="chips">
        ${this.overview.byWorkflow
          .filter((workflow) => workflow.total > 0)
          .map((workflow) => this.renderWorkflow(workflow))}
      </div>
    </div>`;
  }

  private renderWorkflow(workflow: WorkflowOverview) {
    return html`<button
      class="chip"
      type="button"
      data-workflow-id=${workflow.workflowId}
      title="${workflow.label} — ${workflow.status}"
      @click=${() => this.focusWorkflow(workflow.workflowId)}
    >
      <span class="dot dot-${workflow.status}"></span>
      <span class="chip-label">${workflow.label}</span>
      <span class="chip-count">${workflow.total}</span>
      ${
        workflow.actionable > 0
          ? html`<span class="chip-actionable">${workflow.actionable} actionable</span>`
          : nothing
      }
    </button>`;
  }

  private focusWorkflow(workflowId: string): void {
    this.dispatchEvent(
      new CustomEvent("hive-focus-workflow", {
        detail: { workflowId },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("flow-overview", FlowOverviewBar);
