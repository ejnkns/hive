<script lang="ts">
import {
  DEFAULT_MAX_CONCURRENT_WORKERS,
  MAX_MAX_CONCURRENT_WORKERS,
  MIN_MAX_CONCURRENT_WORKERS,
} from "shared/project-types";
import { isRecord } from "../check-record";

let { projectId }: Props = $props();

type Props = { projectId: string };

type WorkerLimitViewState =
  | "loading"
  | "load_error"
  | "saving"
  | "save_error"
  | "invalid"
  | "dirty"
  | "saved";

const STATUS_TEXT: Record<WorkerLimitViewState, string> = {
  loading: "Loading",
  load_error: "Load failed",
  saving: "Saving",
  save_error: "Save failed",
  invalid: `${MIN_MAX_CONCURRENT_WORKERS}–${MAX_MAX_CONCURRENT_WORKERS} only`,
  dirty: "Unsaved",
  saved: "Up to date",
};

const BUTTON_TEXT: Record<WorkerLimitViewState, string> = {
  loading: "Loading…",
  load_error: "Retry",
  saving: "Saving…",
  save_error: "Retry",
  invalid: "Save",
  dirty: "Save",
  saved: "Saved",
};

let maxConcurrentWorkers = $state(DEFAULT_MAX_CONCURRENT_WORKERS);
let persistedMaxConcurrentWorkers = $state<number | null>(null);
let loading = $state(true);
let saving = $state(false);
let loadError = $state<string | null>(null);
let saveError = $state<string | null>(null);

$effect(() => {
  void loadWorkerLimit();
});

async function loadWorkerLimit() {
  loading = true;
  loadError = null;
  try {
    const response = await fetch("/api/queen-bee/projects");
    const payload: unknown = await response.json();
    if (
      !response.ok ||
      !isRecord(payload) ||
      !Array.isArray(payload.projects)
    ) {
      throw new Error("Could not load Worker limit");
    }
    const project = payload.projects.find(
      (candidate) => isRecord(candidate) && candidate.id === projectId
    );
    if (isRecord(project) && typeof project.maxConcurrentWorkers === "number") {
      maxConcurrentWorkers = project.maxConcurrentWorkers;
      persistedMaxConcurrentWorkers = project.maxConcurrentWorkers;
      return;
    }
    throw new Error("Project Worker limit is missing");
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Could not load Worker limit";
  } finally {
    loading = false;
  }
}

async function saveWorkerLimit() {
  if (!hasValidValue() || !hasUnsavedChanges()) return;
  saving = true;
  saveError = null;
  try {
    const response = await fetch(
      `/api/queen-bee/projects/${projectId}/config`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrentWorkers }),
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
    persistedMaxConcurrentWorkers = maxConcurrentWorkers;
  } catch (error) {
    saveError = error instanceof Error ? error.message : "Could not save";
  } finally {
    saving = false;
  }
}

function performPrimaryAction() {
  if (loadError) {
    void loadWorkerLimit();
    return;
  }
  void saveWorkerLimit();
}

function hasUnsavedChanges(): boolean {
  return (
    persistedMaxConcurrentWorkers !== null &&
    maxConcurrentWorkers !== persistedMaxConcurrentWorkers
  );
}

function hasValidValue(): boolean {
  return (
    Number.isInteger(maxConcurrentWorkers) &&
    maxConcurrentWorkers >= MIN_MAX_CONCURRENT_WORKERS &&
    maxConcurrentWorkers <= MAX_MAX_CONCURRENT_WORKERS
  );
}

function viewState(): WorkerLimitViewState {
  if (loading) return "loading";
  if (loadError) return "load_error";
  if (saving) return "saving";
  if (saveError) return "save_error";
  if (!hasValidValue()) return "invalid";
  return hasUnsavedChanges() ? "dirty" : "saved";
}

function canRunPrimaryAction(): boolean {
  const state = viewState();
  return state === "load_error" || state === "save_error" || state === "dirty";
}
</script>

<div
  class="worker-settings"
  title={loadError ?? saveError ?? "Maximum Worker Agents running for this project"}
  aria-busy={loading || saving}
>
  <label for="worker-limit">Parallel workers</label>
  <input
    id="worker-limit"
    type="number"
    min={MIN_MAX_CONCURRENT_WORKERS}
    max={MAX_MAX_CONCURRENT_WORKERS}
    step="1"
    bind:value={maxConcurrentWorkers}
    oninput={() => (saveError = null)}
    disabled={loading || saving || Boolean(loadError)}
  />
  <span class:error-state={Boolean(loadError || saveError)} class="status" aria-live="polite">
    {STATUS_TEXT[viewState()]}
  </span>
  <button
    onclick={performPrimaryAction}
    disabled={!canRunPrimaryAction()}
  >{BUTTON_TEXT[viewState()]}</button>
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
    width: 4.75rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .status {
    display: inline-block;
    width: 5.25rem;
    text-align: right;
    white-space: nowrap;
  }

  .error-state {
    color: #dc3c3c;
  }

  button:disabled,
  input:disabled {
    opacity: 0.5;
  }
</style>
