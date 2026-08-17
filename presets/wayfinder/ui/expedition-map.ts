/** The wayfinder expedition map (served component "expedition-map"): the
 * charting workflow's custom workflow-instances view. Renders each charting
 * instance as a destination on the map — destination + notes, the
 * fog → frontier → charted progression, and the frontier session's live chat
 * — with a map header showing how far the expedition has charted. Composes
 * nothing: the map IS the charting section's content (the list view it
 * replaces was the generic fallback). */

import type {
  ChatMessage,
  FlowComponentDeps,
  FlowComponentRegistrations,
  WorkflowViewProps,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class ExpeditionMap extends Base {
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
      .map {
        padding-top: 0.625rem;
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }
      .map-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
      }
      .map-emblem {
        font-family: var(--font-mono, monospace);
        color: var(--flow-accent, var(--accent));
        font-size: 1rem;
        line-height: 1;
      }
      .map-title {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text);
      }
      .map-heading {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
      }
      .map-subtitle {
        font-size: 0.625rem;
        color: var(--muted);
        margin: 0;
      }
      .map-progress {
        margin-left: auto;
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--muted);
      }
      .map-destinations {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }
      .destination {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        padding: 0.75rem 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .destination-head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .destination-title {
        font-weight: 700;
        font-size: 0.8125rem;
        color: var(--text);
      }
      .destination-notes {
        font-size: 0.625rem;
        color: var(--muted);
        white-space: pre-wrap;
        margin: 0;
      }
      .trail {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .trail-step {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        padding: 0.125rem 0.375rem;
        border: 1px solid var(--border);
        border-radius: 4px;
      }
      .trail-step[data-reached="true"] {
        color: var(--flow-accent, var(--accent));
        border-color: var(--flow-accent, var(--accent));
      }
      .trail-step[data-current="true"] {
        background: var(--flow-accent, var(--accent));
        color: var(--bg);
        border-color: var(--flow-accent, var(--accent));
      }
      .trail-arrow {
        color: var(--muted);
        font-size: 0.5625rem;
      }
      .map-chat {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        border-top: 1px dashed var(--border);
        padding-top: 0.5rem;
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
      .map-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }

      .map-actions button {
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
    `;

    declare workflowDef: WorkflowViewProps["workflowDef"];
    declare entries: WorkflowViewProps["entries"];
    declare customKinds: WorkflowViewProps["customKinds"];
    declare workflowCounts: WorkflowViewProps["workflowCounts"];
    declare onAction: WorkflowViewProps["onAction"] | undefined;
    declare onSendMessage: WorkflowViewProps["onSendMessage"] | undefined;
    declare onSelect: WorkflowViewProps["onSelect"] | undefined;

    render() {
      const terminal = this.workflowDef.terminalStates;
      const charted = this.entries.filter((entry) =>
        terminal.includes(entry.state.currentState)
      ).length;
      return html`<div class="map">
        <div class="map-header">
          <span class="map-emblem">▲</span>
          <div class="map-heading">
            <span class="map-title">Expedition map</span>
            ${
              this.workflowDef.description !== undefined &&
              this.workflowDef.description !== ""
                ? html`<p class="map-subtitle">${this.workflowDef.description}</p>`
                : nothing
            }
          </div>
          <span class="map-progress"
            >${charted} of ${this.entries.length} charted</span
          >
        </div>
        <div class="map-destinations">
          ${this.entries.map((entry) => this.renderDestination(entry))}
        </div>
        ${charted > 0 ? this.renderFrontierSummary() : nothing}
      </div>`;
    }

    // The frontier, once the map is charted: the ticket workflow's state
    // counts — fog, frontier (ready), resolving, decisions so far (closed),
    // out of scope. The ticket workflow may not exist yet (nothing created);
    // the chips render zeros then.
    private renderFrontierSummary() {
      const ticket = this.workflowCounts.find(
        (workflow) => workflow.workflowId === "ticket"
      );
      const byState = ticket?.byState ?? {};
      const fog = byState["fog"] ?? 0;
      const frontier = byState["ready"] ?? 0;
      const resolving =
        (byState["resolving_research"] ?? 0) +
        (byState["resolving_prototype"] ?? 0) +
        (byState["resolving_grilling"] ?? 0) +
        (byState["resolving_task"] ?? 0) +
        (byState["resolving_task_hitl"] ?? 0) +
        (byState["recording"] ?? 0);
      const decisions = byState["closed"] ?? 0;
      const outOfScope = byState["out_of_scope"] ?? 0;
      return html`<div class="frontier-summary">
        <div class="frontier-summary-label">Frontier</div>
        <div class="frontier-chips">
          ${this.chip("fog", "fog", fog)}
          ${this.chip("frontier", "frontier", frontier)}
          ${this.chip("resolving", "resolving", resolving)}
          ${this.chip("decisions", "decisions", decisions)}
          ${this.chip("out-of-scope", "out of scope", outOfScope)}
        </div>
      </div>`;
    }

    private chip(
      kind: "fog" | "frontier" | "resolving" | "decisions" | "out-of-scope",
      label: string,
      count: number
    ) {
      return html`<span class="frontier-chip" data-kind=${kind}
        >${label} <span class="count">${count}</span></span
      >`;
    }

    private renderDestination(entry: WorkflowViewProps["entries"][number]) {
      const state = entry.state;
      const instanceState = state.workflowInstanceState;
      const destination =
        (instanceState.destination as string | undefined) ?? entry.id;
      const notes = instanceState.notes as string | undefined;
      const actions = entry.availableActions ?? [];
      return html`<div class="destination">
        <div class="destination-head">
          <div class="trail">
            ${this.trailSteps().map((step) => {
              const reached = stateIndex(state.currentState) >= step.index;
              const current = state.currentState === step.stateId;
              return html`<span
                class="trail-step"
                data-reached=${reached ? "true" : "false"}
                data-current=${current ? "true" : "false"}
                >${step.label}</span
              >${
                step.index < 2
                  ? html`<span class="trail-arrow">→</span>`
                  : nothing
              }`;
            })}
          </div>
        </div>
        <div class="destination-title">${destination}</div>
        ${
          notes !== undefined && notes !== ""
            ? html`<p class="destination-notes">${notes}</p>`
            : nothing
        }
        ${this.renderChat(entry)}
        ${
          actions.length > 0
            ? html`<div class="map-actions">
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

    // The charting progression: fog (no_session/naming) → frontier → charted.
    private trailSteps(): Array<{
      label: string;
      stateId: string;
      index: number;
    }> {
      return [
        { label: "fog", stateId: "no_session", index: 0 },
        { label: "frontier", stateId: "frontier", index: 1 },
        { label: "charted", stateId: "charted", index: 2 },
      ];
    }

    private renderChat(entry: WorkflowViewProps["entries"][number]) {
      const state = entry.state;
      if (!state.hasRunningTask || state.runningTaskContext === null) {
        return nothing;
      }
      const ctx = state.runningTaskContext;
      if (ctx.role !== "ai-chat" || ctx.interactive !== true) return nothing;
      const stateDef = this.workflowDef.states.find(
        (s) => s.id === state.currentState
      );
      return html`<div class="map-chat">
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
            this.onSendMessage?.(entry.id, event.detail.content);
          }}
        ></chat-session>
      </div>`;
    }
  }

  return { components: { "expedition-map": ExpeditionMap } };
}

// The agent is composing its next reply while the transcript ends on anything
// but an assistant message (a user message it hasn't answered, or a tool
// result mid-loop).
function agentIsThinking(messages: readonly ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && last.role !== "assistant";
}

// The index of a state along the fog → frontier → charted progression (fog
// covers no_session and naming; anything after charted counts as charted).
function stateIndex(currentState: string): number {
  switch (currentState) {
    case "charted":
      return 2;
    case "frontier":
      return 1;
    case "naming":
    case "no_session":
    default:
      return 0;
  }
}
