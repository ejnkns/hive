<script lang="ts">
import { isRecord } from "shared/board-types";
import {
  DEFAULT_MAX_CONCURRENT_WORKERS,
  MAX_MAX_CONCURRENT_WORKERS,
  MIN_MAX_CONCURRENT_WORKERS,
} from "shared/project-types";
import { jellyDisabled } from "../shared/jelly-disabled.svelte";

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
>
  <label for="worker-limit">Parallel workers</label>
  <jelly-input
    id="worker-limit"
    size="small"
    type="number"
    min={MIN_MAX_CONCURRENT_WORKERS}
    max={MAX_MAX_CONCURRENT_WORKERS}
    step="1"
    value={maxConcurrentWorkers}
    oninput={(e: Event) => {
      const v = (e.target as HTMLInputElement).valueAsNumber;
      maxConcurrentWorkers = Number.isNaN(v) ? maxConcurrentWorkers : v;
      saveError = null;
    }}
    use:jellyDisabled={loading || saving || Boolean(loadError)}
  ></jelly-input>
  <span
    class:error-state={Boolean(loadError || saveError)}
    class="status"
    aria-live="polite"
  >
    {STATUS_TEXT[viewState()]}
  </span>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <jelly-button
    size="small"
    variant="platinum"
    onclick={performPrimaryAction}
    use:jellyDisabled={!canRunPrimaryAction()}
  >
    {BUTTON_TEXT[viewState()]}
  </jelly-button>
</div>

<style>
.worker-settings {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--muted);
  font-size: 0.6875rem;
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
</style>
