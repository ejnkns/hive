<script lang="ts">
import type {
  PlanningProposal,
  RequirementsFeedback,
  RequirementsSessionKind,
} from "shared/board-types";
import { isRecord } from "shared/board-types";
import { onMount } from "svelte";
import DeviseChat from "./devise-chat.svelte";
import KanbanBoard from "./kanban-board.svelte";
import { parsePlanningProposalResponse } from "./parse-planning-proposal-response";
import PlanningProposalView from "./planning-proposal.svelte";
import { projectHeader } from "./project-header-state.svelte";
import {
  connectProjectSocket,
  disconnectProjectSocket,
} from "./project-socket.svelte";
import RequirementsFeedbackView from "./requirements-feedback.svelte";

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
let initialKind = $state<RequirementsSessionKind>("initial_requirements");
let initialDraftRequirements = $state<string | undefined>(undefined);
let planningProposal = $state<PlanningProposal | null>(null);
let requirementsFeedback = $state<RequirementsFeedback | null>(null);

onMount(() => {
  projectHeader.projectId = projectId;
  connectProjectSocket(projectId);
  checkStatus();
  return () => disconnectProjectSocket();
});

async function checkStatus() {
  loading = true;
  try {
    planningProposal = null;
    requirementsFeedback = null;
    initialMessages = undefined;
    initialStatus = undefined;
    initialKind = "initial_requirements";
    initialDraftRequirements = undefined;
    const res = await fetch(`/api/queen-bee/${projectId}/phase`);
    if (!res.ok) throw new Error("Failed to load project");
    const data = await res.json();
    if (!isRecord(data) || typeof data.phase !== "string") {
      throw new Error("Invalid project phase response");
    }

    if (data.phase === "planning") {
      const outcome = parsePlanningProposalResponse(data.outcome ?? {});
      if (outcome.proposal) {
        planningProposal = outcome.proposal;
      } else if (outcome.feedback) {
        requirementsFeedback = outcome.feedback;
      }
      return;
    }

    if (typeof data.requirementsContent === "string") {
      projectHeader.requirementsContent = data.requirementsContent;
    }

    if (data.phase === "requirements") {
      const session = isRecord(data.session) ? data.session : null;
      if (session && isClientMessages(session.messages)) {
        initialMessages = session.messages;
        initialStatus =
          typeof session.status === "string" ? session.status : undefined;
        initialKind = isRequirementsSessionKind(session.kind)
          ? session.kind
          : "initial_requirements";
        initialDraftRequirements =
          typeof session.draftRequirements === "string"
            ? session.draftRequirements
            : undefined;
      }
      hasBoard = false;
      return;
    }

    if (data.phase === "board") {
      hasBoard = Boolean(data.hasBoard);
      return;
    }

    hasBoard = false;
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
      const data: unknown = await res.json();
      if (isRecord(data) && typeof data.content === "string") {
        projectHeader.requirementsContent = data.content;
      }
    }
  } catch {
    // ignore
  }
}

async function handleApprove() {
  planning = true;
  errorMessage = null;
  try {
    const approval = await fetch(
      `/api/queen-bee/${projectId}/requirements/approve`,
      {
        method: "POST",
      }
    );
    const result = parsePlanningProposalResponse(await approval.json());
    if (!approval.ok) {
      throw new Error(result.error ?? "Requirements approval failed");
    }
    if (result.feedback) {
      requirementsFeedback = result.feedback;
      return;
    }
    if (!result.proposal) {
      throw new Error(result.error ?? "Planner returned no proposal");
    }
    planningProposal = result.proposal;
  } catch (err) {
    errorMessage =
      err instanceof Error ? err.message : "Unknown error planning";
  } finally {
    planning = false;
  }
}

function isClientMessages(
  value: unknown
): value is Array<{ role: string; content: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (message) =>
        isRecord(message) &&
        typeof message.role === "string" &&
        typeof message.content === "string"
    )
  );
}

function isRequirementsSessionKind(
  value: unknown
): value is RequirementsSessionKind {
  return (
    value === "initial_requirements" ||
    value === "requirements_revision" ||
    value === "idea_elaboration" ||
    value === "requirements_repair"
  );
}
</script>

<div class="project-page">
  <div class="main-content">
    {#if loading}
      <div class="loading">Loading...</div>
    {:else if planning}
      <div class="planning">
        <div class="planning-text">Generating project plan...</div>
        <div class="planning-hint">
          Preparing proposed requirements and their corresponding Ready Cards
        </div>
      </div>
    {:else if errorMessage}
      <div class="error">{errorMessage}</div>
      <div class="error-actions">
        <button type="button" class="btn btn-primary" onclick={handleApprove}>
          Retry
        </button>
      </div>
    {:else if requirementsFeedback}
      <RequirementsFeedbackView
        {projectId}
        feedback={requirementsFeedback}
        onRepairStarted={() => {
          requirementsFeedback = null;
          hasBoard = false;
          void checkStatus();
        }}
      />
    {:else if planningProposal}
      <PlanningProposalView
        {projectId}
        proposal={planningProposal}
        onApplied={() => {
          planningProposal = null;
          void checkStatus();
        }}
        onDiscard={() => {
          planningProposal = null;
          void checkStatus();
        }}
        onRequirementsFeedback={(feedback) => {
          planningProposal = null;
          requirementsFeedback = feedback;
        }}
        onRequirementsRevisionStarted={() => {
          planningProposal = null;
          hasBoard = false;
          void checkStatus();
        }}
      />
    {:else if hasBoard}
      <KanbanBoard
        {projectId}
        onPlanningProposal={(proposal) => {
          planningProposal = proposal;
        }}
        onRequirementsFeedback={(feedback) => {
          requirementsFeedback = feedback;
        }}
        onReDeviseStarted={() => {
          hasBoard = false;
          void checkStatus();
        }}
      />
    {:else}
      <DeviseChat
        {projectId}
        {initialMessages}
        {initialStatus}
        {initialKind}
        {initialDraftRequirements}
        onApprove={handleApprove}
        onComplete={() => {
          void fetchRequirements();
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
