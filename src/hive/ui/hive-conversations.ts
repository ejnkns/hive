import type { ConversationData } from "./types";
import { fv, esc, normalizeContent } from "./utils";

export class HiveConversations extends HTMLElement {
  private shadow: ShadowRoot;
  private _data: ConversationData[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: ConversationData[]) {
    this._data = value;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    if (this._data.length === 0) {
      this.shadow.innerHTML = `<style>.no-data { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.8125rem; }</style><div class="no-data">Awaiting conversations...</div>`;
      return;
    }

    let html = "";
    this._data.forEach((c) => {
      let promptHtml = "";
      (c.prompt || []).forEach((msg) => {
        promptHtml += `<div class="conv-block"><span class="label">${msg.role}</span><pre>${esc(normalizeContent(msg.content))}</pre></div>`;
      });

      html += `<div class="conv-card">
        <div class="conv-header">
          <span><span class="provider">${c.provider}</span> <span class="model">${c.model}</span></span>
          <span class="time">${new Date(c.timestamp).toLocaleString()}</span>
        </div>
        <div class="conv-block">
          <span class="label">Prompt <span class="conv-toggle">hide</span></span>
          <div class="conv-prompt">${promptHtml}</div>
        </div>
        <div class="conv-block">
          <span class="label">Response</span>
          <pre>${esc(c.responseText || "(empty)")}</pre>
        </div>
        <div class="conv-footer">
          <span>TTFT: ${fv(c.ttft, "ms")}</span>
          <span>Latency: ${fv(c.totalLatency, "ms")}</span>
          <span>Tokens: ${c.outputTokens != null ? c.outputTokens : "—"}</span>
          <span>Finish: ${c.finishReason || "—"}</span>
          <span class="badge ${c.success ? "ok" : "err"}">${c.statusCode}</span>
        </div>
      </div>`;
    });

    this.shadow.innerHTML = `
      <style>
        :host { display: block; padding: 0.5rem 1rem; }
        .conv-card {
          background: var(--card);
          border: 1px solid var(--border);
          padding: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .conv-card:last-child { margin-bottom: 0; }
        .conv-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
          font-size: 0.6875rem;
        }
        .provider { font-weight: 700; text-transform: capitalize; }
        .model { font-family: monospace; color: var(--accent); }
        .time { color: var(--muted); font-size: 0.625rem; }
        .conv-block { margin-bottom: 0.5rem; }
        .conv-block:last-child { margin-bottom: 0; }
        .conv-block .label {
          font-size: 0.5625rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.25rem;
          display: block;
        }
        .conv-block pre {
          font-size: 0.6875rem;
          color: var(--text);
          background: var(--surface);
          padding: 0.5rem;
          max-height: 200px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-word;
          font-family: monospace;
        }
        .conv-toggle {
          cursor: pointer;
          color: var(--muted);
          font-size: 0.625rem;
          text-decoration: underline;
          text-decoration-style: dotted;
        }
        .conv-toggle:hover { color: var(--accent); }
        .conv-footer {
          display: flex;
          gap: 1rem;
          font-size: 0.625rem;
          color: var(--muted);
          margin-top: 0.375rem;
          padding-top: 0.375rem;
          border-top: 1px solid rgba(var(--border-rgb), 0.3);
        }
        .badge {
          display: inline-block;
          font-size: 0.625rem;
          font-weight: 700;
          padding: 0.0625rem 0.375rem;
          text-transform: uppercase;
        }
        .badge.ok { background: rgba(var(--success-rgb), 0.1); color: var(--success); }
        .badge.err { background: rgba(var(--error-rgb), 0.1); color: var(--error); }
      </style>
      ${html}
    `;

    this.shadow.querySelectorAll(".conv-toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const block = toggle.closest(".conv-block");
        const prompt = block?.querySelector(
          ".conv-prompt"
        ) as HTMLElement | null;
        if (!prompt) return;
        const hidden = prompt.style.display === "none";
        prompt.style.display = hidden ? "" : "none";
        toggle.textContent = hidden ? "hide" : "show";
      });
    });
  }
}

customElements.define("hive-conversations", HiveConversations);
