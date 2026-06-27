import type { ProviderData, MetricData, ConversationData } from "./types";
import { sc, formatNumber, bar } from "./utils";
import "./hive-info";
import "./hive-activity-log";
import "./hive-conversations";

type ActivityLogEl = HTMLElement & { data: MetricData[] };
type ConversationsEl = HTMLElement & { data: ConversationData[] };

export class HiveProviders extends HTMLElement {
  private shadow: ShadowRoot;
  private _data: ProviderData[] = [];
  private _metrics: MetricData[] = [];
  private _conversations: ConversationData[] = [];
  private expandedConsoles = new Set<string>();
  private activeTabs = new Map<string, "activity" | "conversations">();

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: ProviderData[]) {
    this._data = value;
    this.render();
  }

  set metrics(value: MetricData[]) {
    this._metrics = value;
  }

  set conversations(value: ConversationData[]) {
    this._conversations = value;
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    const grouped = new Map<string, ProviderData[]>();
    this._data.forEach((x) => {
      const existing = grouped.get(x.name);
      if (existing) {
        existing.push(x);
      } else {
        grouped.set(x.name, [x]);
      }
    });

    const providerGroups = Array.from(grouped.entries()).map(
      ([name, entries]) => {
        const maxScore = Math.max(...entries.map((e) => e.stabilityScore));
        const keyConfigured = entries.some((e) => e.keyConfigured);
        const displayName = entries[0].displayName || name;
        return {
          name,
          displayName,
          entries,
          maxScore,
          keyConfigured,
        };
      }
    );

    // Sort: Configured first, then by max stability score descending
    providerGroups.sort((a, b) => {
      if (a.keyConfigured && !b.keyConfigured) return -1;
      if (!a.keyConfigured && b.keyConfigured) return 1;
      return b.maxScore - a.maxScore;
    });

    if (providerGroups.length === 0) {
      this.shadow.innerHTML = `
        <style>
          :host {
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }
          .no-data { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.8125rem; }
        </style>
        <div class="no-data">No providers registered</div>
      `;
      return;
    }

    let html = "";
    providerGroups.forEach((group) => {
      const { name, displayName, entries, maxScore, keyConfigured } = group;
      const f = entries[0];
      const isExpanded = this.expandedConsoles.has(name);
      const activeTab = this.activeTabs.get(name) || "activity";

      let mh = "";
      entries.forEach((e) => {
        const tripped = e.trippedUntil && e.trippedUntil > Date.now();
        const cooldownSec =
          tripped && e.trippedUntil
            ? Math.round((e.trippedUntil - Date.now()) / 1000)
            : 0;
        const trippedBadge = tripped
          ? `<span class="badge tripped">CB (${String(cooldownSec)}s)</span>`
          : "";
        const featuresBadge =
          e.disabledFeatures && e.disabledFeatures.length > 0
            ? `<span class="badge unsupported">no-${e.disabledFeatures.join(", ")}</span>`
            : "";

        mh += `<div class="mrow"><span class="mname">${e.model}${trippedBadge}${featuresBadge}</span><span class="mstats"><span style="color:${sc(e.stabilityScore)}">${e.stabilityScore.toFixed(2)}%</span><span>${formatNumber(e.p95Latency, "ms")}</span><span>${formatNumber(e.meanTokensPerSecond)} t/s</span><span>${String(e.requestCount)}c</span></span></div>`;
      });

      html += `
        <div class="worker" style="opacity:${keyConfigured ? "1" : "0.4"}">
          <div class="worker-summary">
            <div class="worker-identity">
              <span class="worker-name">${displayName}</span>
              <span class="key-badge ${keyConfigured ? "active" : "no-key"}">${keyConfigured ? "active" : "no key"} <hive-info>${keyConfigured ? "API key configured" : "No API key configured"}</hive-info></span>
            </div>
            
            <div class="sbar">
              <span class="score" style="color:${sc(maxScore)}">${maxScore.toFixed(2)}% <hive-info>Composite stability score based on recent success rate and latency</hive-info></span>
              <span class="bar-text" style="color:${sc(maxScore)}">${bar(maxScore)}</span>
            </div>
            
            <div class="wmet">
              <div class="wmet-item"><span class="l">Latency <hive-info>95th percentile latency</hive-info></span><span class="v">${formatNumber(f.p95Latency, "ms")}</span></div>
              <div class="wmet-item"><span class="l">Output <hive-info>Mean output tokens per second</hive-info></span><span class="v">${formatNumber(f.meanTokensPerSecond)} t/s</span></div>
              <div class="wmet-item"><span class="l">Calls <hive-info>Requests in current tracking window</hive-info></span><span class="v">${f.requestCount.toString()}</span></div>
            </div>
          </div>

          <div class="mrows">${mh}</div>

          ${
            keyConfigured
              ? `
            <div class="console-section">
              <div class="console-toggle" data-provider="${name}">
                <span>Provider Console</span>
                <span class="toggle-icon">${isExpanded ? "▲" : "▼"}</span>
              </div>
              <div class="console-content ${isExpanded ? "" : "collapsed"}">
                <div class="tab-bar">
                  <span class="tab ${activeTab === "activity" ? "active" : ""}" data-provider="${name}" data-tab="activity">Recent Activity</span>
                  <span class="tab ${activeTab === "conversations" ? "active" : ""}" data-provider="${name}" data-tab="conversations">Conversations</span>
                </div>
                <div class="tab-content">
                  <div class="view-pane ${activeTab === "activity" ? "" : "hidden"}" id="activity-${name}">
                    <hive-activity-log></hive-activity-log>
                  </div>
                  <div class="view-pane ${activeTab === "conversations" ? "" : "hidden"}" id="conversations-${name}">
                    <hive-conversations></hive-conversations>
                  </div>
                </div>
              </div>
            </div>
          `
              : ""
          }
        </div>
      `;
    });

    this.shadow.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .worker {
          background: var(--card);
          border: 1px solid var(--border);
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .worker-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 1rem;
        }
        .worker-identity {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 150px;
        }
        .worker-name {
          font-size: 1.125rem;
          font-weight: 700;
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
          min-width: 180px;
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
          display: flex;
          gap: 1.5rem;
        }
        .wmet-item { display: flex; flex-direction: column; gap: 0.125rem; min-width: 60px; }
        .wmet-item .l { font-size: 0.5625rem; color: var(--muted); text-transform: uppercase; }
        .wmet-item .v { font-size: 0.875rem; font-weight: 600; }
        
        .mrows {
          border-top: 1px solid var(--border);
          padding-top: 0.5rem;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 0.5rem;
        }
        .mrow {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          background: rgba(var(--border-rgb), 0.1);
          border: 1px solid rgba(var(--border-rgb), 0.3);
        }
        .mname { color: var(--accent); font-family: monospace; font-size: 0.6875rem; font-weight: 500; display: inline-flex; align-items: center; gap: 0.25rem; }
        .mstats { display: flex; gap: 0.75rem; color: var(--muted); font-size: 0.625rem; }
        .mstats span { white-space: nowrap; }
        
        .badge {
          display: inline-block;
          font-size: 0.5rem;
          font-weight: 700;
          padding: 0.0625rem 0.25rem;
          text-transform: uppercase;
          border-radius: 2px;
        }
        .badge.tripped {
          background: rgba(var(--error-rgb), 0.15);
          color: var(--error);
        }
        .badge.unsupported {
          background: rgba(var(--accent-rgb), 0.15);
          color: var(--accent);
        }

        /* Collapsible Console Styles */
        .console-section {
          border-top: 1px solid var(--border);
          padding-top: 0.5rem;
        }
        .console-toggle {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--muted);
          text-transform: uppercase;
          cursor: pointer;
          padding: 0.25rem 0.5rem;
          background: rgba(var(--border-rgb), 0.15);
          user-select: none;
        }
        .console-toggle:hover {
          color: var(--accent);
          background: rgba(var(--border-rgb), 0.25);
        }
        .console-content {
          margin-top: 0.5rem;
          border: 1px solid var(--border);
          background: var(--bg);
        }
        .console-content.collapsed {
          display: none;
        }
        .tab-bar {
          display: flex;
          background: var(--card);
          border-bottom: 1px solid var(--border);
        }
        .tab {
          font-size: 0.625rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
          cursor: pointer;
          padding: 0.375rem 0.75rem;
          color: var(--muted);
          border-right: 1px solid var(--border);
        }
        .tab:hover { color: var(--text); }
        .tab.active {
          color: var(--accent);
          background: var(--card);
        }
        .tab-content {
          height: 250px;
          overflow: hidden;
        }
        .view-pane {
          height: 100%;
          overflow-y: auto;
        }
        .view-pane.hidden {
          display: none;
        }
      </style>
      ${html}
    `;

    // Add event listeners
    this.shadow.querySelectorAll(".console-toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const providerName = toggle.getAttribute("data-provider");
        if (!providerName) return;
        if (this.expandedConsoles.has(providerName)) {
          this.expandedConsoles.delete(providerName);
        } else {
          this.expandedConsoles.add(providerName);
        }
        this.render();
      });
    });

    this.shadow.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const providerName = tab.getAttribute("data-provider");
        if (!providerName) return;
        const targetTab = tab.getAttribute("data-tab") as
          | "activity"
          | "conversations";
        this.activeTabs.set(providerName, targetTab);
        this.render();
      });
    });

    // Populate nested telemetry
    providerGroups.forEach((group) => {
      const { name, keyConfigured } = group;
      if (!keyConfigured || !this.expandedConsoles.has(name)) return;

      const providerMetrics = this._metrics.filter((m) => m.provider === name);
      const providerConversations = this._conversations.filter(
        (c) => c.provider === name
      );

      const activeTab = this.activeTabs.get(name) || "activity";

      if (activeTab === "activity") {
        const logEl = this.shadow.querySelector(
          `#activity-${name} hive-activity-log`
        ) as unknown as ActivityLogEl | null;
        if (logEl) logEl.data = providerMetrics;
      } else {
        const convEl = this.shadow.querySelector(
          `#conversations-${name} hive-conversations`
        ) as unknown as ConversationsEl | null;
        if (convEl) convEl.data = providerConversations;
      }
    });
  }
}

customElements.define("hive-providers", HiveProviders);
