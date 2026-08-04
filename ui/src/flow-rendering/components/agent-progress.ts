import { css, html, LitElement } from "lit";
import type { ChatMessage } from "workflow-engine/workflow-types";

export class AgentProgress extends LitElement {
  static properties = {
    messages: { attribute: false },
  };

  static styles = css`
    .task-label {
      display: block;
      margin-bottom: 0.375rem;
      font-size: 0.625rem;
      color: var(--muted);
    }

    .messages {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .msg {
      display: flex;
      gap: 0.5rem;
      font-size: 0.6875rem;
      line-height: 1.45;
    }

    .label {
      color: var(--muted);
      background: var(--border);
      border-radius: 3px;
      font-weight: 700;
      flex-shrink: 0;
      min-width: 3.75rem;
      padding: 0 0.375rem;
      height: 1.25rem;
      display: inline-flex;
      align-items: center;
      text-transform: uppercase;
      font-size: 0.5625rem;
      letter-spacing: 0.04em;
    }

    .text {
      color: var(--text);
      word-break: break-word;
      white-space: pre-wrap;
    }
  `;

  messages: ChatMessage[] = [];

  render() {
    return html`
      <span class="task-label">Agent running...</span>
      ${
        this.messages.length > 0
          ? html`<div class="messages">
            ${this.messages.map(
              (msg) => html`
                <div class="msg">
                  <span class="label">${msg.role}</span>
                  <span class="text">${msg.content}</span>
                </div>
              `
            )}
          </div>`
          : ""
      }
    `;
  }
}

customElements.define("agent-progress", AgentProgress);
