<script lang="ts">
import { isRecord } from "shared/board-types";
import type { ProjectIntegrationStatus } from "shared/project-types";
import { onMount } from "svelte";
import { jellyDisabled } from "../shared/jelly-disabled.svelte";
import { projectSocket } from "./project-socket.svelte";

let { projectId }: { projectId: string } = $props();

let status = $state<ProjectIntegrationStatus | null>(null);
let loading = $state(true);
let integrating = $state(false);
let error = $state<string | null>(null);

async function loadStatus() {
  try {
    const response = await fetch(`/api/queen-bee/${projectId}/integration`);
    const result = await readIntegrationResponse(
      response,
      "Integration status failed"
    );
    status = result;
    error = null;
  } catch (cause) {
    error =
      cause instanceof Error ? cause.message : "Integration status failed";
  } finally {
    loading = false;
  }
}

async function integrate() {
  integrating = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/integration/integrate`,
      { method: "POST" }
    );
    const result = await readIntegrationResponse(
      response,
      "Integration failed"
    );
    status = result;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Integration failed";
  } finally {
    integrating = false;
  }
}

onMount(() => {
  void loadStatus();

  function refreshOnFocus() {
    void loadStatus();
  }
  window.addEventListener("focus", refreshOnFocus);
  return () => window.removeEventListener("focus", refreshOnFocus);
});

$effect(() => {
  projectSocket.boardVersion;
  void loadStatus();
});

async function readIntegrationResponse(
  response: Response,
  fallbackError: string
): Promise<ProjectIntegrationStatus> {
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(readError(result) ?? fallbackError);
  }
  if (!isIntegrationStatus(result)) {
    throw new Error("Hive returned an invalid integration status");
  }
  return result;
}

function isIntegrationStatus(
  value: unknown
): value is ProjectIntegrationStatus {
  if (!isRecord(value)) return false;
  return (
    value.branchName === "hive-main" &&
    typeof value.revision === "string" &&
    typeof value.targetBranch === "string" &&
    typeof value.targetRevision === "string" &&
    (value.state === "integrated" ||
      value.state === "ready" ||
      value.state === "diverged") &&
    typeof value.ahead === "number" &&
    typeof value.behind === "number" &&
    typeof value.canIntegrate === "boolean"
  );
}

function readError(value: unknown): string | null {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : null;
}
</script>

<div class="integration" aria-live="polite">
  {#if loading}
    <span class="status muted">Checking integration...</span>
  {:else if error}
    <span class="status error" title={error}>Integration needs attention</span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <jelly-button size="small" variant="platinum" onclick={loadStatus}>
      Retry
    </jelly-button>
  {:else if status?.state === "ready"}
    <span class="status ready">
      {status.ahead} {status.ahead === 1 ? "commit" : "commits"} ready
    </span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <jelly-button
      size="small"
      variant="mint"
      onclick={integrate}
      use:jellyDisabled={integrating}
    >
      {integrating ? "Integrating..." : `Integrate into ${status.targetBranch}`}
    </jelly-button>
  {:else if status?.state === "diverged"}
    <span
      class="status error"
      title={`${status.targetBranch} and hive-main require explicit reconciliation`}
      >Branches diverged</span
    >
  {:else if status}
    <span class="status integrated">{status.targetBranch} is up to date</span>
  {/if}
</div>

<style>
.integration {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status {
  font-size: 0.6875rem;
  white-space: nowrap;
}

.muted {
  color: var(--muted);
}

.ready {
  color: #d69e2e;
}

.integrated {
  color: #38a169;
}

.error {
  color: #dc3c3c;
}
</style>
