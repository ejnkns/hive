<script lang="ts">
import { onMount } from "svelte";
import DeviseChat from "./devise-chat.svelte";
import KanbanBoard from "./kanban-board.svelte";
import { projectHeader } from "./project-header-state.svelte";

let { projectId }: Props = $props();

type Props = {
  projectId: string;
};

let hasBoard = $state<boolean | null>(null);
let loading = $state(true);
let planning = $state(false);
let errorMessage = $state<string | null>(null);
let initialMessages = $state<{ role: string; content: string }[] | undefined>(
  undefined
);
let initialStatus = $state<string | undefined>(undefined);

onMount(() => {
  projectHeader.projectId = projectId;
  checkStatus();
});

async function restoreSession() {
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/devise/session`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      active?: boolean;
      status?: string;
      messages?: { role: string; content: string }[];
    };
    if (data.active && data.messages && data.messages.length > 0) {
      initialMessages = data.messages;
      initialStatus = data.status;
    }
  } catch {
    // session restore is best-effort
  }
}

async function checkStatus() {
  loading = true;
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/devise/status`);
    if (!res.ok) throw new Error("Failed to load project");
    const data = (await res.json()) as { hasRequirements: boolean };

    if (data.hasRequirements) {
      await fetchRequirements();
      await restoreSession();
      try {
        const boardRes = await fetch(`/api/queen-bee/${projectId}/board`);
        if (boardRes.ok) {
          const boardData = (await boardRes.json()) as { cards: unknown[] };
          hasBoard =
            Array.isArray(boardData.cards) && boardData.cards.length > 0;
        }
      } catch {
        hasBoard = false;
      }
    }
  } catch {
    hasBoard = null;
  } finally {
    loading = false;
  }
}

async function fetchRequirements() {
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/requirements`);
    if (res.ok) {
      const data = (await res.json()) as { content: string };
      projectHeader.requirementsContent = data.content;
    }
  } catch {
    // ignore
  }
}

async function handleApprove() {
  planning = true;
  errorMessage = null;
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/plan`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Planning failed");
    }
    await checkStatus();
  } catch (err) {
    errorMessage =
      err instanceof Error ? err.message : "Unknown error planning";
  } finally {
    planning = false;
  }
}
</script>

<div class="project-page">
  <div class="main-content">
    {#if loading}
      <div class="loading">Loading...</div>
    {:else if planning}
      <div class="planning">
        <div class="planning-text">Generating cards...</div>
        <div class="planning-hint">Exploring codebase and planning features from requirements</div>
      </div>
    {:else if errorMessage}
      <div class="error">{errorMessage}</div>
      <div class="error-actions">
        <button class="btn btn-primary" onclick={handleApprove}>Retry</button>
      </div>
    {:else if hasBoard}
      <KanbanBoard
        {projectId}
        onReDeviseStarted={() => {
          hasBoard = false;
          void restoreSession();
        }}
      />
    {:else}
      <DeviseChat
        {projectId}
        initialMessages={initialMessages}
        initialStatus={initialStatus}
        onApprove={handleApprove}
        onComplete={() => {
          fetchRequirements();
        }}
      />
    {/if}
  </div>
</div>

<style>
  .project-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
  }

  .loading {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .planning {
    text-align: center;
    padding: 3rem 1rem;
  }

  .planning-text {
    font-size: 0.9375rem;
    color: var(--text);
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .planning-hint {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .error {
    background: rgba(220, 60, 60, 0.1);
    border: 1px solid rgba(220, 60, 60, 0.3);
    color: #dc3c3c;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.8125rem;
    margin-bottom: 1rem;
  }

  .error-actions {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .btn {
    padding: 0.375rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 0.6875rem;
    font-weight: 500;
    cursor: pointer;
    background: var(--surface);
    color: var(--text);
    white-space: nowrap;
  }

  .btn:hover:not(:disabled) {
    background: var(--border);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-primary {
    background: var(--accent);
    color: #1b1601;
    border-color: var(--accent);
  }
</style>
