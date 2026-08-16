/** The wayfinder frontier board (served component "frontier-board"): the
 * ticket workflow's custom workflow-instances view. A fog/frontier summary bar
 * above the canonical ticket board (composed via the globally-registered
 * <workflow-board-content> element — the served module stays import-free). */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  WorkflowViewProps,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css } = lit;

  class FrontierBoard extends Base {
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
      .frontier {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
        padding-top: 0.625rem;
      }
      .summary-bar {
        display: flex;
        gap: 0.375rem;
        flex-wrap: wrap;
      }
      .summary-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--surface);
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .summary-chip .count {
        font-family: var(--font-mono, monospace);
        font-weight: 400;
        color: var(--text);
      }
      .summary-chip[data-kind="fog"] {
        color: var(--muted);
      }
      .summary-chip[data-kind="frontier"] {
        color: var(--flow-accent, var(--accent));
        border-color: var(--flow-accent, var(--accent));
      }
      .summary-chip[data-kind="resolving"] {
        color: var(--text);
      }
      .summary-chip[data-kind="closed"] {
        color: var(--success);
        border-color: var(--success);
      }
    `;

    declare workflowDef: WorkflowViewProps["workflowDef"];
    declare entries: WorkflowViewProps["entries"];
    declare customKinds: WorkflowViewProps["customKinds"];
    declare onAction: WorkflowViewProps["onAction"] | undefined;
    declare onSendMessage: WorkflowViewProps["onSendMessage"] | undefined;
    declare onSelect: WorkflowViewProps["onSelect"] | undefined;

    render() {
      const counts = this.summaryCounts();
      return html`<div class="frontier">
        <div class="summary-bar">
          ${this.chip("fog", "fog", counts.fog)}
          ${this.chip("frontier", "frontier", counts.frontier)}
          ${this.chip("resolving", "resolving", counts.resolving)}
          ${this.chip("closed", "closed", counts.closed)}
        </div>
        <workflow-board-content
          .workflowDef=${this.workflowDef}
          .entries=${this.entries}
          .customKinds=${this.customKinds}
          .onAction=${this.onAction}
          .onSendMessage=${this.onSendMessage}
        ></workflow-board-content>
      </div>`;
    }

    private chip(
      kind: "fog" | "frontier" | "resolving" | "closed",
      label: string,
      count: number
    ) {
      return html`<span class="summary-chip" data-kind=${kind}
        >${label} <span class="count">${count}</span></span
      >`;
    }

    // Categorize each ticket entry by the workflow's curated board columns
    // (fog / frontier / resolving / closed) — the same lanes the board uses.
    private summaryCounts(): {
      fog: number;
      frontier: number;
      resolving: number;
      closed: number;
    } {
      const columnStates = new Map<string, Set<string>>();
      for (const column of this.workflowDef.ui?.columns ?? []) {
        columnStates.set(column.id, new Set(column.states));
      }
      const counts = { fog: 0, frontier: 0, resolving: 0, closed: 0 };
      for (const entry of this.entries) {
        const current = entry.state.currentState;
        for (const [columnId, states] of columnStates) {
          if (states.has(current)) {
            if (columnId in counts)
              counts[columnId as keyof typeof counts] += 1;
            break;
          }
        }
      }
      return counts;
    }
  }

  return { components: { "frontier-board": FrontierBoard } };
}
