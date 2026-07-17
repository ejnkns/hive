<script lang="ts">
import type { HeaderData } from "./types";

let {
  data = $bindable({
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
    successRate: null as number | null,
    activeProviders: 0,
    avgLatency: null,
  } as HeaderData),
  onOverrideSet = () => {},
  onOverrideClear = () => {},
} = $props();

let pendingProvider: string | null = $state(null);
let pendingModel: string | null = $state(null);

const logo =
  "   ,-.      .' '.        .`\n   \\_/      .   .       .\n:>(|||} .    ` .       .\n   / \\   '. . '  ' . '\n   `-'  ";

const configuredProviders = $derived(
  data.availableProviders.filter((p) => p.keyConfigured && !p.disabled)
);
const selectedProvider = $derived(
  data.override.active
    ? data.override.provider
    : (pendingProvider ?? data.lastProvider)
);
const selectedProviderData = $derived(
  configuredProviders.find((p) => p.name === selectedProvider)
);
const models = $derived(selectedProviderData?.models ?? []);
const selectedModel = $derived(
  data.override.active
    ? data.override.model
    : pendingProvider && pendingModel
      ? pendingModel
      : data.lastProvider === selectedProvider
        ? data.lastModel
        : null
);

const successColor = $derived(
  data.successRate == null
    ? "var(--muted)"
    : data.successRate < 75
      ? "#d4451a"
      : data.successRate < 90
        ? "#e2a93b"
        : "#7cb342"
);
const strategyLabel = $derived(
  data.routingStrategy === "latency"
    ? "LATENCY"
    : data.routingStrategy === "quality"
      ? "QUALITY"
      : "BALANCED"
);

function onProviderChange(e: Event) {
  const provider = (e.target as HTMLSelectElement).value;
  if (data.override.active) {
    overrideSet(provider, models[0] ?? "");
  } else {
    pendingProvider = provider;
    pendingModel = null;
  }
}

function onModelChange(e: Event) {
  const model = (e.target as HTMLSelectElement).value;
  if (data.override.active) {
    const provider = selectedProvider ?? "";
    overrideSet(provider, model);
  } else {
    pendingModel = model;
  }
}

function overrideSet(provider: string, model: string) {
  if (provider && model) {
    onOverrideSet(provider, model);
  }
}

function toggleOverride() {
  if (data.override.active) {
    onOverrideClear();
  } else {
    const provider = pendingProvider ?? data.lastProvider ?? "";
    const model = pendingModel ?? data.lastModel ?? "";
    if (provider && model) {
      onOverrideSet(provider, model);
    }
  }
}

function toggleTheme() {
  const light = document.documentElement.classList.toggle("light");
  localStorage.setItem("theme", light ? "light" : "dark");
}
</script>

<div class="header-inner">
  <div class="logo-area">
    <a href="#/" class="logo-text">[ <b>h i v e</b> ]</a>
    <pre class="logo-ascii">{logo}</pre>
    <div style="margin-top:0.5rem">
      <a href="#/canvas" class="nav-link">Ephemeral Canvas &rarr;</a>
    </div>
  </div>
  <div class="header-meta">
    <div class="status-row">
      <span class="badge-status {data.online ? 'on' : 'off'}">{data.online ? "ONLINE" : "OFFLINE"}</span>
      <span class="server-addr">{data.serverAddr}</span>
      <span class="badge-secondary">STRATEGY: {strategyLabel}</span>
      <span class="badge-secondary">CW: {data.contextWindowWeight.toFixed(1)}</span>
    </div>
    <div class="stats-bar">
      <span class="stat">TRAFFIC: <b>{data.traffic > 0 ? String(data.traffic) : "—"}</b></span>
      <span class="stat">SUCCESS: <b style="color:{successColor}">{data.successRate != null ? `${String(data.successRate)}%` : "—"}</b></span>
      <span class="stat">ACTIVE: <b>{String(data.activeProviders)}</b></span>
      <span class="stat">LATENCY: <b>{data.avgLatency != null ? `${data.avgLatency}ms` : "—"}</b></span>
    </div>
    {#if data.lastProvider && data.lastModel}
      <div class="status-row"><span class="label">Last:</span><span class="prov">{data.lastProvider}</span><span> / </span><span class="model">{data.lastModel}</span></div>
    {/if}
    {#if data.bestProvider && data.bestModel}
      <div class="status-row">
        <span class="label">Best:</span><span class="prov">{data.bestProvider}</span><span> / </span><span class="model">{data.bestModel}</span>
        {#if data.bestScore != null}<span class="score"> ({Math.round(data.bestScore)}%)</span>{/if}
      </div>
    {/if}
    {#if data.override.active && data.override.provider && data.override.model}
      <div class="status-row"><span class="label">Pinned:</span><span class="prov">{data.override.provider}</span><span> / </span><span class="model">{data.override.model}</span></div>
    {/if}
    <div class="override-area">
      <select class="provider-select" onchange={onProviderChange}>
        <option value="">—</option>
        {#each configuredProviders as p}
          <option value={p.name} selected={selectedProvider === p.name}>{p.displayName}</option>
        {/each}
      </select>
      <select class="model-select" onchange={onModelChange} disabled={models.length === 0}>
        <option value="">—</option>
        {#each models as m}
          <option value={m} selected={selectedModel === m}>{m}</option>
        {/each}
      </select>
      <button class="auto-btn" onclick={toggleOverride}>{data.override.active ? "auto" : "pin"}</button>
    </div>
    <button class="theme-btn" onclick={toggleTheme}>{document.documentElement.classList.contains("light") ? "dark" : "light"}</button>
  </div>
</div>

<style>
  .header-inner {
    background: var(--bg);
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem 1.25rem;
    z-index: 1;
  }
  .logo-area { display: flex; flex-direction: column; }
  .logo-ascii {
    font-family: monospace;
    font-size: 0.625rem;
    line-height: 1.3;
    color: var(--accent);
    margin: 0;
    white-space: pre;
  }
  .logo-text {
    color: var(--logo-text);
    white-space: nowrap;
    width: 248px;
    text-decoration: none;
  }
  .nav-link {
    font-size: 0.75rem;
    color: var(--accent);
    text-decoration: none;
    font-weight: bold;
  }
  .nav-link:hover {
    text-decoration: underline;
  }
  .header-meta {
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.375rem;
  }
  .server-addr { font-size: 0.625rem; color: var(--muted); }
  .badge-status {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 0.125rem 0.5rem;
    border-radius: 0;
    display: inline-block;
  }
  .badge-status.on { background: rgba(var(--success-rgb), 0.12); color: var(--success); border: 1px solid var(--success); }
  .badge-status.off { background: rgba(var(--error-rgb), 0.12); color: var(--error); border: 1px solid var(--error); }
  .badge-secondary {
    font-size: 0.5625rem;
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
    padding: 0.125rem 0.375rem;
    border: 1px solid rgba(var(--accent-rgb), 0.2);
    margin-left: 0.5rem;
  }
  .stats-bar {
    display: flex;
    gap: 0.75rem;
    font-size: 0.5625rem;
    color: var(--muted);
  }
  .stat b { color: var(--text); }
  .status-row { display: flex; align-items: center; gap: 0.25rem; font-size: 0.625rem; white-space: nowrap; }
  .status-row .label { color: var(--muted); min-width: 32px; text-align: right; }
  .status-row .prov { text-transform: capitalize; }
  .status-row .model { font-family: monospace; color: var(--accent); }
  .status-row .score { color: var(--muted); }
  .override-area { display: flex; align-items: center; gap: 0.25rem; margin-top: auto; }
  .override-area select {
    font-family: monospace;
    font-size: 0.625rem;
    padding: 0.125rem 0.25rem;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    max-width: 130px;
  }
  .override-area select:disabled { opacity: 0.4; pointer-events: none; }
  .override-area select:hover:not(:disabled) { border-color: var(--accent); }
  .auto-btn, .theme-btn {
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
  .auto-btn:hover, .theme-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
