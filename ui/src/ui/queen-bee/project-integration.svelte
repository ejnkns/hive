<script lang="ts">
import { onMount } from "svelte";
import type { ProjectIntegrationStatus } from "shared/project-types";

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
  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/api/queen-bee/ws`
  );
  socket.onmessage = (event) => {
    try {
      const message: unknown = JSON.parse(String(event.data));
      if (isProjectBoardUpdate(message, projectId)) {
        void loadStatus();
      }
    } catch {
      // Ignore malformed events.
    }
  };
  function refreshOnFocus() {
    void loadStatus();
  }
  window.addEventListener("focus", refreshOnFocus);
  return () => {
    socket.close();
    window.removeEventListener("focus", refreshOnFocus);
  };
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

function isProjectBoardUpdate(value: unknown, project: string): boolean {
  if (!isRecord(value) || value.type !== "board_updated") return false;
  return isRecord(value.data) && value.data.projectId === project;
}

function readError(value: unknown): string | null {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
</script>

<div class="integration" aria-live="polite">
  {#if loading}
    <span class="status muted">Checking integration...</span>
  {:else if error}
    <span class="status error" title={error}>Integration needs attention</span>
    <button class="btn btn-outline" onclick={loadStatus}>Retry</button>
  {:else if status?.state === "ready"}
    <span class="status ready">
      {status.ahead} {status.ahead === 1 ? "commit" : "commits"} ready
    </span>
    <button class="btn btn-primary" onclick={integrate} disabled={integrating}>
      {integrating ? "Integrating..." : `Integrate into ${status.targetBranch}`}
    </button>
  {:else if status?.state === "diverged"}
    <span
      class="status error"
      title={`${status.targetBranch} and hive-main require explicit reconciliation`}
    >Branches diverged</span>
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

  .btn {
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    font: inherit;
    font-size: 0.6875rem;
    cursor: pointer;
  }

  .btn:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .btn-outline {
    background: transparent;
    color: var(--text);
  }

  .btn-primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg);
  }
</style>
