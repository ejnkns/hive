<script lang="ts">
import { jellyDisabled } from "./jelly-disabled.svelte";
import { getThemeMode, setLightMode } from "./theme-state.svelte";
import type { HeaderData } from "./utils";

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
  onOverrideSet = (_provider: string, _model: string) => {},
  onOverrideClear = () => {},
  onOpenModelPriority = () => {},
} = $props();

let pendingProvider: string | null = $state(null);
let pendingModel: string | null = $state(null);

let providerSelectEl = $state<HTMLElement & { value: string }>();
let modelSelectEl = $state<HTMLElement & { value: string }>();

$effect(() => {
  if (providerSelectEl) {
    providerSelectEl.value = selectedProvider ?? "";
  }
});

$effect(() => {
  if (modelSelectEl) {
    modelSelectEl.value = selectedModel ?? "";
  }
});

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

function handleProviderChange(e: Event) {
  const el = e.target as HTMLElement & { value: string };
  const provider = el.value;
  if (!provider) return;
  if (data.override.active) {
    overrideSet(provider, models[0] ?? "");
  } else {
    pendingProvider = provider;
    pendingModel = null;
  }
}

function handleModelChange(e: Event) {
  const el = e.target as HTMLElement & { value: string };
  const model = el.value;
  if (!model) return;
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

function handlePinToggle(e: Event) {
  const checked = (e.target as HTMLElement & { checked: boolean }).checked;
  if (checked) {
    const provider = pendingProvider ?? data.lastProvider ?? "";
    const model = pendingModel ?? data.lastModel ?? "";
    if (provider && model) {
      onOverrideSet(provider, model);
    }
  } else {
    onOverrideClear();
  }
}

let themeMode = $derived(getThemeMode());

function toggleTheme() {
  const light = !document.documentElement.classList.toggle("light");
  setLightMode(!light);
  const mode = !light ? "light" : "dark";
  localStorage.setItem("theme", mode);
  document.documentElement.setAttribute("data-jelly-mode", mode);
}
</script>

<div class="header-inner">
  <div class="logo-area">
    <a href="#/" class="logo-text">[ <b>h i v e</b> ]</a>
    <pre class="logo-ascii">{logo}</pre>
    <a href="#/canvas" class="nav-link">Ephemeral Canvas &rarr;</a>
  </div>
  <div class="header-meta">
    <div class="header-controls">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <jelly-icon-button
        size="small"
        variant="platinum"
        label="Toggle theme"
        onclick={toggleTheme}
      >
        {themeMode === "light" ? "☽" : "☼"}
      </jelly-icon-button>

      <jelly-badge size="small" variant={data.online ? "mint" : "rose"} live>
        {data.online ? "ONLINE" : "OFFLINE"}
      </jelly-badge>
    </div>

    <div class="stats-bar">
      <span class="stat">
        <span class="stat-label">TRAFFIC</span>
        <span class="stat-val"
          >{data.traffic > 0 ? String(data.traffic) : "—"}</span
        >
      </span>
      <span class="stat">
        <span class="stat-label">SUCCESS</span>
        <span class="stat-val" style="color:{successColor}">
          {data.successRate != null ? `${String(data.successRate)}%` : "—"}
        </span>
      </span>
      <span class="stat">
        <span class="stat-label">PROVIDERS</span>
        <span class="stat-val">{String(data.activeProviders)}</span>
      </span>
      <span class="stat">
        <span class="stat-label">LATENCY</span>
        <span class="stat-val">
          {data.avgLatency != null ? `${data.avgLatency}ms` : "—"}
        </span>
      </span>
    </div>

    <div class="route-info">
      {#if data.lastProvider && data.lastModel}
        <span class="route-label">Last</span>
        <jelly-badge size="small" variant="platinum" outline>
          {data.lastProvider}/{data.lastModel}
        </jelly-badge>
      {/if}
      {#if data.override.active && data.override.provider && data.override.model}
        <span class="route-label">Pinned</span>
        <jelly-badge size="small" variant="amber">
          {data.override.provider}/{data.override.model}
        </jelly-badge>
      {/if}
    </div>

    <div class="route-controls">
      <jelly-select
        size="small"
        placeholder="Provider"
        bind:this={providerSelectEl}
        onchange={handleProviderChange}
      >
        {#each configuredProviders as p}
          <jelly-option value={p.name}>{p.displayName}</jelly-option>
        {/each}
      </jelly-select>

      <jelly-select
        size="small"
        placeholder="Model"
        bind:this={modelSelectEl}
        onchange={handleModelChange}
        use:jellyDisabled={models.length === 0}
      >
        {#each models as m}
          <jelly-option value={m}>{m}</jelly-option>
        {/each}
      </jelly-select>
    </div>

    <div class="action-row">
      <jelly-switch
        size="small"
        checked={data.override.active}
        onchange={handlePinToggle}
      >
        Pin
      </jelly-switch>

      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <jelly-icon-button
        size="small"
        variant="platinum"
        label="Model priority"
        onclick={onOpenModelPriority}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
          />
        </svg>
      </jelly-icon-button>
    </div>
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
.logo-area {
  display: flex;
  flex-direction: column;
  width: 248px;
}
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
  align-self: flex-end;
  white-space: nowrap;
  text-decoration: none;
}
.nav-link {
  font-size: 0.75rem;
  color: var(--accent);
  text-decoration: none;
  font-weight: bold;
  margin-top: 0.5rem;
}
.nav-link:hover {
  text-decoration: underline;
}
.header-meta {
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}
.header-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.stats-bar {
  display: flex;
  gap: 0.75rem;
  font-size: 0.5625rem;
  color: var(--muted);
}
.stat {
  white-space: nowrap;
}
.stat-label {
  color: var(--muted);
}
.stat-val {
  color: var(--text);
  font-weight: 700;
  margin-left: 0.125rem;
}
.route-info {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.625rem;
}
.route-label {
  color: var(--muted);
  min-width: 32px;
  text-align: right;
}
.route-controls {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
