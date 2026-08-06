import { css, html, LitElement, type PropertyValues } from "lit";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import type { ChatMessage } from "workflow-engine/workflow-types";
import "./message-list";

// The live ai-chat exchange for a running session: a scrollable transcript
// (markdown bodies + tool chips via message-list) and an input row that
// forwards hive-send-message with the composed content.
export class ChatSession extends LitElement {
  static properties = {
    messages: { attribute: false },
    sessionId: { type: String },
  };

  static styles = css`
    .chat {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .scroll {
      max-height: 240px;
      overflow-y: auto;
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
  private scrollRef: Ref<HTMLElement> = createRef();

  render() {
    return html`
      <div class="chat">
        <div class="scroll" ${ref(this.scrollRef)}>
          <message-list .messages=${this.messages}></message-list>
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
      </div>
    `;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("messages")) this.scrollToBottom();
  }

  private scrollToBottom(): void {
    const el = this.scrollRef.value;
    if (el !== undefined) el.scrollTop = el.scrollHeight;
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
