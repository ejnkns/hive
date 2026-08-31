/** The wayfinder charting card (served component "charting-card"). Renders a
 * charting instance compactly: destination, notes, the current frontier state,
 * and the frontier session's live chat. Self-contained; the lit runtime
 * arrives via the factory. */

import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  InstanceComponentProps,
} from "workflow-engine/workflow-types";
import { agentIsThinking } from "./wayfinder-status.ts";

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
      .charting-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }
      .charting-actions button {
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
      const stateDef = this.workflowDef.states.find(
        (s) => s.id === state.currentState
      );
      return html`<div class="charting-chat">
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

  return { components: { "charting-card": ChartingCard } };
}
