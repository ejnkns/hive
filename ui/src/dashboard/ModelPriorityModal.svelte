<script lang="ts">
import type { ModelPriority } from "shared/dashboard-types";
import { normalizeModelId } from "shared/model-normalization";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
import Switch from "../shared/ui/Switch.svelte";
import TextInput from "../shared/ui/TextInput.svelte";
import { dashboardSocket } from "./dashboard-socket.svelte";

let {
  open = $bindable(false),
}: {
  open?: boolean;
} = $props();

const canonicalModels = $derived.by(() => {
  const map = new Map<string, string>();
  for (const p of dashboardSocket.availableProviders) {
    if (!p.keyConfigured) continue;
    for (const raw of p.models) {
      const canonical = normalizeModelId(raw);
      const existing = map.get(canonical);
      if (!existing || raw.length < existing.length) {
        map.set(canonical, raw);
      }
    }
  }
  return map;
});

const allCanonicalIds = $derived([...canonicalModels.keys()].sort());

const modelProviders = $derived(
  new Map(
    allCanonicalIds.map((canonical) => [
      canonical,
      dashboardSocket.availableProviders
        .filter(
          (p) =>
            p.keyConfigured &&
            p.models.some((m) => normalizeModelId(m) === canonical)
        )
        .map((p) => p.displayName)
        .sort(),
    ])
  )
);

const allProviderNames = $derived(
  dashboardSocket.availableProviders
    .filter((p) => p.keyConfigured)
    .map((p) => p.name)
    .sort()
);

const dataLoaded = $derived(dashboardSocket.availableProviders.length > 0);

let modelItems = $state<string[]>([]);
let providerItems = $state<string[]>([]);
let providerEnabled = $state(false);
let initialized = $state(false);

let modelSearch = $state("");
let modelDropdownOpen = $state(false);

let providerSearch = $state("");
let providerDropdownOpen = $state(false);

const filteredModels = $derived(
  modelSearch.trim()
    ? allCanonicalIds.filter((m) =>
        m.toLowerCase().includes(modelSearch.toLowerCase())
      )
    : allCanonicalIds.slice(0, 20)
);

const filteredProviders = $derived(
  providerSearch.trim()
    ? allProviderNames.filter((p) =>
        p.toLowerCase().includes(providerSearch.toLowerCase())
      )
    : allProviderNames.slice(0, 20)
);

$effect(() => {
  if (open && !initialized) {
    const config = dashboardSocket.modelPriorityConfig;
    modelItems = config?.modelPriority ? [...config.modelPriority] : [];
    providerItems = config?.providerPriority
      ? [...config.providerPriority]
      : [];
    providerEnabled = config?.providerPriority !== undefined;
    initialized = true;
  }
  if (!open) {
    initialized = false;
    modelSearch = "";
    modelDropdownOpen = false;
    providerSearch = "";
    providerDropdownOpen = false;
  }
});

function isValidModel(id: string): boolean {
  if (!dataLoaded) return true;
  return allCanonicalIds.includes(id);
}

function isValidProvider(name: string): boolean {
  if (!dataLoaded) return true;
  return allProviderNames.includes(name);
}

function modelProviderBadges(modelId: string): string[] {
  return modelProviders.get(modelId) ?? [];
}

function addModel(modelId: string) {
  if (modelId && !modelItems.includes(modelId)) {
    modelItems = [...modelItems, modelId];
  }
  modelSearch = "";
  modelDropdownOpen = false;
}

function addProvider(name: string) {
  if (name && !providerItems.includes(name)) {
    providerItems = [...providerItems, name];
  }
  providerSearch = "";
  providerDropdownOpen = false;
}

function removeModel(index: number) {
  modelItems = modelItems.filter((_, i) => i !== index);
}

function removeProvider(index: number) {
  providerItems = providerItems.filter((_, i) => i !== index);
}

function moveModel(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= modelItems.length) return;
  const items = [...modelItems];
  [items[index], items[target]] = [items[target], items[index]];
  modelItems = items;
}

function moveProvider(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= providerItems.length) return;
  const items = [...providerItems];
  [items[index], items[target]] = [items[target], items[index]];
  providerItems = items;
}

function save() {
  if (modelItems.length === 0) return;
  const config: ModelPriority = {
    modelPriority: modelItems,
    providerPriority: providerEnabled ? providerItems : undefined,
  };
  dashboardSocket.updateModelPriority(config);
  open = false;
}

function cancel() {
  open = false;
}

function handleModelInputFocus() {
  modelDropdownOpen = true;
}

function handleModelInputBlur() {
  setTimeout(() => {
    modelDropdownOpen = false;
  }, 200);
}

function handleProviderInputFocus() {
  providerDropdownOpen = true;
}

function handleProviderInputBlur() {
  setTimeout(() => {
    providerDropdownOpen = false;
  }, 200);
}
</script>

<Dialog bind:open label="model priority" contentMaxWidth="600px">
  <h2 class="dialog-title">model priority</h2>
  <div class="presets-body">
    {#if !dataLoaded && dashboardSocket.connected}
      <div class="loading">loading available models...</div>
    {:else}
      <div class="list-section">
        <div class="list-items">
          {#each modelItems as item, i}
            <div class="list-row" class:invalid={!isValidModel(item)}>
              <div class="list-row-content">
                <span class="item-text">{item}</span>
                <div class="item-badges">
                  {#each modelProviderBadges(item) as provider}
                    <span class="badge">{provider}</span>
                  {/each}
                  {#if modelProviderBadges(item).length === 0 && dataLoaded}
                    <span class="badge unknown">unknown</span>
                  {/if}
                </div>
              </div>
              <div class="row-actions">
                <Button
                  variant="neutral"
                  disabled={i === 0}
                  onclick={() => { if (i > 0) moveModel(i, -1); }}
                >
                  ↑
                </Button>
                <Button
                  variant="neutral"
                  disabled={i === modelItems.length - 1}
                  onclick={() => { if (i < modelItems.length - 1) moveModel(i, 1); }}
                >
                  ↓
                </Button>
                <Button variant="danger" onclick={() => removeModel(i)}>
                  ×
                </Button>
              </div>
            </div>
          {/each}
        </div>
        <div class="search-wrap">
          <TextInput
            bind:value={modelSearch}
            placeholder="Search model..."
            restProps={{
              onfocus: handleModelInputFocus,
              onblur: handleModelInputBlur,
            }}
          />
          {#if modelDropdownOpen && filteredModels.length > 0}
            <div class="dropdown">
              {#each filteredModels as suggestion}
                <Button
                  variant="neutral"
                  block
                  onclick={() => addModel(suggestion)}
                >
                  <div class="dropdown-btn-content">
                    <span>{suggestion}</span>
                    <span class="dropdown-item-providers">
                      {modelProviders.get(suggestion)?.join(", ") ?? ""}
                    </span>
                  </div>
                </Button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="list-section">
        <div class="section-label">
          <Switch
            checked={providerEnabled}
            onCheckedChange={(v) => providerEnabled = v}
            label="Provider Priority"
          />
        </div>
        {#if providerEnabled}
          <div class="list-items">
            {#each providerItems as item, i}
              <div class="list-row" class:invalid={!isValidProvider(item)}>
                <div class="list-row-content">
                  <span class="item-text">{item}</span>
                  {#if !isValidProvider(item) && dataLoaded}
                    <span class="badge unknown">unknown</span>
                  {/if}
                </div>
                <div class="row-actions">
                  <Button
                    variant="neutral"
                    disabled={i === 0}
                    onclick={() => { if (i > 0) moveProvider(i, -1); }}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="neutral"
                    disabled={i === providerItems.length - 1}
                    onclick={() => { if (i < providerItems.length - 1) moveProvider(i, 1); }}
                  >
                    ↓
                  </Button>
                  <Button variant="danger" onclick={() => removeProvider(i)}>
                    ×
                  </Button>
                </div>
              </div>
            {/each}
          </div>
          <div class="search-wrap">
            <TextInput
              bind:value={providerSearch}
              placeholder="Search provider..."
              restProps={{
                onfocus: handleProviderInputFocus,
                onblur: handleProviderInputBlur,
              }}
            />
            {#if providerDropdownOpen && filteredProviders.length > 0}
              <div class="dropdown">
                {#each filteredProviders as suggestion}
                  <Button
                    variant="neutral"
                    block
                    onclick={() => addProvider(suggestion)}
                  >
                    {suggestion}
                  </Button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <div class="modal-actions">
      <Button variant="neutral" onclick={cancel}>cancel</Button>
      <Button
        variant="accent"
        onclick={save}
        disabled={modelItems.length === 0}
      >
        Save
      </Button>
    </div>
  </div>
</Dialog>

<style>
.dialog-title {
  margin: 0 0 0.75rem 0;
  font-size: var(--text-sm);
  font-weight: 700;
}
.presets-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.list-section {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.section-label {
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.list-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}
.list-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  border-radius: 16px;
}
.list-row.invalid {
  border-color: var(--error);
}
.list-row-content {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex: 1;
  min-width: 0;
}
.item-text {
  color: var(--text);
  flex-shrink: 0;
}
.item-badges {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.badge {
  font-size: 0.5rem;
  padding: 0 0.25rem;
  border: 1px solid var(--border);
  color: var(--muted);
  white-space: nowrap;
}
.badge.unknown {
  color: var(--error);
  border-color: var(--error);
}
.row-actions {
  display: flex;
  gap: 1px;
  margin-left: auto;
  flex-shrink: 0;
}
.search-wrap {
  position: relative;
}
.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--accent);
  background: var(--card);
  z-index: 50;
  padding: 2px;
}
.dropdown-btn-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  font-size: var(--text-xs);
}
.dropdown-item-providers {
  font-size: 0.5rem;
  color: var(--muted);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
}
.loading {
  font-size: var(--text-xs);
  color: var(--muted);
  padding: 0.5rem 0;
  text-align: center;
}
</style>
