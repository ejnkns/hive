import type { HeaderData } from "./types";

const LOGO = [
  "   ,-.      .' '.        .`",
  "   \\_/      .   .       .",
  ":>(|||} .    ` .       .",
  "   / \\   '. . '  ' . '",
  "   `-'  ",
].join("\n");

export class HiveHeader extends HTMLElement {
  private shadow: ShadowRoot;
  private _data: HeaderData = {
    online: false,
    serverAddr: "—",
    lastProvider: null,
    lastModel: null,
    override: { active: false, provider: null, model: null },
    availableProviders: [],
    bestProvider: null,
    bestModel: null,
    bestScore: null,
    routingStrategy: "balanced",
    contextWindowWeight: 0,
    traffic: 0,
    successRate: 100,
    activeProviders: 0,
    avgLatency: null,
  };
  private _pendingProvider: string | null = null;
  private _pendingModel: string | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: HeaderData) {
    const becameActive = !this._data.override.active && value.override.active;
    this._data = value;
    if (becameActive) {
      this._pendingProvider = null;
      this._pendingModel = null;
    }
    this.render();
  }

  connectedCallback() {
    this.render();
    this.updateThemeBtn();
  }

  private attachThemeListener() {
    this.shadow.querySelector(".theme-btn")?.addEventListener("click", () => {
      const light = document.documentElement.classList.toggle("light");
      const theme = light ? "light" : "dark";
      localStorage.setItem("theme", theme);
      this.updateThemeBtn();
    });
  }

  private updateThemeBtn() {
    const btn = this.shadow.querySelector(".theme-btn");
    if (btn) {
      btn.textContent = document.documentElement.classList.contains("light") ? "dark" : "light";
    }
  }

  private onProviderChange(): void {
    const providerSelect = this.shadow.querySelector<HTMLSelectElement>(".provider-select");
    if (!providerSelect) return;
    const provider = providerSelect.value;
    if (this._data.override.active) {
      const modelSelect = this.shadow.querySelector<HTMLSelectElement>(".model-select");
      const providerData = this._data.availableProviders.find((p) => p.name === provider);
      if (providerData && providerData.models.length > 0 && modelSelect) {
        modelSelect.value = providerData.models[0];
      }
      this.dispatchOverride();
    } else {
      this._pendingProvider = provider;
      this._pendingModel = null;
      this.render();
      const modelSelect = this.shadow.querySelector<HTMLSelectElement>(".model-select");
      const providerData = this._data.availableProviders.find((p) => p.name === provider);
      if (modelSelect && providerData && providerData.models.length > 0) {
        modelSelect.value = providerData.models[0];
        this._pendingModel = providerData.models[0];
      }
    }
  }

  private onModelChange(): void {
    this.dispatchOverride();
  }

  private dispatchOverride(): void {
    const providerSelect = this.shadow.querySelector<HTMLSelectElement>(".provider-select");
    const modelSelect = this.shadow.querySelector<HTMLSelectElement>(".model-select");
    if (!providerSelect || !modelSelect) return;
    if (!providerSelect.value || !modelSelect.value) return;
    this.dispatchEvent(
      new CustomEvent("override-set", {
        bubbles: true,
        composed: true,
        detail: { provider: providerSelect.value, model: modelSelect.value },
      })
    );
  }

  private onClearOverride(): void {
    const providerSelect = this.shadow.querySelector<HTMLSelectElement>(".provider-select");
    const modelSelect = this.shadow.querySelector<HTMLSelectElement>(".model-select");
    if (providerSelect?.value) this._pendingProvider = providerSelect.value;
    if (modelSelect?.value) this._pendingModel = modelSelect.value;
    this.dispatchEvent(
      new CustomEvent("override-clear", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private render() {
    const {
      online,
      serverAddr,
      lastProvider,
      lastModel,
      override,
      availableProviders,
      bestProvider,
      bestModel,
      bestScore,
      routingStrategy,
      contextWindowWeight,
      traffic,
      successRate,
      activeProviders,
      avgLatency,
    } = this._data;

    const overrideActive = override.active;
    const configuredProviders = availableProviders.filter((p) => p.keyConfigured);

    const selectedProvider = overrideActive ? override.provider : (this._pendingProvider ?? lastProvider);

    const selectedProviderData = configuredProviders.find((p) => p.name === selectedProvider);
    const models = selectedProviderData?.models ?? [];

    let providerOptions = '<option value="">—</option>';
    for (const p of configuredProviders) {
      const sel = selectedProvider === p.name ? "selected" : "";
      providerOptions += `<option value="${p.name}" ${sel}>${p.displayName}</option>`;
    }

    const selectedModel = overrideActive
      ? override.model
      : this._pendingProvider && this._pendingModel
        ? this._pendingModel
        : lastProvider === selectedProvider
          ? lastModel
          : null;

    let modelOptions = '<option value="">—</option>';
    for (const m of models) {
      const sel = selectedModel === m ? "selected" : "";
      modelOptions += `<option value="${m}" ${sel}>${m}</option>`;
    }

    let lastLine = "";
    if (lastProvider && lastModel) {
      lastLine = `<div class="status-row"><span class="label">Last:</span><span class="prov">${lastProvider}</span><span> / </span><span class="model">${lastModel}</span></div>`;
    }
    let bestLine = "";
    if (bestProvider && bestModel) {
      const score = bestScore != null ? ` <span class="score">(${bestScore.toFixed(0)}%)</span>` : "";
      bestLine = `<div class="status-row"><span class="label">Best:</span><span class="prov">${bestProvider}</span><span> / </span><span class="model">${bestModel}</span>${score}</div>`;
    }
    let pinnedLine = "";
    if (overrideActive && override.provider && override.model) {
      pinnedLine = `<div class="status-row"><span class="label">Pinned:</span><span class="prov">${override.provider}</span><span> / </span><span class="model">${override.model}</span></div>`;
    }

    const successColor = successRate < 75 ? "crit" : successRate < 90 ? "warn" : "ok";
    const trafficStr = traffic > 0 ? String(traffic) : "—";
    const latencyStr = avgLatency != null ? `${String(avgLatency)}ms` : "—";
    const strategyLabel =
      routingStrategy === "latency" ? "LATENCY" : routingStrategy === "quality" ? "QUALITY" : "BALANCED";

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          border-bottom: 1px solid var(--border);
          background: var(--card);
          position: sticky;
          top: 0;
          z-index: 50;
          padding: 0.5rem 1.25rem 0.375rem;
        }
        .header-inner {
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          max-width: 1200px;
          margin: 0 auto;
        }
        header pre {
          font-family: monospace;
          font-size: 0.625rem;
          line-height: 1.3;
          color: var(--accent);
          margin: 0;
          white-space: pre;
        }
        .header-meta {
          text-align: right;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.375rem;
        }
        .server-addr {
          font-size: 0.625rem;
          color: var(--muted);
        }
        .badge-status {
          font-size: 0.625rem;
          font-weight: 700;
          padding: 0.125rem 0.5rem;
          border-radius: 0;
          display: inline-block;
        }
        .badge-status.on {
          background: rgba(var(--success-rgb), 0.12);
          color: var(--success);
          border: 1px solid var(--success);
        }
        .badge-status.off {
          background: rgba(var(--error-rgb), 0.12);
          color: var(--error);
          border: 1px solid var(--error);
        }
        .override-area {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          margin-top: auto;
        }
        .override-area select {
          font-family: monospace;
          font-size: 0.625rem;
          padding: 0.125rem 0.25rem;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
          max-width: 130px;
        }
        .override-area select:disabled {
          opacity: 0.4;
          pointer-events: none;
        }
        .override-area select:hover:not(:disabled) {
          border-color: var(--accent);
        }
        .auto-btn {
          font-family: inherit;
          font-size: 0.5625rem;
          padding: 0.125rem 0.375rem;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          line-height: 1.4;
        }
        .auto-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .theme-btn {
          font-family: inherit;
          font-size: 0.5625rem;
          padding: 0.125rem 0.5rem;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .theme-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .status-row {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.625rem;
          white-space: nowrap;
        }
        .status-row .label {
          color: var(--muted);
          min-width: 32px;
          text-align: right;
        }
        .status-row .prov {
          text-transform: capitalize;
        }
        .status-row .model {
          font-family: monospace;
          color: var(--accent);
        }
        .status-row .score {
          color: var(--muted);
        }
        .badge-strategy {
          font-size: 0.5625rem;
          color: var(--accent);
          background: rgba(var(--accent-rgb), 0.08);
          padding: 0.125rem 0.375rem;
          border: 1px solid rgba(var(--accent-rgb), 0.2);
          margin-left: 0.5rem;
        }
        .badge-cw {
          font-size: 0.5625rem;
          color: var(--muted);
          background: rgba(var(--muted-rgb, 120, 120, 120), 0.08);
          padding: 0.125rem 0.375rem;
          border: 1px solid rgba(var(--muted-rgb, 120, 120, 120), 0.15);
        }
        .stats-bar {
          display: flex;
          gap: 0.75rem;
          font-size: 0.5625rem;
          color: var(--muted);
        }
        .stat b {
          color: var(--text);
        }
        .stat b.crit {
          color: var(--error);
        }
        .stat b.warn {
          color: var(--warn, #e2a93b);
        }
        .stat b.ok {
          color: var(--success);
        }
        .logo {
          display: flex;
          align-items: top;
        }
        .logo-text {
          color: var(--logo-text); 
          white-space: nowrap;
        }
      </style>
      <button class="theme-btn">dark</button>
      <div class="header-inner">
        <div class="logo">
          <pre>${LOGO}</pre>
          <span class="logo-text">[ <b>h i v e</b> ]</span>
        </div>
        <div class="header-meta">
          <div class="status-row">
            <span class="badge-status ${online ? "on" : "off"}">${online ? "ONLINE" : "OFFLINE"}</span>
            <span class="server-addr">${serverAddr}</span>
            <span class="badge-strategy">STRATEGY: ${strategyLabel}</span>
            <span class="badge-cw">CW: ${contextWindowWeight.toFixed(1)}</span>
          </div>
          <div class="stats-bar">
            <span class="stat">TRAFFIC: <b>${trafficStr}</b></span>
            <span class="stat">SUCCESS: <b class="${successColor}">${String(successRate)}%</b></span>
            <span class="stat">ACTIVE: <b>${String(activeProviders)}</b></span>
            <span class="stat">LATENCY: <b>${latencyStr}</b></span>
          </div>
          ${lastLine}
          ${bestLine}
          ${pinnedLine}
          <div class="override-area">
            <select class="provider-select">
              ${providerOptions}
            </select>
            <select class="model-select">
              ${modelOptions}
            </select>
            <button class="auto-btn">${overrideActive ? "auto" : "pin"}</button>
          </div>
        </div>
      </div>
    `;
    this.updateThemeBtn();
    this.attachThemeListener();

    // Attach override listeners
    const providerSelect = this.shadow.querySelector<HTMLSelectElement>(".provider-select");
    const modelSelect = this.shadow.querySelector<HTMLSelectElement>(".model-select");
    const autoBtn = this.shadow.querySelector(".auto-btn");

    if (providerSelect) {
      providerSelect.addEventListener("change", () => {
        this.onProviderChange();
      });
    }
    if (modelSelect && overrideActive) {
      modelSelect.addEventListener("change", () => {
        this.onModelChange();
      });
    }
    if (autoBtn) {
      if (overrideActive) {
        autoBtn.addEventListener("click", () => {
          this.onClearOverride();
        });
      } else {
        autoBtn.addEventListener("click", () => {
          this.dispatchOverride();
        });
      }
    }
  }
}

customElements.define("hive-header", HiveHeader);
