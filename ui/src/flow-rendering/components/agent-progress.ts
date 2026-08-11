import { css, html, LitElement } from "lit";
import type { ChatMessage } from "workflow-engine/workflow-types";
import "./message-list.ts";

// The live transcript of a one-shot ai-task, with a running indicator. The
// message bodies and tool chips render via message-list.
export class AgentProgress extends LitElement {
  static properties = {
    messages: { attribute: false },
  };

  static styles = css`
    .task-label {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      margin-bottom: 0.375rem;
      font-size: 0.625rem;
      color: var(--muted);
    }

    .spinner {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 1.5px solid var(--border);
      border-top-color: var(--accent);
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  messages: ChatMessage[] = [];

  render() {
    return html`
      <span class="task-label"><span class="spinner"></span>Agent running...</span>
      ${
        this.messages.length > 0
          ? html`<message-list .messages=${this.messages}></message-list>`
          : ""
      }
    `;
  }
}

customElements.define("agent-progress", AgentProgress);
