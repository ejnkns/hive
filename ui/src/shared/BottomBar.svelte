<script lang="ts">
import { onMount } from "svelte";
import Button from "./ui/Button.svelte";
import Select from "./ui/Select.svelte";
import Switch from "./ui/Switch.svelte";
import type { HeaderData } from "./utils.ts";

let {
  data = {
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
  } as HeaderData,
  onOverrideSet = ((_provider: string, _model: string) => {}) as (
    provider: string,
    model: string
  ) => void,
  onOverrideClear = (() => {}) as () => void,
  onOpenModelPriority = (() => {}) as () => void,
} = $props();

let active = $state("flows");
let manageOpen = $state(false);
let popoverOpen = $state(false);

let pendingProvider: string | null = $state(null);
let pendingModel: string | null = $state(null);

const pinned = $derived(
  data.override.active && data.override.provider && data.override.model
);

/* the chip shows where traffic is actually going */
const routeNode = $derived(
  pinned
    ? `${data.override.provider}/${data.override.model}`
    : data.bestProvider && data.bestModel
      ? `${data.bestProvider}/${data.bestModel}`
      : data.lastProvider && data.lastModel
        ? `${data.lastProvider}/${data.lastModel}`
        : null
);

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

function handleProviderChange(provider: string) {
  if (!provider) return;
  if (data.override.active) {
    onOverrideSet(provider, models[0] ?? "");
  } else {
    pendingProvider = provider;
    pendingModel = null;
  }
}

function handleModelChange(model: string) {
  if (!model) return;
  if (data.override.active) {
    const provider = selectedProvider ?? "";
    onOverrideSet(provider, model);
  } else {
    pendingModel = model;
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

function updateActive() {
  const h = window.location.hash;
  if (h.startsWith("#/flows")) active = "flows";
  else if (h === "#/dashboard") active = "dashboard";
  else if (h === "#/playground") active = "playground";
  else if (h === "#/settings") active = "settings";
  else active = "landing";
}

const manageActive = $derived(
  active === "dashboard" || active === "playground" || active === "settings"
);

onMount(() => {
  updateActive();
  window.addEventListener("hashchange", updateActive);
  const onDocDown = (e: PointerEvent) => {
    const t = e.target as Element;
    /* allow clicks inside either popover and the portal'd select menus */
    if (
      (popoverOpen &&
        !t.closest(".route-wrap") &&
        !t.closest(".hive-select-content")) ||
      (manageOpen && !t.closest(".manage-wrap"))
    ) {
      popoverOpen = false;
      manageOpen = false;
    }
  };
  document.addEventListener("pointerdown", onDocDown);
  return () => {
    window.removeEventListener("hashchange", updateActive);
    document.removeEventListener("pointerdown", onDocDown);
  };
});
</script>

<footer class="bottom-bar">
  <div class="bottom-inner">
    <nav class="nav" aria-label="Primary">
      <a
        href="#/flows"
        class="nav-item nav-primary"
        class:active={active === "flows"}
      >
        flows
      </a>
      <span class="nav-sep" aria-hidden="true">·</span>
      <div class="manage-wrap">
        <button
          type="button"
          class="manage-btn"
          class:active={manageActive}
          onclick={() => (manageOpen = !manageOpen)}
          aria-haspopup="menu"
          aria-label="manage"
        >
          manage
          <span class="manage-caret" aria-hidden="true">▾</span>
        </button>
        {#if manageOpen}
          <div class="manage-menu" role="menu" aria-label="manage">
            <a
              href="#/dashboard"
              class="manage-item"
              class:active={active === "dashboard"}
              onclick={() => (manageOpen = false)}
            >
              dashboard
            </a>
            <a
              href="#/playground"
              class="manage-item"
              class:active={active === "playground"}
              onclick={() => (manageOpen = false)}
            >
              playground
            </a>
            <a
              href="#/settings"
              class="manage-item"
              class:active={active === "settings"}
              onclick={() => (manageOpen = false)}
            >
              settings
            </a>
          </div>
        {/if}
      </div>
    </nav>

    <div class="route">
      <div class="route-wrap">
        <button
          type="button"
          class="route-chip"
          class:pin={pinned}
          onclick={() => (popoverOpen = !popoverOpen)}
          aria-haspopup="dialog"
          aria-label="Routing control"
        >
          {#if pinned}
            pin {routeNode}
          {:else}
            auto{routeNode ? ` · ${routeNode}` : ""}
          {/if}
          <span aria-hidden="true">▾</span>
        </button>

        {#if popoverOpen}
          <div class="route-popover" role="dialog" aria-label="Routing">
            <div class="popover-field">
              <span class="popover-label">provider</span>
              <Select
                items={providerItems}
                value={selectedProvider ?? ""}
                onValueChange={handleProviderChange}
                placeholder="Provider"
              />
            </div>
            <div class="popover-field">
              <span class="popover-label">model</span>
              <Select
                items={modelItems}
                value={selectedModel ?? ""}
                onValueChange={handleModelChange}
                placeholder="Model"
                disabled={models.length === 0}
              />
            </div>
            <div class="popover-row">
              <Switch
                checked={data.override.active}
                onCheckedChange={handlePinToggle}
                label="pin"
              />
              <span class="popover-hint">
                {pinned
                  ? "pinned node tried first — auto-routing on failure"
                  : "requests route automatically"}
              </span>
            </div>
            <div class="popover-footer">
              <Button
                variant="neutral"
                size="small"
                onclick={() => {
                  popoverOpen = false;
                  onOpenModelPriority();
                }}
              >
                model priority
              </Button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</footer>

<style>
.bottom-bar {
  flex-shrink: 0;
  z-index: 90;
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.bottom-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.375rem 1.25rem;
}

.nav {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.nav-sep {
  color: var(--border);
  font-size: var(--text-xs);
  user-select: none;
}

.nav-item {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--muted);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: transparent;
  padding: 2px 6px;
  border-radius: 0;
  transition:
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out),
    text-decoration-color var(--dur-fast) var(--ease-out);
}
.nav-item:hover {
  background: var(--accent);
  color: var(--on-accent);
}
.nav-item.active {
  color: var(--text);
  text-decoration-color: var(--accent);
}
.nav-item.active:hover {
  color: var(--on-accent);
  text-decoration-color: transparent;
}
/* flows is the product — tier 1 presence */
.nav-primary {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text);
}

.manage-wrap {
  position: relative;
}
.manage-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--muted);
  padding: 2px 6px;
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.manage-btn:hover {
  background: var(--accent);
  color: var(--on-accent);
}
.manage-btn.active {
  color: var(--text);
}
.manage-btn.active:hover {
  color: var(--on-accent);
}
.manage-caret {
  font-size: 0.5625rem;
  opacity: 0.7;
}

.manage-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 120;
  min-width: 180px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
  padding: var(--space-1);
  display: flex;
  flex-direction: column;
  animation: popover-in var(--dur) var(--ease-out);
}
.manage-item {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--muted);
  text-decoration: none;
  padding: 6px var(--space-3);
  transition:
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.manage-item:hover {
  background: var(--surface);
  color: var(--text);
}
.manage-item.active {
  color: var(--text);
  background: var(--surface);
}

.route {
  display: flex;
  align-items: center;
}
.route-wrap {
  position: relative;
}
.route-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: 0;
  background: var(--surface);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.route-chip:hover {
  border-color: var(--accent);
  color: var(--text);
}
.route-chip.pin {
  background: var(--warning);
  border-color: var(--warning);
  color: var(--bg);
}
.route-chip.pin:hover {
  color: var(--bg);
}

.route-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 120;
  width: 260px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  animation: popover-in var(--dur) var(--ease-out);
}
.popover-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.popover-field :global(.hive-select-trigger) {
  width: 100%;
}
.popover-label {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.popover-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-1);
  border-top: 1px solid var(--border);
}
.popover-hint {
  font-size: 0.5625rem;
  color: var(--muted);
  line-height: 1.4;
}
.popover-footer {
  border-top: 1px solid var(--border);
  padding-top: var(--space-2);
}

@keyframes popover-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
