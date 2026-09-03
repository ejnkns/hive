/** The wayfinder build-item card (served component "build-item-card"). Renders
 * one build ticket: the ticket contract (title / description / acceptance
 * criteria), the worker's outcome + summary, the reviewer's verdict + findings,
 * and the branch/worktree. Self-contained; the lit runtime arrives via the
 * factory. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  InstanceComponentProps,
} from "workflow-engine/workflow-types";

const RUN_TASK = "runAgent";
const REVIEW_TASK = "review";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, utilities, nothing } = lit;

  class BuildItemCard extends Base {
    static properties = {
      workflowDef: { attribute: false },
      instanceEntry: { attribute: false },
      customKinds: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
    };

    static styles = [
      utilities,
      css`
        :host {
          display: block;
        }
        .item {
          padding: 0.75rem 0.875rem;
        }
        .item-title {
          color: var(--text);
        }
        .item-desc {
          font-size: 0.625rem;
          white-space: pre-wrap;
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
        .branch-line {
          font-size: 0.5625rem;
          font-family: var(--font-mono, monospace);
        }
        .outcome {
          padding: 0.5rem 0.625rem;
          gap: 0.25rem;
        }
        .outcome-head {
          gap: 0.375rem;
          font-size: 0.5625rem;
          letter-spacing: 0.06em;
        }
        .outcome-head[data-outcome="implemented"] {
          color: var(--success);
        }
        .outcome-head[data-outcome="blocked"] {
          color: var(--error);
        }
        .outcome-summary {
          font-size: 0.625rem;
          color: var(--text);
          white-space: pre-wrap;
          margin: 0;
        }
        .review {
          padding: 0.5rem 0.625rem;
          gap: 0.375rem;
        }
        .review-verdict {
          font-size: 0.5625rem;
          letter-spacing: 0.06em;
        }
        .review-verdict[data-verdict="approved"] {
          color: var(--success);
        }
        .review-verdict[data-verdict="changes_requested"] {
          color: var(--error);
        }
        .review-finding {
          font-size: 0.5625rem;
        }
        .review-finding .axis {
          color: var(--text);
        }
        .item-actions {
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
      `,
    ];

    declare workflowDef: InstanceComponentProps["workflowDef"];
    declare instanceEntry: InstanceComponentProps["instanceEntry"];
    declare customKinds: InstanceComponentProps["customKinds"];
    declare onAction: InstanceComponentProps["onAction"] | undefined;
    declare onSendMessage: InstanceComponentProps["onSendMessage"] | undefined;

    render() {
      const state = this.instanceEntry.state;
      const instanceState = state.workflowInstanceState;
      const ticket = instanceState.ticket as
        | Record<string, unknown>
        | undefined;
      const title = readString(ticket, "title") ?? this.instanceEntry.id;
      const description = readString(ticket, "description");
      const acceptance = readStrings(ticket, "acceptanceCriteria");
      const dependsOn = Array.isArray(instanceState.dependsOn)
        ? (instanceState.dependsOn as string[])
        : [];
      const branchName = instanceState.branchName as string | undefined;
      const worktreePath = instanceState.worktreePath as string | undefined;
      const actions = this.instanceEntry.availableActions ?? [];

      return html`<div class="item border rounded-lg bg-surface flex flex-col gap-2">
        <div class="item-title text-base font-bold">${title}</div>
        ${
          description !== ""
            ? html`<p class="item-desc text-muted">${description}</p>`
            : nothing
        }
        ${
          acceptance.length > 0
            ? html`<ul class="acceptance text-muted">
              ${acceptance.map((item) => html`<li>${item}</li>`)}
            </ul>`
            : nothing
        }
        ${
          dependsOn.length > 0
            ? html`<div class="branch-line text-muted truncate">depends on: ${dependsOn.join(", ")}</div>`
            : nothing
        }
        ${
          branchName !== undefined && branchName !== ""
            ? html`<div class="branch-line text-muted truncate">
              ${branchName}${
                worktreePath !== undefined && worktreePath !== ""
                  ? ` · ${worktreePath}`
                  : ""
              }
            </div>`
            : nothing
        }
        ${this.renderOutcome()}
        ${this.renderReview()}
        ${
          actions.length > 0
            ? html`<div class="item-actions flex flex-wrap">
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

    private renderOutcome() {
      const outcome = this.instanceEntry.state.taskOutputs[RUN_TASK];
      // The worker session is ai-chat — completion args under output.completion.
      const result = readCompletionString(outcome, "outcome");
      const summary = readCompletionString(outcome, "summary");
      if (result === "") return nothing;
      return html`<div class="outcome bg-bg border rounded-md flex flex-col gap-1">
        <div class="outcome-head flex items-center font-bold uppercase" data-outcome=${result}>${result}</div>
        ${summary !== "" ? html`<pre class="outcome-summary">${summary}</pre>` : nothing}
      </div>`;
    }

    private renderReview() {
      const review = this.instanceEntry.state.taskOutputs[REVIEW_TASK];
      // The review is an ai-task — raw completion args.
      const verdict = readOutputString(review, "verdict");
      const findings = readOutputArray(review, "findings");
      if (verdict === "") return nothing;
      return html`<div class="review bg-bg border rounded-md flex flex-col">
        <div class="review-verdict font-bold uppercase" data-verdict=${verdict}>${verdict}</div>
        ${findings.map(
          (finding) => html`<div class="review-finding text-muted">
            <span class="axis font-bold">${readString(finding, "axis")}:</span>
            ${readString(finding, "detail")}
          </div>`
        )}
      </div>`;
    }
  }

  return { components: { "build-item-card": BuildItemCard } };
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

function readOutputString(outcome: unknown, field: string): string {
  if (outcome === null || typeof outcome !== "object") return "";
  const output = (outcome as Record<string, unknown>).output;
  if (output === null || typeof output !== "object") return "";
  return readString(output, field);
}

function readOutputArray(outcome: unknown, field: string): unknown[] {
  if (outcome === null || typeof outcome !== "object") return [];
  const output = (outcome as Record<string, unknown>).output;
  if (output === null || typeof output !== "object") return [];
  const value = (output as Record<string, unknown>)[field];
  return Array.isArray(value) ? (value as unknown[]) : [];
}

// Reads a string field off an ai-chat task's completion arguments (wrapped as
// output.completion.<field>).
function readCompletionString(outcome: unknown, field: string): string {
  if (outcome === null || typeof outcome !== "object") return "";
  const output = (outcome as Record<string, unknown>).output;
  if (output === null || typeof output !== "object") return "";
  const completion = (output as Record<string, unknown>).completion;
  if (completion === null || typeof completion !== "object") return "";
  const value = (completion as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}
