<script lang="ts">
import type { PresetsConfig } from "shared/dashboard-types";
import Modal from "../shared/Modal.svelte";
import { dashboardSocket } from "./dashboard-socket.svelte";

let {
  open = $bindable(false),
}: {
  open?: boolean;
} = $props();

const allModels = $derived(
  [
    ...new Set(
      dashboardSocket.availableProviders
        .filter((p) => p.keyConfigured)
        .flatMap((p) => p.models)
    ),
  ].sort()
);

const modelProviders = $derived(
  new Map(
    allModels.map((modelId) => [
      modelId,
      dashboardSocket.availableProviders
        .filter((p) => p.keyConfigured && p.models.includes(modelId))
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
let modelInputEl = $state<HTMLInputElement>();
let providerSearch = $state("");
let providerDropdownOpen = $state(false);
let providerInputEl = $state<HTMLInputElement>();

const filteredModels = $derived(
  modelSearch.trim()
    ? allModels.filter((m) =>
        m.toLowerCase().includes(modelSearch.toLowerCase())
      )
    : allModels.slice(0, 20)
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
    const config = dashboardSocket.presetsConfig;
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
  return allModels.includes(id);
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
  modelInputEl?.focus();
}

function addProvider(name: string) {
  if (name && !providerItems.includes(name)) {
    providerItems = [...providerItems, name];
  }
  providerSearch = "";
  providerDropdownOpen = false;
  providerInputEl?.focus();
}

function handleModelKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    modelDropdownOpen = false;
    return;
  }
  if (e.key === "ArrowDown" && filteredModels.length > 0) {
    e.preventDefault();
    modelDropdownOpen = true;
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (filteredModels.length > 0 && modelDropdownOpen) {
      addModel(filteredModels[0]);
    } else if (modelSearch.trim()) {
      addModel(modelSearch.trim());
    }
  }
}

function handleProviderKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    providerDropdownOpen = false;
    return;
  }
  if (e.key === "ArrowDown" && filteredProviders.length > 0) {
    e.preventDefault();
    providerDropdownOpen = true;
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (filteredProviders.length > 0 && providerDropdownOpen) {
      addProvider(filteredProviders[0]);
    } else if (providerSearch.trim()) {
      addProvider(providerSearch.trim());
    }
  }
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
  const config: PresetsConfig = {
    modelPriority: modelItems,
    providerPriority: providerEnabled ? providerItems : undefined,
  };
  dashboardSocket.updatePresets(config);
  open = false;
}

function cancel() {
  open = false;
}

function closeModelDropdown() {
  setTimeout(() => {
    modelDropdownOpen = false;
  }, 150);
}

function closeProviderDropdown() {
  setTimeout(() => {
    providerDropdownOpen = false;
  }, 150);
}
</script>

<Modal bind:open title="Routing Presets">
  <div class="presets-body">
    {#if !dataLoaded && dashboardSocket.connected}
      <div class="loading">Loading available models...</div>
    {:else}
      <div class="list-section">
        <div class="section-label">Model Priority</div>
        <div class="list-items">
          {#each modelItems as item, i}
            <div class="list-row" class:invalid={!isValidModel(item)}>
              <span class="item-text">{item}</span>
              <div class="item-badges">
                {#each modelProviderBadges(item) as provider}
                  <span class="badge">{provider}</span>
                {/each}
                {#if modelProviderBadges(item).length === 0 && dataLoaded}
                  <span class="badge unknown">unknown</span>
                {/if}
              </div>
              <div class="row-actions">
                <button
                  type="button"
                  class="icon-btn"
                  disabled={i === 0}
                  onclick={() => moveModel(i, -1)}
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  disabled={i === modelItems.length - 1}
                  onclick={() => moveModel(i, 1)}
                >
                  &darr;
                </button>
                <button
                  type="button"
                  class="icon-btn remove"
                  onclick={() => removeModel(i)}
                >
                  &times;
                </button>
              </div>
            </div>
          {/each}
        </div>
        <div class="search-row">
          <div class="search-wrap">
            <input
              type="text"
              class="search-input"
              placeholder="Search model..."
              bind:value={modelSearch}
              bind:this={modelInputEl}
              onfocus={() => (modelDropdownOpen = true)}
              onblur={closeModelDropdown}
              onkeydown={handleModelKeydown}
              oninput={() => (modelDropdownOpen = true)}
            >
            {#if modelDropdownOpen && filteredModels.length > 0}
              <div class="dropdown">
                {#each filteredModels as suggestion}
                  <button
                    type="button"
                    class="dropdown-item"
                    onmousedown={(e) => e.preventDefault()}
                    onclick={() => addModel(suggestion)}
                  >
                    <span class="dropdown-item-name">{suggestion}</span>
                    <span class="dropdown-item-providers">
                      {modelProviders.get(suggestion)?.join(", ") ?? ""}
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="list-section">
        <label class="section-label">
          <input type="checkbox" bind:checked={providerEnabled}>
          Provider Priority
        </label>
        {#if providerEnabled}
          <div class="list-items">
            {#each providerItems as item, i}
              <div class="list-row" class:invalid={!isValidProvider(item)}>
                <span class="item-text">{item}</span>
                {#if !isValidProvider(item) && dataLoaded}
                  <span class="badge unknown">unknown</span>
                {/if}
                <div class="row-actions">
                  <button
                    type="button"
                    class="icon-btn"
                    disabled={i === 0}
                    onclick={() => moveProvider(i, -1)}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    disabled={i === providerItems.length - 1}
                    onclick={() => moveProvider(i, 1)}
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    class="icon-btn remove"
                    onclick={() => removeProvider(i)}
                  >
                    &times;
                  </button>
                </div>
              </div>
            {/each}
          </div>
          <div class="search-row">
            <div class="search-wrap">
              <input
                type="text"
                class="search-input"
                placeholder="Search provider..."
                bind:value={providerSearch}
                bind:this={providerInputEl}
                onfocus={() => (providerDropdownOpen = true)}
                onblur={closeProviderDropdown}
                onkeydown={handleProviderKeydown}
                oninput={() => (providerDropdownOpen = true)}
              >
              {#if providerDropdownOpen && filteredProviders.length > 0}
                <div class="dropdown">
                  {#each filteredProviders as suggestion}
                    <button
                      type="button"
                      class="dropdown-item"
                      onmousedown={(e) => e.preventDefault()}
                      onclick={() => addProvider(suggestion)}
                    >
                      <span class="dropdown-item-name">{suggestion}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <div class="modal-actions">
      <button type="button" class="cancel-btn" onclick={cancel}>Cancel</button>
      <button
        type="button"
        class="save-btn"
        onclick={save}
        disabled={modelItems.length === 0}
      >
        Save
      </button>
    </div>
  </div>
</Modal>

<style>
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
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.section-label input[type="checkbox"] {
  width: auto;
}
.list-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 140px;
  overflow-y: auto;
}
.list-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: monospace;
  font-size: 0.6875rem;
}
.list-row.invalid {
  border-color: var(--error);
}
.item-text {
  color: var(--accent);
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
.search-row {
  display: flex;
  gap: 0.25rem;
}
.search-wrap {
  position: relative;
  flex: 1;
}
.search-input {
  width: 100%;
  box-sizing: border-box;
  font-family: monospace;
  font-size: 0.625rem;
  padding: 0.25rem 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
.search-input:focus {
  border-color: var(--accent);
  outline: none;
}
.search-input::placeholder {
  color: var(--muted);
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
  z-index: 110;
}
.dropdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0.25rem 0.375rem;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-family: monospace;
  font-size: 0.625rem;
  cursor: pointer;
  text-align: left;
}
.dropdown-item:last-child {
  border-bottom: none;
}
.dropdown-item:hover {
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--accent);
}
.dropdown-item-name {
  color: var(--accent);
}
.dropdown-item-providers {
  font-size: 0.5rem;
  color: var(--muted);
}
.icon-btn {
  font-family: inherit;
  font-size: 0.5625rem;
  padding: 0 0.25rem;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  line-height: 1.2;
}
.icon-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.icon-btn:disabled {
  opacity: 0.25;
  cursor: default;
}
.icon-btn.remove:hover:not(:disabled) {
  border-color: var(--error);
  color: var(--error);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
}
.cancel-btn,
.save-btn {
  font-family: inherit;
  font-size: 0.625rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  text-transform: uppercase;
}
.cancel-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.save-btn {
  border-color: var(--accent);
  color: var(--accent);
}
.save-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg);
}
.save-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.loading {
  font-size: 0.6875rem;
  color: var(--muted);
  padding: 0.5rem 0;
  text-align: center;
}
</style>
