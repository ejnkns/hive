/** The wayfinder expedition map (served component "expedition-map"): the
 * charting workflow's custom workflow-instances view. Renders each charting
 * instance as a destination on the map — destination + notes, the
 * fog → frontier → charted progression, and the frontier session's live chat
 * — with a map header showing how far the expedition has charted. Composes
 * nothing: the map IS the charting section's content (the list view it
 * replaces was the generic fallback). */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  WorkflowViewProps,
} from "workflow-engine/workflow-types";

const FRONTIER_SESSION = "frontierSession";

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
      .chat-msg {
        font-size: 0.625rem;
        color: var(--text);
      }
      .chat-msg .role {
        color: var(--muted);
        font-family: var(--font-mono, monospace);
      }
      .chat-input-row {
        display: flex;
        gap: 0.375rem;
      }
      input {
        flex: 1;
        font-family: inherit;
        font-size: 0.625rem;
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg);
        color: var(--text);
        outline: none;
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
      .map-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }
    `;

    declare workflowDef: WorkflowViewProps["workflowDef"];
    declare entries: WorkflowViewProps["entries"];
    declare customKinds: WorkflowViewProps["customKinds"];
    declare onAction: WorkflowViewProps["onAction"] | undefined;
    declare onSendMessage: WorkflowViewProps["onSendMessage"] | undefined;
    declare onSelect: WorkflowViewProps["onSelect"] | undefined;
    input = "";

    render() {
      const terminal = this.workflowDef.terminalStates;
      const charted = this.entries.filter((entry) =>
        terminal.includes(entry.state.currentState)
      ).length;
      return html`<div class="map">
        <div class="map-header">
          <span class="map-emblem">▲</span>
          <span class="map-title">Expedition map</span>
          <span class="map-progress"
            >${charted} of ${this.entries.length} charted</span
          >
        </div>
        <div class="map-destinations">
          ${this.entries.map((entry) => this.renderDestination(entry))}
        </div>
      </div>`;
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
      return html`<div class="map-chat">
        ${ctx.messages.map(
          (m) =>
            html`<div class="chat-msg">
              <span class="role">${m.role}:</span> ${m.content}
            </div>`
        )}
        <div class="chat-input-row">
          <input
            placeholder="Message the frontier session..."
            @input=${(e: Event) => {
              this.input = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") this.send(entry.id);
            }}
          />
          <button
            type="button"
            @click=${() => {
              this.send(entry.id);
            }}
          >
            Send
          </button>
        </div>
      </div>`;
    }

    send(instanceId: string) {
      const text = this.input.trim();
      if (text !== "" && this.onSendMessage !== undefined) {
        this.onSendMessage(instanceId, text);
        this.input = "";
      }
    }
  }

  return { components: { "expedition-map": ExpeditionMap } };
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
