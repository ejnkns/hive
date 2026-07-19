<script lang="ts">
let { projectId }: Props = $props();

type Props = { projectId: string };

let value = $state(3);
let loaded = $state(false);
let saving = $state(false);
let message = $state<string | null>(null);

$effect(() => {
  if (!loaded) void load();
});

async function load() {
  try {
    const response = await fetch("/api/queen-bee/projects");
    const payload: unknown = await response.json();
    if (
      !response.ok ||
      !isRecord(payload) ||
      !Array.isArray(payload.projects)
    ) {
      return;
    }
    const project = payload.projects.find(
      (candidate) => isRecord(candidate) && candidate.id === projectId
    );
    if (isRecord(project) && typeof project.maxConcurrentWorkers === "number") {
      value = project.maxConcurrentWorkers;
    }
  } finally {
    loaded = true;
  }
}

async function save() {
  saving = true;
  message = null;
  try {
    const response = await fetch(
      `/api/queen-bee/projects/${projectId}/config`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrentWorkers: value }),
      }
    );
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "Could not save Worker limit"
      );
    }
    message = "Saved";
  } catch (error) {
    message = error instanceof Error ? error.message : "Could not save";
  } finally {
    saving = false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
</script>

<div class="worker-settings" title="Maximum Worker Agents running for this project">
  <label for="worker-limit">Parallel workers</label>
  <input
    id="worker-limit"
    type="number"
    min="1"
    max="16"
    step="1"
    bind:value
    disabled={!loaded || saving}
  />
  <button onclick={save} disabled={!loaded || saving}>{saving ? "Saving…" : "Save"}</button>
  {#if message}<span>{message}</span>{/if}
</div>

<style>
  .worker-settings {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--muted);
    font-size: 0.6875rem;
  }

  input {
    width: 3.25rem;
    padding: 0.3rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: var(--text);
  }

  button {
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  button:disabled,
  input:disabled {
    opacity: 0.5;
  }
</style>
