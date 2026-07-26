<script lang="ts">
import { getThemeMode, setLightMode } from "./theme-state.svelte";
import type { HeaderData } from "./utils";
import Badge from "./ui/Badge.svelte";
import Button from "./ui/Button.svelte";
import Select from "./ui/Select.svelte";
import Switch from "./ui/Switch.svelte";

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
  onOverrideSet = ((_provider: string, _model: string) => {}) as (
    provider: string,
    model: string
  ) => void,
  onOverrideClear = (() => {}) as () => void,
  onOpenModelPriority = (() => {}) as () => void,
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

const providerItems = $derived(
  configuredProviders.map((p) => ({ value: p.name, label: p.displayName }))
);
const modelItems = $derived(models.map((m) => ({ value: m, label: m })));

const successColor = $derived(
  data.successRate == null
    ? "var(--muted)"
    : data.successRate < 75
      ? "#d4451a"
      : data.successRate < 90
        ? "#e2a93b"
        : "#7cb342"
);

function handleProviderChange(provider: string) {
  if (!provider) return;
  if (data.override.active) {
    overrideSet(provider, models[0] ?? "");
  } else {
    pendingProvider = provider;
    pendingModel = null;
  }
}

function handleModelChange(model: string) {
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

function handlePinToggle(checked: boolean) {
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
      <Button variant="platinum" onclick={toggleTheme}>
        {themeMode === "light" ? "☽" : "☼"}
      </Button>

      <Badge variant={data.online ? "mint" : "rose"} live>
        {data.online ? "ONLINE" : "OFFLINE"}
      </Badge>
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
        <Badge variant="platinum" outline>
          {data.lastProvider}/{data.lastModel}
        </Badge>
      {/if}
      {#if data.override.active && data.override.provider && data.override.model}
        <span class="route-label">Pinned</span>
        <Badge variant="amber">
          {data.override.provider}/{data.override.model}
        </Badge>
      {/if}
    </div>

    <div class="route-controls">
      <Select
        items={providerItems}
        bind:value={() => selectedProvider ?? "", handleProviderChange}
        placeholder="Provider"
      />

      <Select
        items={modelItems}
        bind:value={() => selectedModel ?? "", handleModelChange}
        placeholder="Model"
        disabled={models.length === 0}
      />
    </div>

    <div class="action-row">
      <Switch
        checked={data.override.active}
        onCheckedChange={handlePinToggle}
        label="Pin"
      />

      <Button variant="platinum" onclick={onOpenModelPriority}>
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
      </Button>
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
