import type { ProviderData } from "./types";
import { sc } from "./utils";
import "./hive-info";

export class HiveSwarm extends HTMLElement {
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
    const qualified = this._data.filter((x) => x.keyConfigured);
    if (qualified.length === 0) {
      this.shadow.innerHTML = `
        <style>
          :host {
            display: flex;
            align-items: center;
            gap: 0.375rem;
            font-size: 0.8125rem;
            flex-wrap: wrap;
            background: var(--card);
            border: 1px solid var(--border);
            padding: 0.5rem 0.875rem;
          }
          .swarm-label {
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-size: 0.625rem;
            font-weight: 700;
          }
          .empty { color: var(--muted); font-size: 0.75rem; }
        </style>
        <span class="swarm-label">Priority</span>
        <span class="empty">No active providers</span>
      `;
      return;
    }

    const best = new Map<string, ProviderData>();
    qualified.forEach((x) => {
      const existing = best.get(x.name);
      if (!existing || x.stabilityScore > existing.stabilityScore)
        best.set(x.name, x);
    });
    const sorted = Array.from(best.values()).sort(
      (a, b) => b.stabilityScore - a.stabilityScore
    );

    let nodes = "";
    sorted.forEach((x, i) => {
      if (i > 0) nodes += '<span class="swarm-arr">&gt;</span>';
      nodes += `<span class="swarm-node">${x.name} <span class="sc" style="color:${sc(x.stabilityScore)}">${String(x.stabilityScore)}%</span><hive-info>Stability score: composite of success rate and latency</hive-info></span>`;
    });

    this.shadow.innerHTML = `
      <style>
        :host {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          flex-wrap: wrap;
          background: var(--card);
          border: 1px solid var(--border);
          padding: 0.5rem 0.875rem;
        }
        .swarm-label {
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-size: 0.625rem;
          font-weight: 700;
        }
        .swarm-node {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.5rem;
          background: rgba(var(--accent-rgb), 0.06);
          font-weight: 600;
        }
        .swarm-node .sc {
          font-weight: 400;
          color: var(--muted);
          font-size: 0.75rem;
        }
        .swarm-arr {
          color: var(--muted);
          font-size: 0.6875rem;
        }
      </style>
      <span class="swarm-label">Priority <hive-info>Providers sorted by stability score descending</hive-info></span>
      ${nodes}
    `;
  }
}

customElements.define("hive-swarm", HiveSwarm);
