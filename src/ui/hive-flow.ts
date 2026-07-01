import type { FlowEvent } from "./types";
import { formatNumber, formatTime, sc } from "./utils";

export class HiveFlow extends HTMLElement {
  private shadow: ShadowRoot;
  private _events: FlowEvent[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set events(value: FlowEvent[]) {
    this._events = value;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    if (this._events.length === 0) {
      this.shadow.innerHTML = `<style>:host { display: block; }</style><div class="no-data">Awaiting requests...</div>`;
      return;
    }

    const requests = new Map<
      string,
      {
        prompt?: string;
        candidates?: {
          key: string;
          provider: string;
          model: string;
          score: number;
          status: string;
          affinity: boolean;
        }[];
        selected?: string;
        poolSize?: number;
        strategy?: string;
        response?: {
          provider: string;
          model: string;
          statusCode: number;
          success: boolean;
          ttft: number;
          totalLatency: number;
          outputTokens: number | null;
          finishReason: string | null;
          toolCallFailed: boolean;
          errorType: string | null;
        };
        failovers: { provider: string; model: string; errorType: string }[];
        timestamp: number;
      }
    >();

    for (const event of this._events) {
      const req = requests.get(event.requestId) || { failovers: [], timestamp: 0 };
      req.timestamp = "timestamp" in event ? event.timestamp : req.timestamp;

      switch (event.type) {
        case "request_received":
          req.prompt = event.promptPreview;
          req.timestamp = event.timestamp;
          break;
        case "selection_round":
          req.candidates = event.candidates;
          req.selected = event.selected ?? undefined;
          req.poolSize = event.poolSize;
          req.strategy = event.strategy;
          break;
        case "response_complete":
          req.response = {
            provider: event.provider,
            model: event.model,
            statusCode: event.statusCode,
            success: event.success,
            ttft: event.ttft,
            totalLatency: event.totalLatency,
            outputTokens: event.outputTokens,
            finishReason: event.finishReason,
            toolCallFailed: event.toolCallFailed,
            errorType: event.errorType,
          };
          break;
        case "failover_attempt":
          req.failovers.push({ provider: event.failedProvider, model: event.failedModel, errorType: event.errorType });
          break;
      }

      requests.set(event.requestId, req);
    }

    const sorted = Array.from(requests.entries()).sort((a, b) => b[1].timestamp - a[1].timestamp);

    let html = "";
    sorted.forEach(([requestId, req]) => {
      const hasResponse = Boolean(req.response);
      const statusColor = hasResponse ? (req.response!.success ? "var(--success)" : "var(--error)") : "var(--muted)";
      const statusText = hasResponse
        ? req.response!.success
          ? `${String(req.response!.statusCode)}`
          : `${String(req.response!.statusCode)} ERR`
        : "pending";

      let responseHtml = "";
      if (req.response) {
        const r = req.response;
        responseHtml = `
          <div class="flow-response">
            <span style="color:${statusColor}">${statusText}</span>
            <span>${formatNumber(r.ttft, "ms")} TTFT</span>
            <span>${r.outputTokens != null ? String(r.outputTokens) : "—"} tok</span>
            <span>${r.finishReason ?? "—"}</span>
            ${r.toolCallFailed ? '<span class="badge tool-err">TOOL-ERR</span>' : ""}
          </div>`;
      }

      let scoringHtml = "";
      if (req.candidates && req.candidates.length > 0) {
        const rows = req.candidates
          .map((c) => {
            const cStatus =
              c.status === "eligible"
                ? `<span style="color:${sc(c.score)}">${c.score.toFixed(1)}%</span>`
                : `<span class="badge ineligible">${c.status}</span>`;
            const affinityMark = c.affinity ? " 📌" : "";
            return `<div class="flow-row${c.key === req.selected ? " selected" : ""}">
              <span class="flow-prov">${c.provider}</span>
              <span class="flow-model">${c.model}</span>
              ${cStatus}${affinityMark}
            </div>`;
          })
          .join("");
        scoringHtml = `
          <div class="flow-scoring">
            <div class="flow-scoring-label">Strategy: ${req.strategy ?? "—"} | Pool: ${String(req.poolSize ?? 0)}</div>
            ${rows}
          </div>`;
      }

      let failoverHtml = "";
      if (req.failovers.length > 0) {
        failoverHtml = `<div class="flow-failovers">${req.failovers.map((f) => `<span class="badge failover">${f.provider}:${f.model} → ${f.errorType}</span>`).join(" ")}</div>`;
      }

      html += `
        <div class="flow-card">
          <div class="flow-header">
            <span class="flow-time">${formatTime(req.timestamp)}</span>
            <span class="flow-id">#${requestId.slice(0, 8)}</span>
            <span class="flow-prompt">${req.prompt || "—"}</span>
          </div>
          ${scoringHtml}
          ${failoverHtml}
          ${responseHtml}
        </div>`;
    });

    this.shadow.innerHTML = `
      <style>
        :host { display: block; }
        .no-data { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.8125rem; }
        .flow-card {
          background: var(--card);
          border: 1px solid var(--border);
          padding: 0.5rem 0.75rem;
          margin-bottom: 0.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .flow-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.6875rem;
        }
        .flow-time { color: var(--muted); font-family: monospace; font-size: 0.625rem; }
        .flow-id { color: var(--accent); font-family: monospace; font-size: 0.5625rem; }
        .flow-prompt {
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 400px;
        }
        .flow-scoring {
          font-size: 0.625rem;
          padding: 0.25rem 0.5rem;
          background: rgba(var(--border-rgb), 0.08);
          border: 1px solid rgba(var(--border-rgb), 0.2);
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .flow-scoring-label {
          color: var(--muted);
          font-size: 0.5625rem;
          text-transform: uppercase;
        }
        .flow-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.125rem 0;
        }
        .flow-row.selected {
          color: var(--success);
        }
        .flow-prov { text-transform: capitalize; min-width: 70px; }
        .flow-model { font-family: monospace; color: var(--accent); font-size: 0.5625rem; }
        .flow-response {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.6875rem;
          color: var(--muted);
        }
        .flow-failovers {
          font-size: 0.625rem;
        }
        .badge {
          display: inline-block;
          font-size: 0.5rem;
          font-weight: 700;
          padding: 0.0625rem 0.25rem;
          text-transform: uppercase;
        }
        .badge.ineligible {
          color: var(--error);
          background: rgba(var(--error-rgb), 0.1);
          border: 1px solid rgba(var(--error-rgb), 0.2);
        }
        .badge.failover {
          color: var(--warn, #e2a93b);
          background: rgba(var(--warn-rgb, 226, 169, 59), 0.1);
          border: 1px solid rgba(var(--warn-rgb, 226, 169, 59), 0.2);
        }
        .badge.tool-err {
          color: var(--error);
          background: rgba(var(--error-rgb), 0.1);
        }
      </style>
      ${html}
    `;
  }
}

customElements.define("hive-flow", HiveFlow);
