/** The wayfinder ticket card (served component "ticket-card"). Renders a
 * decision ticket: type badge, question, dependsOn chips, HITL marker,
 * worktree/branch when the resolution workspace exists, the resolved-decision
 * preview from whichever resolution task ran, live HITL chat, and the state
 * actions. Self-contained (no value imports — the lit runtime arrives through
 * the default-export factory). */

import type {
  ChatMessage,
  FlowComponentDeps,
  FlowComponentRegistrations,
  InstanceComponentProps,
} from "workflow-engine/workflow-types";
import type { TicketType } from "./shared.ts";

// The resolution task ids per ticket type (the card previews whichever ran).
const RESEARCH_TASK = "research";
const CHAT_RESOLUTION_TASKS = [
  "prototypeSession",
  "grillSession",
  "taskSession",
  "taskHitlSession",
];

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class TicketCard extends Base {
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
      .ticket {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        padding: 0.75rem 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .ticket-head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .type-badge {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
        border: 1px solid var(--border);
        color: var(--muted);
      }
      .type-badge[data-type="research"] {
        color: var(--flow-accent, var(--accent));
        border-color: var(--flow-accent, var(--accent));
      }
      .type-badge[data-type="prototype"] {
        color: var(--success);
        border-color: var(--success);
      }
      .type-badge[data-type="grilling"] {
        color: #c07f0f;
        border-color: #c07f0f;
      }
      .type-badge[data-type="task"] {
        color: var(--text);
        border-color: var(--text);
      }
      .hitl-marker {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--bg);
        background: var(--flow-accent, var(--accent));
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
      }
      .ticket-title {
        font-weight: 700;
        font-size: 0.8125rem;
        color: var(--text);
      }
      .ticket-question {
        font-size: 0.6875rem;
        color: var(--muted);
        white-space: pre-wrap;
        margin: 0;
      }
      .depends-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }
      .depends-chip {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--text);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 0.125rem 0.375rem;
      }
      .branch-line {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .decision {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0.5rem 0.625rem;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .decision-gist {
        font-size: 0.6875rem;
        color: var(--text);
        margin: 0;
      }
      .decision-text {
        font-size: 0.625rem;
        color: var(--muted);
        white-space: pre-wrap;
        max-height: 6rem;
        overflow-y: auto;
        margin: 0;
      }
      .ticket-chat {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        border-top: 1px dashed var(--border);
        padding-top: 0.5rem;
      }
      .session-error {
        font-size: 0.625rem;
        color: var(--error);
        border: 1px solid var(--error);
        border-radius: 4px;
        padding: 0.375rem 0.5rem;
        background: var(--bg);
      }
      .session-header {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .session-label {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--flow-accent, var(--accent));
      }
      .session-desc {
        font-size: 0.625rem;
        color: var(--muted);
        margin: 0;
      }
      button {
        font-family: inherit;
        font-size: 0.625rem;
        height: 24px;
        padding: 0 0.5rem;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        cursor: pointer;
      }
      .ticket-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }
      .ticket-actions button {
        background: var(--bg);
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
      const type = instanceState.type as TicketType | undefined;
      const title =
        (instanceState.title as string | undefined) ?? this.instanceEntry.id;
      const question = instanceState.question as string | undefined;
      const dependsOn = Array.isArray(instanceState.dependsOn)
        ? (instanceState.dependsOn as string[])
        : [];
      const hitl = instanceState.hitl === true;
      const branchName = instanceState.branchName as string | undefined;
      const worktreePath = instanceState.worktreePath as string | undefined;
      const actions = this.instanceEntry.availableActions ?? [];

      return html`<div class="ticket">
        <div class="ticket-head">
          ${
            type !== undefined
              ? html`<span class="type-badge" data-type=${type}>${type}</span>`
              : nothing
          }
          ${hitl ? html`<span class="hitl-marker">hitl</span>` : nothing}
        </div>
        <div class="ticket-title">${title}</div>
        ${
          question !== undefined && question !== ""
            ? html`<p class="ticket-question">${question}</p>`
            : nothing
        }
        ${
          dependsOn.length > 0
            ? html`<div class="depends-chips">
              ${dependsOn.map(
                (id) => html`<span class="depends-chip">${id}</span>`
              )}
            </div>`
            : nothing
        }
        ${
          branchName !== undefined && branchName !== ""
            ? html`<div class="branch-line">
              ${branchName}${
                worktreePath !== undefined && worktreePath !== ""
                  ? ` · ${worktreePath}`
                  : ""
              }
            </div>`
            : nothing
        }
        ${this.renderDecision()}
        ${this.renderChat()}
        ${this.renderSessionError()}
        ${
          actions.length > 0
            ? html`<div class="ticket-actions">
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

    // The resolved-decision preview: the research task's findings report (an
    // ai-task — raw completion args), or the decision + gist of whichever chat
    // resolution task completed (ai-chat — completion args under
    // output.completion).
    private renderDecision() {
      const state = this.instanceEntry.state;
      const research = state.taskOutputs[RESEARCH_TASK];
      const findings = readOutputString(research, "findings");
      const researchSources = readOutputArray(research, "sources");
      if (findings !== "") {
        return html`<div class="decision">
          <p class="decision-text">${findings}</p>
          ${
            researchSources.length > 0
              ? html`<p class="decision-gist">${researchSources.length} sources</p>`
              : nothing
          }
        </div>`;
      }
      for (const taskId of CHAT_RESOLUTION_TASKS) {
        const outcome = state.taskOutputs[taskId];
        if (outcome === undefined || outcome.status !== "success") continue;
        const decision = readCompletionString(outcome, "decision");
        const gist = readCompletionString(outcome, "gist");
        if (decision === "" && gist === "") continue;
        return html`<div class="decision">
          ${gist !== "" ? html`<p class="decision-gist">${gist}</p>` : nothing}
          ${decision !== "" ? html`<p class="decision-text">${decision}</p>` : nothing}
        </div>`;
      }
      return nothing;
    }

    // The last resolution failure: an errored chat session leaves its error in
    // taskOutputs, so the card names the reason the session stopped (the retry
    // action sits right below in the action row).
    private renderSessionError() {
      const state = this.instanceEntry.state;
      if (state.hasRunningTask) return nothing;
      for (const taskId of CHAT_RESOLUTION_TASKS) {
        const outcome = state.taskOutputs[taskId];
        if (outcome !== undefined && outcome.status === "error") {
          const error = readOutcomeError(outcome);
          return html`<div class="session-error"
            >Resolution failed: ${error} — retry to start a new session.</div
          >`;
        }
      }
      return nothing;
    }

    // The live HITL chat: shown when an interactive ai-chat session runs (a
    // prototype/grilling/task session). Read-only transcript + reply input.
    private renderChat() {
      const state = this.instanceEntry.state;
      if (!state.hasRunningTask || state.runningTaskContext === null) {
        return nothing;
      }
      const ctx = state.runningTaskContext;
      if (ctx.role !== "ai-chat" || ctx.interactive !== true) return nothing;
      const stateDef = this.workflowDef.states.find(
        (s) => s.id === state.currentState
      );
      return html`<div class="ticket-chat">
        <div class="session-header">
          <span class="session-label">${stateDef?.label ?? state.currentState}</span>
          ${
            stateDef?.description !== undefined && stateDef.description !== ""
              ? html`<p class="session-desc">${stateDef.description}</p>`
              : nothing
          }
        </div>
        <chat-session
          .messages=${ctx.messages}
          .sessionId=${ctx.sessionId}
          .interactive=${ctx.interactive}
          .thinking=${agentIsThinking(ctx.messages)}
          .modelStatus=${ctx.modelStatus}
          @hive-send-message=${(event: CustomEvent<{ content: string }>) => {
            this.onSendMessage?.(event.detail.content);
          }}
        ></chat-session>
      </div>`;
    }
  }

  return { components: { "ticket-card": TicketCard } };
}

// The agent is composing its next reply while the transcript ends on a message
// it must answer (a user message it hasn't replied to yet, or a tool result
// mid-loop). A transcript that ends on the system prompt (or is empty) is a
// session waiting for its first user input — the agent is NOT thinking, and
// showing the indicator there is what makes a claimed-but-idle session look
// stuck.
function agentIsThinking(messages: readonly ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && (last.role === "user" || last.role === "tool");
}

// Reads a string field off a task-outcome output (the output shape is open;
// the read is defensive — an absent or non-string value reads as empty).
function readOutputString(outcome: unknown, field: string): string {
  if (outcome === null || typeof outcome !== "object") return "";
  const output = (outcome as Record<string, unknown>).output;
  if (output === null || typeof output !== "object") return "";
  const value = (output as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function readOutputArray(outcome: unknown, field: string): string[] {
  if (outcome === null || typeof outcome !== "object") return [];
  const output = (outcome as Record<string, unknown>).output;
  if (output === null || typeof output !== "object") return [];
  const value = (output as Record<string, unknown>)[field];
  return Array.isArray(value) ? (value as string[]) : [];
}

// Reads the error message off a task-outcome entry (the wire shape is open;
// the read is defensive — an absent message reads as a generic failure).
function readOutcomeError(outcome: unknown): string {
  if (outcome === null || typeof outcome !== "object") return "unknown error";
  const error = (outcome as Record<string, unknown>).error;
  return typeof error === "string" && error !== "" ? error : "unknown error";
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
