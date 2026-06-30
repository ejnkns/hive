import type { MetricData } from "./types";
import { formatNumber, formatTime } from "./utils";
import "./hive-info";

export class HiveActivityLog extends HTMLElement {
  private shadow: ShadowRoot;
  private _metrics: MetricData[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: MetricData[]) {
    this._metrics = value;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    if (this._metrics.length === 0) {
      this.shadow.innerHTML = this.tableHtml('<tr><td colspan="6" class="no-data">Awaiting requests...</td></tr>');
      return;
    }

    const sorted = [...this._metrics].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);

    let rows = "";
    sorted.forEach((r) => {
      const ok = r.success;
      const tokenStr =
        r.inputTokens != null || r.outputTokens != null
          ? `${r.inputTokens != null ? String(r.inputTokens) : "—"} / ${r.outputTokens != null ? String(r.outputTokens) : "—"}`
          : "—";
      const finishBadge =
        r.finishReason && r.finishReason !== "stop"
          ? `<span class="badge finish-${r.finishReason}">${r.finishReason}</span>`
          : "";
      const toolBadge = r.toolCallFailed ? `<span class="badge tool-err">TOOL-ERR</span>` : "";
      rows += `<tr data-request-id="${r.requestId}" style="cursor:pointer;">
        <td class="mono">${formatTime(r.timestamp)}</td>
        <td class="model">${r.model}</td>
        <td><span class="badge ${ok ? "ok" : "err"}">${r.statusCode ? String(r.statusCode) : "ERR"}${r.errorType ? ` ${r.errorType}` : ""}</span>${finishBadge}${toolBadge}</td>
        <td>${ok ? formatNumber(r.ttft, "ms") : "—"}</td>
        <td>${tokenStr}</td>
      </tr>`;
    });

    this.shadow.innerHTML = this.tableHtml(rows);

    this.shadow.querySelectorAll("tr[data-request-id]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const requestId = tr.getAttribute("data-request-id");
        if (!requestId) return;
        const metric = this._metrics.find((m) => m.requestId === requestId);
        if (!metric) return;
        this.dispatchEvent(
          new CustomEvent("row-click", {
            bubbles: true,
            composed: true,
            detail: { metric, allMetrics: this._metrics },
          })
        );
      });
    });
  }

  private tableHtml(rowsHtml: string): string {
    return `
      <style>
        :host {
          display: block;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.75rem;
        }
        th {
          background: var(--surface);
          padding: 0.25rem 0.5rem;
          font-size: 0.5625rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: left;
          border-bottom: 2px solid var(--border);
          position: sticky;
          top: 0;
          font-weight: 700;
          z-index: 1;
        }
        td {
          padding: 0.25rem 0.5rem;
          border-bottom: 1px solid rgba(var(--border-rgb), 0.3);
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(var(--accent-rgb), 0.03); }
        .mono { font-family: monospace; font-size: 0.625rem; }
        .prov { text-transform: capitalize; font-weight: 600; }
        .model { font-family: monospace; font-size: 0.625rem; color: var(--accent); }
        tbody th {
          color: var(--muted);
        }
        .badge {
          display: inline-block;
          font-size: 0.5625rem;
          font-weight: 700;
          padding: 0.0625rem 0.25rem;
          text-transform: uppercase;
          margin-right: 0.125rem;
        }
        .badge.ok {
          background: rgba(var(--success-rgb), 0.12);
          color: var(--success);
          border: 1px solid var(--success);
        }
        .badge.err {
          background: rgba(var(--error-rgb), 0.12);
          color: var(--error);
          border: 1px solid var(--error);
        }
        .badge.finish-length {
          background: rgba(var(--warn-rgb, 226, 169, 59), 0.12);
          color: var(--warn, #e2a93b);
          border: 1px solid var(--warn, #e2a93b);
        }
        .badge.finish-content-filter {
          background: rgba(var(--error-rgb), 0.12);
          color: var(--error);
          border: 1px solid var(--error);
        }
        .badge.tool-err {
          background: rgba(var(--error-rgb), 0.12);
          color: var(--error);
          border: 1px solid var(--error);
        }
        .no-data { padding: 1rem; text-align: center; color: var(--muted); font-size: 0.75rem; }
      </style>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Model</th>
            <th>Status <hive-info>HTTP status code or error type</hive-info></th>
            <th>Latency <hive-info>Time-to-first-token (TTFT) per request</hive-info></th>
            <th>Tokens (I/O) <hive-info>Input / output tokens per request</hive-info></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }
}

customElements.define("hive-activity-log", HiveActivityLog);
