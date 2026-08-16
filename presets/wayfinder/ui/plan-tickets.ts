/** The "plan-tickets" custom render kind: the planner's tracer-bullet build
 * tickets ({ title, description, acceptanceCriteria, dependsOn }). Bound on
 * the build workflow's plan task output in the wayfinder definition. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css } = lit;

  class PlanTickets extends Base {
    static properties = {
      tickets: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
      }
      .tickets {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .ticket {
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg);
        padding: 0.5rem 0.625rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .ticket-title {
        font-size: 0.6875rem;
        font-weight: 700;
        color: var(--text);
      }
      .ticket-desc {
        font-size: 0.625rem;
        color: var(--muted);
        margin: 0;
      }
      .acceptance {
        font-size: 0.5625rem;
        color: var(--muted);
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .acceptance li::before {
        content: "— ";
        color: var(--flow-accent, var(--accent));
      }
      .depends {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--muted);
      }
    `;

    tickets: unknown[] = [];

    render() {
      const tickets = Array.isArray(this.tickets) ? this.tickets : [];
      return html`<div class="tickets">
        ${tickets.map(
          (ticket) => html`<div class="ticket">
            <div class="ticket-title">${readString(ticket, "title")}</div>
            ${
              readString(ticket, "description") !== ""
                ? html`<p class="ticket-desc"
                  >${readString(ticket, "description")}</p
                >`
                : ""
            }
            ${this.renderAcceptance(ticket)}
            ${this.renderDepends(ticket)}
          </div>`
        )}
      </div>`;
    }

    private renderAcceptance(ticket: unknown) {
      const items = readStrings(ticket, "acceptanceCriteria");
      if (items.length === 0) return "";
      return html`<ul class="acceptance">
        ${items.map((item) => html`<li>${item}</li>`)}
      </ul>`;
    }

    private renderDepends(ticket: unknown) {
      const depends = readStrings(ticket, "dependsOn");
      if (depends.length === 0) return "";
      return html`<div class="depends">depends on: ${depends.join(", ")}</div>`;
    }
  }

  return { kinds: { "plan-tickets": PlanTickets } };
}

function readString(item: unknown, field: string): string {
  if (item === null || typeof item !== "object") return "";
  const value = (item as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function readStrings(item: unknown, field: string): string[] {
  if (item === null || typeof item !== "object") return [];
  const value = (item as Record<string, unknown>)[field];
  return Array.isArray(value) ? (value as string[]) : [];
}
