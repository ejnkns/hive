/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { LogEntry } from "../shared/logger";

export class HiveLogs extends HTMLElement {
  private shadow: ShadowRoot;
  private logsContainer!: HTMLElement;
  private autoScroll = true;
  private paused = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.logsContainer = this.shadow.querySelector(".log-lines")!;
    this.setupControls();
  }

  /** Called by hive-app to push a log entry from the shared WebSocket */
  addLog(log: LogEntry) {
    if (this.paused) return;
    this.addLogLine(log);
  }

  private setupControls() {
    const clearBtn = this.shadow.querySelector(".btn-clear")!;
    clearBtn.addEventListener("click", () => {
      this.logsContainer.innerHTML = "";
    });

    const pauseBtn = this.shadow.querySelector(".btn-pause")!;
    pauseBtn.addEventListener("click", () => {
      this.paused = !this.paused;
      pauseBtn.textContent = this.paused ? "Resume" : "Pause";
      pauseBtn.classList.toggle("paused", this.paused);
    });

    const scrollBtn = this.shadow.querySelector(".btn-scroll")!;
    scrollBtn.addEventListener("click", () => {
      this.autoScroll = !this.autoScroll;
      scrollBtn.textContent = this.autoScroll
        ? "Auto-scroll ON"
        : "Auto-scroll OFF";
      scrollBtn.classList.toggle("active", this.autoScroll);
    });
  }

  private addLogLine(log: LogEntry) {
    const line = document.createElement("div");
    line.className = `log-line ${log.level}`;

    const time = new Date(log.timestamp).toLocaleTimeString();

    line.innerHTML = `
      <span class="log-time">[${time}]</span>
      <span class="log-level">[bzz:${log.level}]</span>
      <span class="log-msg">${this.escapeHtml(log.message)}</span>
    `;

    this.logsContainer.appendChild(line);

    // Keep log count under 500 lines to prevent memory bloat
    if (this.logsContainer.children.length > 500) {
      this.logsContainer.removeChild(this.logsContainer.firstChild!);
    }

    if (this.autoScroll) {
      this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          border: 1px solid var(--border);
          background: var(--card)
          color: var(--text);
          font-family: monospace;
          font-size: 0.75rem;
          margin-top: 1rem;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--card);
          padding: 0.375rem 0.75rem;
          border-bottom: 1px solid var(--border);
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
        }
        .controls {
          display: flex;
          gap: 0.5rem;
        }
        .btn {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          cursor: pointer;
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          font-family: inherit;
        }
        .btn:hover {
          color: var(--accent);
          border-color: var(--accent);
        }
        .btn.active, .btn.paused {
          background: rgba(var(--accent-rgb), 0.1);
          color: var(--accent);
          border-color: var(--accent);
        }
        .log-lines {
          padding: 0.5rem;
          max-height: 200px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .log-line {
          white-space: pre-wrap;
          word-break: break-all;
          line-height: 1.3;
        }
        .log-time {
          color: var(--muted);
        }
        .log-level {
          font-weight: bold;
        }
        .info .log-level { color: var(--accent); }
        .warn .log-level { color: var(--warning); }
        .error .log-level { color: var(--error); }
        .debug .log-level { color: var(--muted); }

        .info { color: var(--text); }
        .warn { color: var(--warning); }
        .error { color: var(--error); }
        .debug { color: var(--muted); }
      </style>
      <div class="header">
        <span>Console Stream</span>
        <div class="controls">
          <button class="btn btn-scroll active">Auto-scroll ON</button>
          <button class="btn btn-pause">Pause</button>
          <button class="btn btn-clear">Clear</button>
        </div>
      </div>
      <div class="log-lines"></div>
    `;
  }
}

customElements.define("hive-logs", HiveLogs);
