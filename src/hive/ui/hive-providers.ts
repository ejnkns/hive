import type { ProviderData } from "./types";
import { sc, fv, bar } from "./utils";
import "./hive-info";

export class HiveProviders extends HTMLElement {
  private shadow: ShadowRoot;
  private _data: ProviderData[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: ProviderData[]) {
    this._data = value;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    const grouped = new Map<string, ProviderData[]>();
    this._data.forEach((x) => {
      const arr = grouped.get(x.name);
      if (arr) {
        arr.push(x);
      } else {
        grouped.set(x.name, [x]);
      }
    });

    if (grouped.size === 0) {
      this.shadow.innerHTML = `
        <style>
          :host {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 0.75rem;
          }
          .no-data { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.8125rem; grid-column: 1/-1; }
        </style>
        <div class="no-data">No providers registered</div>
      `;
      return;
    }

    let html = "";
    for (const [name, entries] of grouped) {
      const f = entries[0];
      const score = f.stabilityScore;
      const conf = f.keyConfigured;

      let mh = "";
      entries.forEach((e) => {
        mh += `<div class="mrow"><span class="mname">${e.model}</span><span class="mstats"><span style="color:${sc(e.stabilityScore)}">${String(e.stabilityScore)}%</span><span>${fv(e.p95Latency, "ms")}</span><span>${fv(e.meanTokensPerSecond)} t/s</span><span>${String(e.requestCount)}c</span></span></div>`;
      });

      html += `<div class="worker" style="opacity:${conf ? "1" : "0.4"}">
        <div class="worker-head"><span class="worker-name">${name}</span><span class="key-badge ${conf ? "active" : "no-key"}">${conf ? "active" : "no key"} <hive-info>${conf ? "API key configured" : "No API key configured"}</hive-info></span></div>
        <div class="sbar"><span class="score" style="color:${sc(score)}">${String(score)}% <hive-info>Composite stability score based on recent success rate and latency</hive-info></span><span class="bar-text" style="color:${sc(score)}">${bar(score)}</span></div>
        <div class="wmet">
          <div class="wmet-item"><span class="l">Latency <hive-info>95th percentile latency</hive-info></span><span class="v">${fv(f.p95Latency, "ms")}</span></div>
          <div class="wmet-item"><span class="l">Output <hive-info>Mean output tokens per second</hive-info></span><span class="v">${fv(f.meanTokensPerSecond)} t/s</span></div>
          <div class="wmet-item"><span class="l">Calls <hive-info>Requests in current tracking window</hive-info></span><span class="v">${String(f.requestCount)}</span></div>
        </div>
        ${entries.length > 0 ? `<div class="mrows">${mh}</div>` : ""}
      </div>`;
    }

    this.shadow.innerHTML = `
      <style>
        :host {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 0.75rem;
        }
        .worker {
          background: var(--card);
          border: 1px solid var(--border);
          padding: 0.875rem;
        }
        .worker-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.625rem;
        }
        .worker-name {
          font-size: 1rem;
          font-weight: 700;
          text-transform: capitalize;
        }
        .key-badge {
          font-size: 0.5625rem;
          padding: 0.0625rem 0.375rem;
          font-weight: 700;
          border: 1px solid currentColor;
        }
        .key-badge.active { color: var(--success); border-color: var(--success); background: rgba(var(--success-rgb), 0.08); }
        .key-badge.no-key { color: var(--muted); border-color: var(--border); background: transparent; }
        .sbar {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }
        .score {
          font-size: 0.75rem;
          font-weight: 700;
          min-width: 2.5rem;
        }
        .bar-text {
          font-family: monospace;
          font-size: 0.75rem;
          letter-spacing: 0.05em;
          line-height: 1;
        }
        .wmet {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.5rem;
          text-align: center;
          margin-bottom: 0.75rem;
        }
        .wmet-item { display: flex; flex-direction: column; gap: 0.125rem; }
        .wmet-item .l { font-size: 0.5625rem; color: var(--muted); text-transform: uppercase; }
        .wmet-item .v { font-size: 0.875rem; font-weight: 600; }
        .mrows { border-top: 1px solid var(--border); padding-top: 0.5rem; margin-top: 0.25rem; }
        .mrow {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          padding: 0.25rem 0;
        }
        .mrow + .mrow { border-top: 1px solid rgba(var(--border-rgb), 0.3); }
        .mname { color: var(--accent); font-family: monospace; font-size: 0.6875rem; font-weight: 500; }
        .mstats { display: flex; gap: 0.75rem; color: var(--muted); font-size: 0.625rem; }
        .mstats span { white-space: nowrap; }
      </style>
      ${html}
    `;
  }
}

customElements.define("hive-providers", HiveProviders);
