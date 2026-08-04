import { css, html, LitElement } from "lit";
import type { ChatMessage } from "workflow-engine/workflow-types";

export class ChatSession extends LitElement {
  static properties = {
    messages: { attribute: false },
    sessionId: { type: String },
  };

  static styles = css`
    .messages {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      margin-bottom: 0.5rem;
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

    .input-row {
      display: flex;
      gap: 0.375rem;
    }

    input {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: monospace;
      font-size: 0.625rem;
      padding: 0.25rem 0.5rem;
      outline: none;
    }

    input:focus {
      border-color: var(--accent);
    }

    button {
      font-family: inherit;
      font-size: 0.625rem;
      height: 24px;
      padding: 0 0.5rem;
      border-radius: 4px;
      border: 1px solid transparent;
      background: var(--success);
      color: var(--bg);
      cursor: pointer;
    }

    button:hover {
      filter: brightness(1.1);
    }

    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;

  messages: ChatMessage[] = [];
  sessionId = "";

  private input = "";
  private sending = false;

  render() {
    return html`
      <div class="messages">
        ${this.messages.map(
          (msg) => html`
            <div class="msg">
              <span class="label">${msg.role}</span>
              <span class="text">${msg.content}</span>
            </div>
          `
        )}
      </div>
      <div class="input-row">
        <input
          type="text"
          placeholder="Type a message..."
          .value=${this.input}
          @input=${(event: Event) => {
            // The input element is the event target; the cast reads its value.
            this.input = (event.target as HTMLInputElement).value;
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void this.handleSend();
            }
          }}
          ?disabled=${this.sending}
        >
        <button
          ?disabled=${!this.input.trim() || this.sending}
          @click=${() => void this.handleSend()}
        >
          Send
        </button>
      </div>
    `;
  }

  private async handleSend(): Promise<void> {
    const text = this.input.trim();
    if (!text || this.sending) return;
    this.sending = true;
    this.input = "";
    this.dispatchEvent(
      new CustomEvent("hive-send-message", {
        detail: { content: text },
        bubbles: true,
        composed: true,
      })
    );
    this.sending = false;
  }
}

customElements.define("chat-session", ChatSession);
