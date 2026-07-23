<script lang="ts">
import type { PresetsConfig } from "shared/dashboard-types";
import Modal from "../shared/Modal.svelte";
import { dashboardSocket } from "./dashboard-socket.svelte";

let {
  open = $bindable(false),
}: {
  open?: boolean;
} = $props();

type EditableList = { items: string[]; newValue: string };
let modelList = $state<EditableList>({ items: [], newValue: "" });
let providerList = $state<EditableList>({ items: [], newValue: "" });
let providerEnabled = $state(false);
let initialized = $state(false);

$effect(() => {
  if (open && !initialized) {
    const config = dashboardSocket.presetsConfig;
    modelList = {
      items: config?.modelPriority ? [...config.modelPriority] : [],
      newValue: "",
    };
    providerList = {
      items: config?.providerPriority ? [...config.providerPriority] : [],
      newValue: "",
    };
    providerEnabled = config?.providerPriority !== undefined;
    initialized = true;
  }
  if (!open) {
    initialized = false;
  }
});

function addItem(list: EditableList) {
  const val = list.newValue.trim();
  if (val) {
    list.items = [...list.items, val];
    list.newValue = "";
  }
}

function removeItem(list: EditableList, index: number) {
  list.items = list.items.filter((_, i) => i !== index);
}

function moveItem(list: EditableList, index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= list.items.length) return;
  const items = [...list.items];
  [items[index], items[target]] = [items[target], items[index]];
  list.items = items;
}

function save() {
  const config: PresetsConfig = {
    modelPriority: modelList.items,
    providerPriority: providerEnabled ? providerList.items : undefined,
  };
  dashboardSocket.updatePresets(config);
  open = false;
}

function cancel() {
  open = false;
}

function handleModelKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") addItem(modelList);
}

function handleProviderKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") addItem(providerList);
}
</script>

<Modal bind:open title="Routing Presets">
  <div class="presets-body">
    <div class="list-section">
      <div class="section-label">Model Priority</div>
      <div class="list-items">
        {#each modelList.items as item, i}
          <div class="list-row">
            <span class="item-text">{item}</span>
            <div class="row-actions">
              <button
                type="button"
                class="icon-btn"
                disabled={i === 0}
                onclick={() => moveItem(modelList, i, -1)}
              >
                &uarr;
              </button>
              <button
                type="button"
                class="icon-btn"
                disabled={i === modelList.items.length - 1}
                onclick={() => moveItem(modelList, i, 1)}
              >
                &darr;
              </button>
              <button
                type="button"
                class="icon-btn remove"
                onclick={() => removeItem(modelList, i)}
              >
                &times;
              </button>
            </div>
          </div>
        {/each}
      </div>
      <div class="add-row">
        <input
          type="text"
          class="add-input"
          placeholder="Add model..."
          bind:value={modelList.newValue}
          onkeydown={handleModelKeydown}
        >
        <button
          type="button"
          class="add-btn"
          onclick={() => addItem(modelList)}
        >
          +
        </button>
      </div>
    </div>

    <div class="list-section">
      <label class="section-label">
        <input type="checkbox" bind:checked={providerEnabled}>
        Provider Priority
      </label>
      {#if providerEnabled}
        <div class="list-items">
          {#each providerList.items as item, i}
            <div class="list-row">
              <span class="item-text">{item}</span>
              <div class="row-actions">
                <button
                  type="button"
                  class="icon-btn"
                  disabled={i === 0}
                  onclick={() => moveItem(providerList, i, -1)}
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  disabled={i === providerList.items.length - 1}
                  onclick={() => moveItem(providerList, i, 1)}
                >
                  &darr;
                </button>
                <button
                  type="button"
                  class="icon-btn remove"
                  onclick={() => removeItem(providerList, i)}
                >
                  &times;
                </button>
              </div>
            </div>
          {/each}
        </div>
        <div class="add-row">
          <input
            type="text"
            class="add-input"
            placeholder="Add provider..."
            bind:value={providerList.newValue}
            onkeydown={handleProviderKeydown}
          >
          <button
            type="button"
            class="add-btn"
            onclick={() => addItem(providerList)}
          >
            +
          </button>
        </div>
      {/if}
    </div>

    <div class="modal-actions">
      <button type="button" class="cancel-btn" onclick={cancel}>Cancel</button>
      <button
        type="button"
        class="save-btn"
        onclick={save}
        disabled={modelList.items.length === 0}
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
  max-height: 160px;
  overflow-y: auto;
}
.list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: monospace;
  font-size: 0.6875rem;
}
.item-text {
  color: var(--accent);
}
.row-actions {
  display: flex;
  gap: 1px;
}
.add-row {
  display: flex;
  gap: 0.25rem;
}
.add-input {
  flex: 1;
  font-family: monospace;
  font-size: 0.625rem;
  padding: 0.25rem 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
.add-input:focus {
  border-color: var(--accent);
  outline: none;
}
.add-input::placeholder {
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
.add-btn {
  font-family: monospace;
  font-size: 0.625rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}
.add-btn:hover {
  background: var(--accent);
  color: var(--bg);
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
</style>
