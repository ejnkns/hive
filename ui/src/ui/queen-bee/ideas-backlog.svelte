<script lang="ts">
import type {
  Idea,
  PlanningProposal,
  RequirementsFeedback,
} from "shared/board-types";
import { parsePlanningProposalResponse } from "./parse-planning-proposal-response";
import { projectSocket } from "./project-socket.svelte";
import { isRecord } from "../check-record";

let {
  projectId,
  ideas,
  onChanged,
  onPlanningProposal,
  onRequirementsFeedback,
}: Props = $props();

type Props = {
  projectId: string;
  ideas: Idea[];
  onChanged: () => Promise<void>;
  onPlanningProposal?: (proposal: PlanningProposal) => void;
  onRequirementsFeedback?: (feedback: RequirementsFeedback) => void;
};

type IdeaSession = {
  active: boolean;
  status?: "active" | "complete";
  question?: string;
  draftRequirements?: string;
  settled?: boolean;
};

let expanded = $state(true);
let adding = $state(false);
let title = $state("");
let brief = $state("");
let selectedIdeaId = $state<string | null>(null);
let sessions = $state<Record<string, IdeaSession>>({});
let answer = $state("");
let busy = $state(false);
let error = $state<string | null>(null);

$effect(() => {
  for (const idea of ideas) void loadSession(idea.id);
});

$effect(() => {
  const update = projectSocket.draftUpdate;
  if (!update?.ideaId) return;
  if (sessions[update.ideaId]?.settled === true) return;
  sessions = {
    ...sessions,
    [update.ideaId]: {
      ...sessions[update.ideaId],
      active: true,
      status: "active",
      draftRequirements: update.content,
    },
  };
});

async function loadSession(ideaId: string) {
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/ideas/${ideaId}/requirements/session`
    );
    if (!response.ok) return;
    const value = await response.json();
    if (!isRecord(value) || typeof value.active !== "boolean") return;
    sessions = {
      ...sessions,
      [ideaId]: {
        active: value.active,
        status:
          value.status === "active" || value.status === "complete"
            ? value.status
            : undefined,
        question:
          typeof value.question === "string" ? value.question : undefined,
        draftRequirements:
          typeof value.draftRequirements === "string"
            ? value.draftRequirements
            : undefined,
        settled: true,
      },
    };
  } catch {
    // Board reload and explicit retry remain available.
  }
}

async function createIdea(startElaboration: boolean) {
  if (!title.trim() || !brief.trim()) return;
  busy = true;
  error = null;
  try {
    const response = await fetch(`/api/queen-bee/${projectId}/ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), brief: brief.trim() }),
    });
    const value = await response.json();
    if (!response.ok || !isRecord(value) || !isIdea(value.idea)) {
      throw new Error(errorMessage(value, "Could not add Idea"));
    }
    const idea = value.idea;
    title = "";
    brief = "";
    adding = false;
    await onChanged();
    if (startElaboration) {
      selectedIdeaId = idea.id;
      await startSession(idea);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not add Idea";
  } finally {
    busy = false;
  }
}

async function startSession(idea: Idea) {
  sessions = {
    ...sessions,
    [idea.id]: { ...sessions[idea.id], settled: false },
  };
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/ideas/${idea.id}/requirements/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: idea.brief }),
      }
    );
    const value = await response.json();
    if (!response.ok) {
      throw new Error(errorMessage(value, "Could not start elaboration"));
    }
    await loadSession(idea.id);
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : "Could not start elaboration";
  } finally {
    busy = false;
  }
}

async function respond(ideaId: string) {
  const responseText = answer.trim();
  if (!responseText) return;
  sessions = {
    ...sessions,
    [ideaId]: { ...sessions[ideaId], settled: false },
  };
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/ideas/${ideaId}/requirements/respond`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: responseText }),
      }
    );
    const value = await response.json();
    if (!response.ok) {
      throw new Error(errorMessage(value, "Could not continue elaboration"));
    }
    answer = "";
    await loadSession(ideaId);
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : "Could not continue elaboration";
  } finally {
    busy = false;
  }
}

async function approve(ideaId: string) {
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/ideas/${ideaId}/requirements/approve`,
      { method: "POST" }
    );
    const result = parsePlanningProposalResponse(await response.json());
    if (result.feedback) {
      onRequirementsFeedback?.(result.feedback);
      return;
    }
    if (!response.ok || !result.proposal) {
      throw new Error(result.error ?? "Could not plan Idea");
    }
    onPlanningProposal?.(result.proposal);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not plan Idea";
  } finally {
    busy = false;
  }
}

async function archive(ideaId: string) {
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/ideas/${ideaId}/archive`,
      { method: "POST" }
    );
    const value = await response.json();
    if (!response.ok)
      throw new Error(errorMessage(value, "Could not archive Idea"));
    selectedIdeaId = null;
    await onChanged();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not archive Idea";
  } finally {
    busy = false;
  }
}

function statusLabel(ideaId: string): string {
  const session = sessions[ideaId];
  if (!session?.active) return "Unelaborated";
  return session.status === "complete" ? "Draft approval" : "Elaborating";
}

function isIdea(value: unknown): value is Idea {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.brief === "string" &&
    typeof value.createdAt === "string"
  );
}

function errorMessage(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : fallback;
}
</script>

<section class="ideas-backlog">
  <div class="backlog-header">
    <button class="toggle" onclick={() => (expanded = !expanded)}>
      <span>{expanded ? "▾" : "▸"}</span>
      <strong>Ideas</strong>
      <span class="count">{ideas.length}</span>
    </button>
    <button class="btn" onclick={() => (adding = !adding)} disabled={busy}>
      Add Idea
    </button>
  </div>

  {#if expanded}
    {#if adding}
      <div class="composer">
        <input bind:value={title} placeholder="Idea title" disabled={busy} />
        <textarea
          bind:value={brief}
          placeholder="What should this add or change?"
          rows="2"
          disabled={busy}
        ></textarea>
        <div class="actions">
          <button
            class="btn primary"
            onclick={() => createIdea(true)}
            disabled={busy || !title.trim() || !brief.trim()}
          >Start elaboration</button>
          <button
            class="btn"
            onclick={() => createIdea(false)}
            disabled={busy || !title.trim() || !brief.trim()}
          >Save to backlog</button>
          <button class="btn" onclick={() => (adding = false)} disabled={busy}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if error}<div class="error">{error}</div>{/if}

    <div class="idea-list">
      {#each ideas as idea (idea.id)}
        <article class="idea-item">
          <button
            class="idea-summary"
            onclick={() =>
              (selectedIdeaId = selectedIdeaId === idea.id ? null : idea.id)}
          >
            <span class="idea-copy"><strong>{idea.title}</strong><span>{idea.brief}</span></span>
            <span class="status">{statusLabel(idea.id)}</span>
          </button>
          {#if selectedIdeaId === idea.id}
            <div class="idea-detail">
              {#if !sessions[idea.id]?.active}
                <button class="btn primary" onclick={() => startSession(idea)} disabled={busy}>
                  Start elaboration
                </button>
              {:else if sessions[idea.id]?.status === "complete"}
                <div class="question">Requirements Draft is ready for review.</div>
                {#if sessions[idea.id]?.draftRequirements}
                  <details><summary>View Requirements Draft</summary><pre>{sessions[idea.id]?.draftRequirements}</pre></details>
                {/if}
                <button class="btn primary" onclick={() => approve(idea.id)} disabled={busy}>
                  Approve draft and plan Cards
                </button>
              {:else}
                <div class="question">{sessions[idea.id]?.question ?? "Requirements Agent is working…"}</div>
                <textarea bind:value={answer} rows="2" placeholder="Your answer" disabled={busy}></textarea>
                <button class="btn primary" onclick={() => respond(idea.id)} disabled={busy || !answer.trim()}>
                  Continue
                </button>
              {/if}
              <button class="btn danger" onclick={() => archive(idea.id)} disabled={busy}>
                Archive Idea
              </button>
            </div>
          {/if}
        </article>
      {/each}
      {#if ideas.length === 0}<div class="empty">No unresolved Ideas.</div>{/if}
    </div>
  {/if}
</section>

<style>
  .ideas-backlog { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.75rem; background: var(--surface); }
  .backlog-header, .actions { align-items: center; display: flex; gap: 0.375rem; }
  .backlog-header { justify-content: space-between; padding: 0.5rem 0.625rem; }
  .toggle, .idea-summary { background: none; border: 0; color: var(--text); cursor: pointer; }
  .toggle { align-items: center; display: flex; gap: 0.375rem; }
  .count, .status { color: var(--muted); font-size: 0.625rem; }
  .composer, .idea-detail { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.625rem; border-top: 1px solid var(--border); }
  input, textarea { background: var(--bg); border: 1px solid var(--border); border-radius: 5px; color: var(--text); font: inherit; padding: 0.5rem; resize: vertical; }
  .idea-list { display: flex; flex-direction: column; }
  .idea-item { border-top: 1px solid var(--border); }
  .idea-summary { align-items: center; display: flex; justify-content: space-between; padding: 0.625rem; text-align: left; width: 100%; }
  .idea-copy { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
  .idea-copy strong { font-size: 0.75rem; }
  .idea-copy span { color: var(--muted); font-size: 0.6875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .question, summary, pre, .empty, .error { font-size: 0.6875rem; }
  .question, .empty { color: var(--muted); }
  pre { color: var(--text); max-height: 15rem; overflow: auto; white-space: pre-wrap; }
  .empty { padding: 0.75rem; }
  .error { color: #dc3c3c; padding: 0 0.625rem 0.5rem; }
  .btn { background: var(--surface); border: 1px solid var(--border); border-radius: 5px; color: var(--text); cursor: pointer; font-size: 0.6875rem; padding: 0.375rem 0.625rem; white-space: nowrap; }
  .btn:disabled { cursor: default; opacity: 0.5; }
  .primary { background: var(--accent); border-color: var(--accent); color: #1b1601; }
  .danger { color: #dc3c3c; }
</style>
