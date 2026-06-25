import type { MetricData } from "./types";
import { ft, fv } from "./utils";
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
      this.shadow.innerHTML = this.tableHtml(
        '<tr><td colspan="6" class="no-data">Awaiting requests...</td></tr>'
      );
      return;
    }

    const sorted = [...this._metrics]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);

    let rows = "";
    sorted.forEach((r) => {
      const ok = r.success;
      const tokens = r.outputTokens != null ? r.outputTokens : null;
      rows += `<tr data-request-id="${r.requestId}" style="cursor:pointer;">
        <td class="mono">${ft(r.timestamp)}</td>
        <td class="prov">${r.provider}</td>
        <td class="model">${r.model}</td>
        <td><span class="badge ${ok ? "ok" : "err"}">${r.statusCode || "ERR"}${r.errorType ? " " + r.errorType : ""}</span></td>
        <td>${ok ? fv(r.ttft, "ms") : "—"}</td>
        <td>${tokens != null ? tokens : "—"}</td>
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
          font-size: 0.8125rem;
        }
        th {
          background: var(--border);
          padding: 0.375rem 0.75rem;
          font-size: 0.625rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: left;
          border-bottom: 2px solid var(--border);
          position: sticky;
          top: 0;
          font-weight: 700;
        }
        td {
          padding: 0.375rem 0.75rem;
          border-bottom: 1px solid rgba(var(--border-rgb), 0.3);
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(var(--accent-rgb), 0.03); }
        .mono { font-family: monospace; font-size: 0.6875rem; }
        .prov { text-transform: capitalize; font-weight: 600; }
        .model { font-family: monospace; font-size: 0.6875rem; color: var(--accent); }
        .badge {
          display: inline-block;
          font-size: 0.625rem;
          font-weight: 700;
          padding: 0.0625rem 0.375rem;
          text-transform: uppercase;
        }
        .badge.ok { background: rgba(var(--success-rgb), 0.1); color: var(--success); }
        .badge.err { background: rgba(var(--error-rgb), 0.1); color: var(--error); }
        .no-data { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.8125rem; }
      </style>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Status <hive-info>HTTP status code or error type</hive-info></th>
            <th>Latency <hive-info>Time-to-first-token (TTFT) per request</hive-info></th>
            <th>Tokens <hive-info>Output tokens generated per request</hive-info></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }
}

customElements.define("hive-activity-log", HiveActivityLog);
