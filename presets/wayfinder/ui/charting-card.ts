/** The wayfinder charting card (served component "charting-card"). Renders a
 * charting instance compactly: destination, notes, the current frontier state,
 * and the frontier session's live chat. Self-contained; the lit runtime
 * arrives via the factory. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  InstanceComponentProps,
} from "workflow-engine/workflow-types";

const FRONTIER_SESSION = "frontierSession";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class ChartingCard extends Base {
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
      .charting {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        padding: 0.75rem 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .charting-state {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--flow-accent, var(--accent));
      }
      .charting-title {
        font-weight: 700;
        font-size: 0.8125rem;
        color: var(--text);
      }
      .charting-notes {
        font-size: 0.625rem;
        color: var(--muted);
        white-space: pre-wrap;
        margin: 0;
      }
      .charting-chat {
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
      .charting-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }
    `;

    declare workflowDef: InstanceComponentProps["workflowDef"];
    declare instanceEntry: InstanceComponentProps["instanceEntry"];
    declare customKinds: InstanceComponentProps["customKinds"];
    declare onAction: InstanceComponentProps["onAction"] | undefined;
    declare onSendMessage: InstanceComponentProps["onSendMessage"] | undefined;
    input = "";

    render() {
      const state = this.instanceEntry.state;
      const instanceState = state.workflowInstanceState;
      const stateDef = this.workflowDef.states.find(
        (s) => s.id === state.currentState
      );
      const destination =
        (instanceState.destination as string | undefined) ??
        this.instanceEntry.id;
      const notes = instanceState.notes as string | undefined;
      const actions = this.instanceEntry.availableActions ?? [];

      return html`<div class="charting">
        <div class="charting-state">${stateDef?.label ?? state.currentState}</div>
        <div class="charting-title">${destination}</div>
        ${
          notes !== undefined && notes !== ""
            ? html`<p class="charting-notes">${notes}</p>`
            : nothing
        }
        ${this.renderChat()}
        ${
          actions.length > 0
            ? html`<div class="charting-actions">
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

    // The frontier session's live chat (startOnUserInput — read-only transcript
    // + reply input while it runs).
    private renderChat() {
      const state = this.instanceEntry.state;
      if (!state.hasRunningTask || state.runningTaskContext === null) {
        return nothing;
      }
      const ctx = state.runningTaskContext;
      if (ctx.role !== "ai-chat" || ctx.interactive !== true) return nothing;
      return html`<div class="charting-chat">
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
              if (e.key === "Enter") this.send();
            }}
          />
          <button
            type="button"
            @click=${() => {
              this.send();
            }}
          >
            Send
          </button>
        </div>
      </div>`;
    }

    send() {
      const text = this.input.trim();
      if (text !== "" && this.onSendMessage !== undefined) {
        this.onSendMessage(text);
        this.input = "";
      }
    }
  }

  return { components: { "charting-card": ChartingCard } };
}
