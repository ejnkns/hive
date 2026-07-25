<script lang="ts">
import type {
  Idea,
  PlanningProposal,
  RequirementsFeedback,
} from "shared/board-types";
import { isRecord } from "shared/board-types";
import Button from "../shared/ui/Button.svelte";
import TextInput from "../shared/ui/TextInput.svelte";
import Textarea from "../shared/ui/Textarea.svelte";
import { parsePlanningProposalResponse } from "./parse-planning-proposal-response";
import { projectSocket } from "./project-socket.svelte";

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
    <Button
      variant="platinum"
      onclick={() => (expanded = !expanded)}
    >
      <span>{expanded ? "▾" : "▸"}</span>
      <strong>Ideas</strong>
      <span class="count">{ideas.length}</span>
    </Button>
    <Button
      variant="platinum"
      onclick={() => (adding = !adding)}
      disabled={busy}
    >
      Add Idea
    </Button>
  </div>

  {#if expanded}
    {#if adding}
      <div class="composer">
        <TextInput
          bind:value={title}
          placeholder="Idea title"
          disabled={busy}
        />
        <Textarea
          bind:value={brief}
          placeholder="What should this add or change?"
          disabled={busy}
          restProps={{ rows: "2" }}
        />
        <div class="actions">
          <Button
            variant="mint"
            onclick={() => createIdea(true)}
            disabled={busy || !title.trim() || !brief.trim()}
          >
            Start elaboration
          </Button>
          <Button
            variant="platinum"
            onclick={() => createIdea(false)}
            disabled={busy || !title.trim() || !brief.trim()}
          >
            Save to backlog
          </Button>
          <Button
            variant="platinum"
            onclick={() => (adding = false)}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </div>
    {/if}

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <div class="idea-list">
      {#each ideas as idea (idea.id)}
        <article class="idea-item">
          <div class="idea-summary">
            <Button
              variant="platinum"
              onclick={() =>
                (selectedIdeaId = selectedIdeaId === idea.id ? null : idea.id)}
              block
            >
              <span class="idea-copy"
                ><strong>{idea.title}</strong><span>{idea.brief}</span></span
              >
              <span class="status">{statusLabel(idea.id)}</span>
            </Button>
          </div>
          {#if selectedIdeaId === idea.id}
            <div class="idea-detail">
              {#if !sessions[idea.id]?.active}
                <Button
                  variant="mint"
                  onclick={() => startSession(idea)}
                  disabled={busy}
                >
                  Start elaboration
                </Button>
              {:else if sessions[idea.id]?.status === "complete"}
                <div class="question">
                  Requirements Draft is ready for review.
                </div>
                {#if sessions[idea.id]?.draftRequirements}
                  <details>
                    <summary>View Requirements Draft</summary>
                    <pre>{sessions[idea.id]?.draftRequirements}</pre>
                  </details>
                {/if}
                <Button
                  variant="mint"
                  onclick={() => approve(idea.id)}
                  disabled={busy}
                >
                  Approve draft and plan Cards
                </Button>
              {:else}
                <div class="question">
                  {sessions[idea.id]?.question ?? "Requirements Agent is working…"}
                </div>
                <Textarea
                  bind:value={answer}
                  placeholder="Your answer"
                  disabled={busy}
                  restProps={{ rows: "2" }}
                />
                <Button
                  variant="mint"
                  onclick={() => respond(idea.id)}
                  disabled={busy || !answer.trim()}
                >
                  Continue
                </Button>
              {/if}
              <Button
                variant="rose"
                onclick={() => archive(idea.id)}
                disabled={busy}
              >
                Archive Idea
              </Button>
            </div>
          {/if}
        </article>
      {/each}
      {#if ideas.length === 0}
        <div class="empty">No unresolved Ideas.</div>
      {/if}
    </div>
  {/if}
</section>

<style>
.ideas-backlog {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 0.75rem;
  background: var(--surface);
}
.backlog-header,
.actions {
  align-items: center;
  display: flex;
  gap: 0.375rem;
}
.backlog-header {
  justify-content: space-between;
  padding: 0.5rem 0.625rem;
}
.count,
.status {
  color: var(--muted);
  font-size: 0.625rem;
}
.composer,
.idea-detail {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem;
  border-top: 1px solid var(--border);
}
.idea-list {
  display: flex;
  flex-direction: column;
}
.idea-item {
  border-top: 1px solid var(--border);
}
.idea-summary {
  padding: 0.625rem;
}
.idea-copy {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}
.idea-copy strong {
  font-size: 0.75rem;
}
.idea-copy span {
  color: var(--muted);
  font-size: 0.6875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.question,
summary,
pre,
.empty,
.error {
  font-size: 0.6875rem;
}
.question,
.empty {
  color: var(--muted);
}
pre {
  color: var(--text);
  max-height: 15rem;
  overflow: auto;
  white-space: pre-wrap;
}
.empty {
  padding: 0.75rem;
}
.error {
  color: #dc3c3c;
  padding: 0 0.625rem 0.5rem;
}
</style>
