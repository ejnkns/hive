import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import type {
  ChatMessage,
  ModelCallStatus,
} from "workflow-engine/workflow-types";
import "./message-list";

// The live ai-chat exchange for a running session: a scrollable transcript
// (markdown bodies + tool chips via message-list) and an input row that
// forwards hive-send-message with the composed content.
export class ChatSession extends LitElement {
  static properties = {
    messages: { attribute: false },
    sessionId: { type: String },
    // Read-only sessions (one-shot agents) hide the input row: the user
    // cannot send messages to a session that is not waiting for input.
    interactive: { type: Boolean },
    // The agent is composing its next reply (mid-turn or mid-tool-loop) —
    // show a thinking indicator where the reply will land.
    thinking: { type: Boolean },
    // Live progress of the agent's current model call (routing → dispatched →
    // thinking → streaming), reported by the proxy path.
    modelStatus: { attribute: false },
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

    .thinking {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      color: var(--muted);
      font-size: 0.625rem;
    }

    .thinking-dots {
      display: inline-flex;
      gap: 2px;
    }

    .thinking-dots span {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: currentColor;
      animation: thinking-pulse 1.2s ease-in-out infinite;
    }

    .thinking-dots span:nth-child(2) {
      animation-delay: 0.2s;
    }

    .thinking-dots span:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes thinking-pulse {
      0%,
      100% {
        opacity: 0.3;
      }
      50% {
        opacity: 1;
      }
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
  interactive = false;
  thinking = false;
  modelStatus: ModelCallStatus | undefined = undefined;

  private _input = "";
  private _sending = false;
  private scrollRef: Ref<HTMLElement> = createRef();

  render() {
    const statusLine = this.renderStatus();
    return html`
      <div class="chat">
        <div class="scroll" ${ref(this.scrollRef)}>
          <message-list .messages=${this.messages}></message-list>
        </div>
        ${statusLine}
        ${
          this.interactive
            ? html`<div class="input-row">
                <input
                  type="text"
                  placeholder="Type a message..."
                  .value=${this._input}
                  @input=${(event: Event) => {
                    // The input element is the event target; the cast reads its value.
                    this._input = (event.target as HTMLInputElement).value;
                    this.requestUpdate();
                  }}
                  @keydown=${(event: KeyboardEvent) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void this.handleSend();
                    }
                  }}
                  ?disabled=${this._sending}
                >
                <button
                  ?disabled=${!this._input.trim() || this._sending}
                  @click=${() => void this.handleSend()}
                >
                  Send
                </button>
              </div>`
            : nothing
        }
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

  // The status row above the input: the live model-call progress when the
  // proxy reports it (routing → dispatched → thinking → streaming), else the
  // generic thinking indicator. A completed call leaves the row empty.
  private renderStatus() {
    const status = this.modelStatus;
    if (status !== undefined && status.stage !== "complete") {
      const label =
        status.stage === "routing"
          ? "Routing to a model…"
          : status.stage === "dispatched"
            ? `→ ${status.provider}:${status.model}`
            : status.stage === "thinking"
              ? "Thinking…"
              : status.stage === "streaming"
                ? "Streaming…"
                : `Model call failed: ${status.message}`;
      return html`<div class="thinking">
        <span class="thinking-dots"
          ><span></span><span></span><span></span></span
        >
        ${label}
      </div>`;
    }
    if (this.thinking) {
      return html`<div class="thinking">
        <span class="thinking-dots"
          ><span></span><span></span><span></span></span
        >
        Agent is thinking…
      </div>`;
    }
    return nothing;
  }
  private async handleSend(): Promise<void> {
    const text = this._input.trim();
    if (!text || this._sending) return;
    this._sending = true;
    this._input = "";
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent("hive-send-message", {
        detail: { content: text },
        bubbles: true,
        composed: true,
      })
    );
    this._sending = false;
    this.requestUpdate();
  }
}

customElements.define("chat-session", ChatSession);
