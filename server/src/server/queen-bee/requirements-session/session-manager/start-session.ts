/** @private — only imported by session-manager.ts */

import { randomUUID } from "node:crypto";
import type { Message } from "shared/message";
import type { QueenBeeRuntimeStore } from "../../queen-bee-runtime-store";
import {
  readRequirements,
  requirementsRevision,
} from "../../requirements-store";
import { requirementsAgentSystemPrompt } from "../agent-prompt";
import type { AgentModelCaller } from "../create-model-caller";
import type {
  RequirementsDraftUpdate,
  RequirementsSession,
  RequirementsStartResult,
  StartRequirementsSessionInput,
} from "../types";
import { callWithToolLoop } from "./call-with-tool-loop";
import {
  projectContext,
  projectContextMessages,
  systemMessage,
} from "./project-context-messages";
import { restoreProject } from "./restore-project";

export type SessionDeps = {
  caller: AgentModelCaller;
  sessions: Map<string, RequirementsSession>;
  activeCalls: Map<string, AbortController>;
  runtimeStore?: QueenBeeRuntimeStore;
  onDraftUpdate: (update: RequirementsDraftUpdate) => void;
  maxToolRounds: number;
};

export async function startSession(
  input: StartRequirementsSessionInput,
  deps: SessionDeps
): Promise<RequirementsStartResult> {
  const { sessions, activeCalls, runtimeStore, onDraftUpdate } = deps;
  const {
    sessionKey,
    projectId,
    kind,
    prompt,
    workspacePath,
    cardId,
    sourceIdea,
    feedback,
    sourceIdeaId,
    sourceFeedbackId,
    allowedProposalId,
  } = input;
  restoreProject(projectId, runtimeStore, sessions);
  const activeSession = [...sessions.values()].find(
    (session) => session.projectId === projectId && session.status === "active"
  );
  if (activeSession) {
    throw new Error("This project already has an active requirements workflow");
  }
  if (runtimeStore) {
    const competingProposal = runtimeStore
      .getPlanningProposals(projectId)
      .find(
        (proposal) =>
          proposal.status === "pending" && proposal.id !== allowedProposalId
      );
    const competingFeedback = runtimeStore
      .getRequirementsFeedbacks(projectId)
      .find(
        (candidate) =>
          candidate.status !== "resolved" && candidate.id !== sourceFeedbackId
      );
    if (competingProposal || competingFeedback) {
      throw new Error(
        "This project already has an open requirements-changing workflow"
      );
    }
  }
  const context = projectContext(projectId, workspacePath);
  const messages: Message[] = [
    { role: "system", content: requirementsAgentSystemPrompt(kind) },
    ...projectContextMessages(context),
    {
      role: "system",
      content: `Canonical Requirements Document at session start:\n${readRequirements(workspacePath) || "(none)"}`,
    },
    ...(sourceIdea
      ? [systemMessage(`Source Idea:\n${JSON.stringify(sourceIdea, null, 2)}`)]
      : []),
    ...(feedback
      ? [
          systemMessage(
            `Requirements Draft requiring repair:\n${feedback.proposedRequirements}\n\nStructured Requirements Feedback:\n${JSON.stringify(feedback.issues, null, 2)}`
          ),
        ]
      : []),
    { role: "user", content: prompt },
  ];

  const sessionId = randomUUID();
  const controller = new AbortController();
  activeCalls.set(sessionKey, controller);
  let result: Awaited<ReturnType<typeof callWithToolLoop>>;
  try {
    result = await callWithToolLoop(
      deps.caller,
      messages,
      workspacePath,
      (content) =>
        onDraftUpdate({
          projectId,
          sessionId,
          cardId,
          ideaId: kind === "idea_elaboration" ? sourceIdea?.id : undefined,
          content,
        }),
      deps.maxToolRounds,
      context?.revision,
      controller.signal
    );
  } finally {
    if (activeCalls.get(sessionKey) === controller) {
      activeCalls.delete(sessionKey);
    }
  }

  messages.push({ role: "assistant", content: result.content });

  const now = new Date().toISOString();
  const session: RequirementsSession = {
    sessionId,
    projectId,
    cardId,
    ideaId: kind === "idea_elaboration" ? sourceIdea?.id : undefined,
    sourceIdeaId,
    sourceFeedbackId,
    kind,
    messages,
    status: "active",
    baseRequirementsRevision: requirementsRevision(
      readRequirements(workspacePath)
    ),
    projectRevision: context?.revision ?? null,
    draftRequirements: result.draftRequirements,
    startedAt: now,
    updatedAt: now,
  };
  sessions.set(sessionKey, session);
  runtimeStore?.saveRequirementsSession(session);
  if (runtimeStore && feedback) {
    feedback.status = "repairing";
    runtimeStore.saveRequirementsFeedback(feedback);
  }

  return {
    sessionId,
    question: result.content,
    draftRequirements: result.draftRequirements,
  };
}
