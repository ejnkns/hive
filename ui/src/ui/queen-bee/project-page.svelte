<script lang="ts">
import { onMount } from "svelte";
import DeviseChat from "./devise-chat.svelte";
import KanbanBoard from "./kanban-board.svelte";

let { projectId }: Props = $props();

type Props = {
  projectId: string;
};

let hasRequirements = $state<boolean | null>(null);
let hasBoard = $state<boolean | null>(null);
let loading = $state(true);
let amending = $state(false);
let requirementsContent = $state("");
let overviewText = $state("");

onMount(() => {
  checkStatus();
});

async function checkStatus() {
  loading = true;
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/devise/status`);
    if (!res.ok) throw new Error("Failed to load project");
    const data = (await res.json()) as { hasRequirements: boolean };
    hasRequirements = data.hasRequirements;

    if (data.hasRequirements) {
      fetchRequirements();
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
    hasRequirements = null;
  } finally {
    loading = false;
  }
}

async function fetchRequirements() {
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/requirements`);
    if (res.ok) {
      const data = (await res.json()) as { content: string };
      requirementsContent = data.content;
      overviewText = extractOverview(data.content);
    }
  } catch {
    // ignore
  }
}

function extractOverview(content: string): string {
  const match = content.match(/## Overview\s*\n([\s\S]*?)(?=\n## |$)/);
  return match ? match[1].trim() : content.slice(0, 300);
}
</script>

<div class="project-page">
  <div class="header">
    <a href="#/" class="back-link">&larr; Projects</a>
    <span class="project-id">{projectId}</span>
  </div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if amending}
    <DeviseChat
      {projectId}
      onComplete={() => {
        amending = false;
        checkStatus();
      }}
    />
  {:else if hasBoard}
    <KanbanBoard {projectId} onAmend={() => (amending = true)} />
  {:else if hasRequirements === true}
    <div class="requirements-card">
      <div class="card-header">
        <h2>Requirements</h2>
      </div>
      <div class="overview-preview">
        {overviewText}
      </div>
      <div class="card-footer">
        <div class="footer-text">Review the requirements, then generate cards to start implementing.</div>
        <div class="footer-actions">
          <button
            class="btn btn-primary"
            onclick={async () => {
              await fetch(`/api/queen-bee/${projectId}/plan`, {
                method: "POST",
              });
              checkStatus();
            }}
          >
            Generate Cards
          </button>
        </div>
      </div>
    </div>
  {:else if hasRequirements === false}
    <DeviseChat {projectId} onComplete={() => checkStatus()} />
  {:else}
    <div class="loading">Could not load project.</div>
  {/if}
</div>

<style>
  .project-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  .back-link {
    font-size: 0.8125rem;
    color: var(--muted);
    text-decoration: none;
  }

  .back-link:hover {
    color: var(--text);
  }

  .project-id {
    font-size: 0.75rem;
    color: var(--muted);
    font-family: var(--font-mono, monospace);
  }

  .loading {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .requirements-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  .card-header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .overview-preview {
    padding: 1rem;
    font-size: 0.8125rem;
    color: var(--text);
    line-height: 1.55;
    max-height: 120px;
    overflow: hidden;
    white-space: pre-wrap;
    mask-image: linear-gradient(to bottom, black 50%, transparent);
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
  }

  .footer-text {
    font-size: 0.6875rem;
    color: var(--muted);
  }

  .footer-actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    background: var(--surface);
    color: var(--text);
  }

  .btn:hover {
    background: var(--border);
  }

  .btn-primary {
    background: var(--accent);
    color: #1b1601;
    border-color: var(--accent);
  }
</style>
