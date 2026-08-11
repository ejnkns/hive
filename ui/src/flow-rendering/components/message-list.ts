import { css, html, LitElement, nothing } from "lit";
import type { ChatMessage } from "workflow-engine/workflow-types";
import "./markdown-view.ts";

// The shared transcript renderer for ai-chat sessions and agent progress:
// markdown message bodies, compact tool-call chips, role-labelled rows. Both
// consumers mount this element; the styling stays in one place.
export class MessageList extends LitElement {
  static properties = {
    messages: { attribute: false },
  };

  static styles = css`
    .messages {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .msg {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
      font-size: 0.6875rem;
      line-height: 1.45;
    }

    .label {
      color: var(--muted);
      background: var(--border);
      border-radius: 3px;
      font-weight: 700;
      flex-shrink: 0;
      min-width: 3.25rem;
      padding: 0 0.375rem;
      height: 1.25rem;
      display: inline-flex;
      align-items: center;
      text-transform: uppercase;
      font-size: 0.5625rem;
      letter-spacing: 0.04em;
    }

    .msg-user .label {
      color: var(--accent);
    }

    .msg-tool .label {
      color: var(--bg);
      background: var(--muted);
    }

    .body {
      flex: 1;
      min-width: 0;
    }

    .msg-tool .body {
      font-family: var(--font-mono, monospace);
      font-size: 0.625rem;
      color: var(--muted);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .tool-calls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-bottom: 0.25rem;
    }

    .tool-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      height: 18px;
      padding: 0 0.375rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg);
      color: var(--accent);
      font-family: var(--font-mono, monospace);
      font-size: 0.5625rem;
      font-weight: 600;
      white-space: nowrap;
    }
  `;

  messages: ChatMessage[] = [];

  render() {
    return html`<div class="messages">
      ${this.messages.map((msg) => this.renderMessage(msg))}
    </div>`;
  }

  private renderMessage(msg: ChatMessage) {
    const label = ROLE_LABELS[msg.role] ?? msg.role;
    return html`<div class="msg msg-${msg.role}">
      <span class="label">${label}</span>
      <div class="body">
        ${
          msg.tool_calls !== undefined && msg.tool_calls.length > 0
            ? html`<div class="tool-calls">
                ${msg.tool_calls.map(
                  (call) => html`<span
                    class="tool-chip"
                    title=${call.function.arguments}
                    >${call.function.name}</span
                  >`
                )}
              </div>`
            : nothing
        }
        ${
          msg.content !== ""
            ? html`<markdown-view .content=${msg.content}></markdown-view>`
            : nothing
        }
      </div>
    </div>`;
  }
}

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  assistant: "Agent",
  system: "System",
  tool: "Tool",
};

customElements.define("message-list", MessageList);
