import type { StatsData } from "./types";
import { sc, fv } from "./utils";
import "./hive-info";

export class HiveStats extends HTMLElement {
  private shadow: ShadowRoot;
  private _data: StatsData | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: StatsData | null) {
    this._data = value;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    const d = this._data;
    const traffic = d?.traffic ?? "—";
    const rate = d?.successRate ?? 100;
    const providers = d?.providers ?? "—";
    const latency = d ? fv(d.avgLatency, "ms") : "—";

    this.shadow.innerHTML = `
      <style>
        :host {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.625rem;
        }
        .stat {
          background: var(--card);
          border: 1px solid var(--border);
          padding: 0.625rem 0.875rem;
        }
        .stat-label {
          font-size: 0.625rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .stat-value {
          font-size: 1.25rem;
          font-weight: 700;
          margin-top: 0.125rem;
        }
        @media (max-width: 640px) {
          :host { grid-template-columns: repeat(2, 1fr); }
        }
      </style>
      <div class="stat">
        <span class="stat-label">Traffic <hive-info>Total API requests in tracking window</hive-info></span>
        <span class="stat-value">${traffic}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Success <hive-info>% of requests completed without error</hive-info></span>
        <span class="stat-value" style="color:${sc(rate)}">${rate}%</span>
      </div>
      <div class="stat">
        <span class="stat-label">Providers <hive-info>Providers with an API key configured</hive-info></span>
        <span class="stat-value">${providers}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Latency <hive-info>Average time-to-first-token (TTFT)</hive-info></span>
        <span class="stat-value">${latency}</span>
      </div>
    `;
  }
}

customElements.define("hive-stats", HiveStats);
