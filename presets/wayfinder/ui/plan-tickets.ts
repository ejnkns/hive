/** The "plan-tickets" custom render kind: the planner's tracer-bullet build
 * tickets ({ title, description, acceptanceCriteria, dependsOn }). Bound on
 * the build workflow's plan task output in the wayfinder definition. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, utilities } = lit;

  class PlanTickets extends Base {
    static properties = {
      tickets: { attribute: false },
    };

    static styles = [
      utilities,
      css`
        :host {
          display: block;
        }
        .tickets {
          gap: 0.375rem;
        }
        .ticket {
          padding: 0.5rem 0.625rem;
          gap: 0.25rem;
        }
        .ticket-title {
          color: var(--text);
        }
        .ticket-desc {
          font-size: 0.625rem;
          margin: 0;
        }
        .acceptance {
          font-size: 0.5625rem;
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
        }
      `,
    ];

    tickets: unknown[] = [];

    render() {
      const tickets = Array.isArray(this.tickets) ? this.tickets : [];
      return html`<div class="tickets flex flex-col">
        ${tickets.map(
          (
            ticket
          ) => html`<div class="ticket border rounded-md bg-bg flex flex-col gap-1">
            <div class="ticket-title text-xs font-bold">${readString(ticket, "title")}</div>
            ${
              readString(ticket, "description") !== ""
                ? html`<p class="ticket-desc text-muted"
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
      return html`<ul class="acceptance text-muted">
        ${items.map((item) => html`<li>${item}</li>`)}
      </ul>`;
    }

    private renderDepends(ticket: unknown) {
      const depends = readStrings(ticket, "dependsOn");
      if (depends.length === 0) return "";
      return html`<div class="depends text-muted">depends on: ${depends.join(", ")}</div>`;
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
