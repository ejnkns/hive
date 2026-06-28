import type { MetricData } from "./types";
import { formatNumber } from "./utils";

export class HiveDetailOverlay extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render(null, []);
  }

  show(metric: MetricData, allMetrics: MetricData[]): void {
    this.render(metric, allMetrics);
    const overlay = this.shadow.querySelector(
      "#overlay"
    ) as unknown as HTMLElement | null;
    overlay?.showPopover();
  }

  private render(metric: MetricData | null, allMetrics: MetricData[]): void {
    let gridHtml = "";
    if (metric) {
      const fields: [string, string][] = [
        ["Provider", metric.provider],
        ["Model", metric.model],
        ["Time", new Date(metric.timestamp).toLocaleString()],
        [
          "Status",
          String(metric.statusCode) +
            (metric.errorType ? " " + metric.errorType : ""),
        ],
        ["TTFT", formatNumber(metric.ttft, "ms")],
        ["Total Latency", formatNumber(metric.totalLatency, "ms")],
        [
          "Input Tokens",
          metric.inputTokens != null ? String(metric.inputTokens) : "—",
        ],
        [
          "Output Tokens",
          metric.outputTokens != null ? String(metric.outputTokens) : "—",
        ],
        [
          "Thinking Time",
          metric.thinkingTime != null
            ? formatNumber(metric.thinkingTime, "ms")
            : "—",
        ],
        ["Finish Reason", metric.finishReason || "—"],
        ["Refused", metric.refused ? "Yes" : "No"],
        ["Source", metric.source || "—"],
        ["Success", metric.success ? "Yes" : "No"],
        [
          "Error Body",
          metric.errorBody
            ? JSON.stringify(JSON.parse(metric.errorBody), null, 2)
            : "—",
        ],
      ];
      fields.forEach(([label, value]) => {
        gridHtml += `<span class="label">${label}</span><span class="value">${value}</span>`;
      });
    }

    let chainHtml = "";
    if (metric) {
      const chain = metric.requestId
        ? allMetrics
            .filter((m) => m.requestId === metric.requestId)
            .sort((a, b) => a.timestamp - b.timestamp)
        : [];
      if (chain.length > 0) {
        chain.forEach((m, idx) => {
          const ok = m.success && m.statusCode < 400;
          const label = `Attempt #${String(idx + 1)}`;
          const latencyStr = m.totalLatency
            ? `${String(m.totalLatency)}ms`
            : m.ttft
              ? `${String(m.ttft)}ms (ttft)`
              : "—";
          chainHtml += `<div class="detail-chain-item">
            <div><span class="attempt-num">${label}:</span><span class="prov">${m.provider} (${m.model})</span></div>
            <span style="color:${ok ? "var(--success)" : "var(--error)"}">
              ${m.statusCode ? String(m.statusCode) : "ERR"}${m.errorType ? " " + m.errorType : ""} 
              (${ok ? "ok" : "fail"}) in ${latencyStr}
            </span>
          </div>`;
        });
      } else {
        chainHtml = '<div class="single">No attempt data</div>';
      }
    }

    this.shadow.innerHTML = `
      <style>
        .overlay {
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--text);
          font-family: monospace;
          font-size: 0.75rem;
          padding: 1rem;
          max-width: 600px;
          width: 90vw;
          max-height: 80vh;
          overflow-y: auto;
          position: fixed;
          top: 50%;
          left: 50%;
          translate: -50% -50%;
        }
        .overlay::backdrop { background: rgba(0, 0, 0, 0.6); }
        h3 { font-size: 0.875rem; margin-bottom: 0.75rem; color: var(--accent); }
        .detail-grid {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.25rem 0.75rem;
          font-size: 0.6875rem;
          margin-bottom: 1rem;
        }
        .detail-grid .label { color: var(--muted); }
        .detail-grid .value { font-weight: 600; white-space: pre;  }
        .detail-close {
          position: absolute;
          top: 0.5rem;
          right: 0.75rem;
          background: none;
          border: 1px solid var(--border);
          color: var(--muted);
          cursor: pointer;
          font-size: 0.75rem;
          padding: 0.125rem 0.5rem;
          font-family: inherit;
        }
        .detail-close:hover { color: var(--accent); border-color: var(--accent); }
        .detail-chain {
          border-top: 1px solid var(--border);
          padding-top: 0.75rem;
          margin-top: 0.5rem;
        }
        .detail-chain h4 {
          font-size: 0.6875rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.375rem;
        }
        .detail-chain-item {
          display: flex;
          justify-content: space-between;
          padding: 0.25rem 0;
          font-size: 0.6875rem;
        }
        .detail-chain-item + .detail-chain-item { border-top: 1px solid rgba(var(--border-rgb), 0.3); }
        .prov { text-transform: capitalize; font-weight: 600; }
        .attempt-num { color: var(--muted); font-weight: bold; margin-right: 0.5rem; }
        .single { font-size: 0.6875rem; color: var(--muted); }
      </style>
      <div id="overlay" popover="auto" class="overlay">
        <button class="detail-close" popovertarget="overlay" popovertargetaction="hide">x</button>
        <h3>Request Detail</h3>
        <div class="detail-grid">${gridHtml}</div>
        <div class="detail-chain">
          <h4>Request Chain</h4>
          ${chainHtml}
        </div>
      </div>
    `;
  }
}

customElements.define("hive-detail-overlay", HiveDetailOverlay);
