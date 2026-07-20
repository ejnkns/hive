/** @public */

import { randomUUID } from "node:crypto";
import type { Idea, RequirementsFeedback } from "shared/board-types";
import type { Message } from "shared/message";
import {
  type AgentModelCaller,
  createAgentModelCaller,
} from "./devise-engine/create-devise-model-caller";
import {
  type RequirementsSessionKind,
  requirementsAgentSystemPrompt,
} from "./devise-engine/devise-system-prompt";
import { executeAgentTool } from "./devise-engine/devise-tools";
import { loadProjectContext } from "./project-context";
import type {
  PersistedRequirementsSession,
  QueenBeeRuntimeStore,
} from "./queen-bee-runtime-store";
import { readRequirements, requirementsRevision } from "./requirements-store";

export type RequirementsSession = PersistedRequirementsSession;

export type RequirementsDraftUpdate = {
  projectId: string;
  sessionId: string;
  cardId?: string;
  ideaId?: string;
  content: string;
};

export type RequirementsSessionManager = {
  start(
    projectId: string,
    prompt: string,
    workspacePath: string
  ): Promise<RequirementsStartResult>;
  startRevision(
    projectId: string,
    prompt: string,
    workspacePath: string,
    replacesProposalId?: string
  ): Promise<RequirementsStartResult>;
  startIdea(
    projectId: string,
    idea: Idea,
    prompt: string,
    workspacePath: string
  ): Promise<RequirementsStartResult>;
  startRepair(
    projectId: string,
    feedback: RequirementsFeedback,
    workspacePath: string,
    sourceIdea?: Idea
  ): Promise<RequirementsStartResult>;
  respondIdea(
    projectId: string,
    ideaId: string,
    answer: string,
    workspacePath: string
  ): Promise<RequirementsRespondResult>;
  getIdeaSession(
    projectId: string,
    ideaId: string
  ): RequirementsSession | undefined;
  respond(
    projectId: string,
    answer: string,
    workspacePath: string
  ): Promise<RequirementsRespondResult>;
  getSession(projectId: string): RequirementsSession | undefined;
  submitForPlanning(
    projectId: string,
    sessionId: string,
    planningOutcomeId: string
  ): void;
  startCard(
    projectId: string,
    cardId: string,
    prompt: string,
    workspacePath: string
  ): Promise<RequirementsStartResult>;
  respondCard(
    projectId: string,
    cardId: string,
    answer: string,
    workspacePath: string
  ): Promise<RequirementsRespondResult>;
  getCardSession(
    projectId: string,
    cardId: string
  ): RequirementsSession | undefined;
};

export type RequirementsStartResult = {
  question: string;
  draftRequirements?: string;
};

export type RequirementsRespondResult =
  | { type: "question"; question: string; draftRequirements?: string }
  | { type: "complete"; spec: string; draftRequirements: string };

type StartRequirementsSessionInput = {
  sessionKey: string;
  projectId: string;
  kind: RequirementsSessionKind;
  prompt: string;
  workspacePath: string;
  cardId?: string;
  sourceIdea?: Idea;
  feedback?: RequirementsFeedback;
  sourceIdeaId?: string;
  sourceFeedbackId?: string;
  allowedProposalId?: string;
};

export function createRequirementsSessionManager(
  modelCaller?: AgentModelCaller,
  runtimeStore?: QueenBeeRuntimeStore,
  onDraftUpdate: (update: RequirementsDraftUpdate) => void = () => {}
): RequirementsSessionManager {
  const caller = modelCaller ?? createAgentModelCaller();
  const sessions = new Map<string, RequirementsSession>();

  return {
    async start(projectId, prompt, workspacePath) {
      return startSession({
        sessionKey: projectId,
        projectId,
        kind: "initial_requirements",
        prompt,
        workspacePath,
      });
    },

    async startRevision(projectId, prompt, workspacePath, replacesProposalId) {
      return startSession({
        sessionKey: projectId,
        projectId,
        kind: "requirements_revision",
        prompt,
        workspacePath,
        allowedProposalId: replacesProposalId,
      });
    },

    async startIdea(projectId, idea, prompt, workspacePath) {
      return startSession({
        sessionKey: ideaSessionKey(projectId, idea.id),
        projectId,
        kind: "idea_elaboration",
        prompt,
        workspacePath,
        sourceIdea: idea,
      });
    },

    async startRepair(projectId, feedback, workspacePath, sourceIdea) {
      return startSession({
        sessionKey: projectId,
        projectId,
        kind: "requirements_repair",
        prompt: "Resolve the structured Requirements Feedback with the user.",
        workspacePath,
        sourceIdea,
        feedback,
        sourceIdeaId: feedback.sourceIdeaId,
        sourceFeedbackId: feedback.id,
      });
    },

    async startCard(projectId, cardId, prompt, workspacePath) {
      return startSession({
        sessionKey: cardSessionKey(projectId, cardId),
        projectId,
        kind: "requirements_repair",
        prompt,
        workspacePath,
        cardId,
      });
    },

    async respond(projectId, answer, workspacePath) {
      return respondSession(projectId, answer, workspacePath);
    },

    async respondIdea(projectId, ideaId, answer, workspacePath) {
      return respondSession(
        ideaSessionKey(projectId, ideaId),
        answer,
        workspacePath
      );
    },

    async respondCard(projectId, cardId, answer, workspacePath) {
      return respondSession(
        cardSessionKey(projectId, cardId),
        answer,
        workspacePath
      );
    },

    getSession(projectId) {
      restoreProject(projectId);
      return [...sessions.values()]
        .filter(
          (session) =>
            session.projectId === projectId &&
            !session.cardId &&
            !session.ideaId
        )
        .at(-1);
    },

    submitForPlanning(projectId, sessionId, planningOutcomeId) {
      restoreProject(projectId);
      const session = [...sessions.values()].find(
        (candidate) =>
          candidate.projectId === projectId && candidate.sessionId === sessionId
      );
      if (session?.status !== "complete") {
        throw new Error("Requirements Session is not ready for planning");
      }
      const submittedAt = new Date().toISOString();
      session.status = "submitted";
      session.planningOutcomeId = planningOutcomeId;
      session.submittedAt = submittedAt;
      session.updatedAt = submittedAt;
      runtimeStore?.saveRequirementsSession(session);
    },

    getIdeaSession(projectId, ideaId) {
      restoreProject(projectId);
      return sessions.get(ideaSessionKey(projectId, ideaId));
    },

    getCardSession(projectId, cardId) {
      restoreProject(projectId);
      return sessions.get(cardSessionKey(projectId, cardId));
    },
  };

  async function startSession(
    input: StartRequirementsSessionInput
  ): Promise<RequirementsStartResult> {
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
    restoreProject(projectId);
    const activeSession = [...sessions.values()].find(
      (session) =>
        session.projectId === projectId && session.status === "active"
    );
    if (activeSession) {
      throw new Error(
        "This project already has an active requirements workflow"
      );
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
        ? [
            systemMessage(
              `Source Idea:\n${JSON.stringify(sourceIdea, null, 2)}`
            ),
          ]
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
    const result = await callWithToolLoop(
      caller,
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
      context?.revision
    );

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
      question: result.content,
      draftRequirements: result.draftRequirements,
    };
  }

  async function respondSession(
    sessionKey: string,
    answer: string,
    workspacePath: string
  ): Promise<RequirementsRespondResult> {
    const projectId = sessionKey.split(/:(?:card|idea):/)[0] ?? sessionKey;
    restoreProject(projectId);
    const session = sessions.get(sessionKey);
    if (session?.status !== "active") {
      throw new Error("No active Requirements Session for this project");
    }

    session.messages.push({ role: "user", content: answer });

    const result = await callWithToolLoop(
      caller,
      session.messages,
      workspacePath,
      (content) => {
        session.draftRequirements = content;
        session.updatedAt = new Date().toISOString();
        runtimeStore?.saveRequirementsSession(session);
        onDraftUpdate({
          projectId: session.projectId,
          sessionId: session.sessionId,
          cardId: session.cardId,
          ideaId: session.ideaId,
          content,
        });
      },
      session.projectRevision === null ? undefined : session.projectRevision
    );

    if (result.draftRequirements) {
      session.draftRequirements = result.draftRequirements;
    }
    const isComplete = detectCompletion(result.content);

    session.messages.push({
      role: "assistant",
      content: isComplete ? extractSpec(result.content) : result.content,
    });

    if (isComplete) {
      if (!session.draftRequirements) {
        throw new Error(
          "Requirements Agent completed without submitting a requirements draft"
        );
      }
      session.status = "complete";
      session.updatedAt = new Date().toISOString();
      runtimeStore?.saveRequirementsSession(session);
      return {
        type: "complete",
        spec: extractSpec(result.content),
        draftRequirements: session.draftRequirements,
      };
    }

    session.updatedAt = new Date().toISOString();
    runtimeStore?.saveRequirementsSession(session);
    return {
      type: "question",
      question: result.content,
      draftRequirements: session.draftRequirements,
    };
  }

  function restoreProject(projectId: string): void {
    if (!runtimeStore) return;
    for (const session of runtimeStore.getRequirementsSessions(projectId)) {
      const key = session.ideaId
        ? ideaSessionKey(projectId, session.ideaId)
        : session.cardId
          ? cardSessionKey(projectId, session.cardId)
          : projectId;
      const existing = sessions.get(key);
      if (!existing || existing.updatedAt < session.updatedAt) {
        sessions.set(key, session);
      }
    }
  }
}

function systemMessage(content: string): Message {
  return { role: "system", content };
}

function projectContext(
  projectId: string,
  workspacePath: string
): ReturnType<typeof loadProjectContext> | null {
  try {
    return loadProjectContext(projectId, workspacePath);
  } catch {
    return null;
  }
}

function projectContextMessages(
  context: ReturnType<typeof loadProjectContext> | null
): Message[] {
  if (context) {
    return [
      {
        role: "system",
        content: `Shared Project Context at ${context.revision}:\n${JSON.stringify(
          { files: context.files, manifests: context.manifests },
          null,
          2
        )}`,
      },
    ];
  }
  return [];
}

function cardSessionKey(projectId: string, cardId: string): string {
  return `${projectId}:card:${cardId}`;
}

function ideaSessionKey(projectId: string, ideaId: string): string {
  return `${projectId}:idea:${ideaId}`;
}

async function callWithToolLoop(
  caller: AgentModelCaller,
  messages: Message[],
  workspacePath: string,
  onDraftUpdate: (content: string) => void = () => {},
  projectRevision?: string,
  maxToolRounds = 10
): Promise<{ content: string; draftRequirements?: string }> {
  let draftRequirements: string | undefined;
  for (let round = 0; round < maxToolRounds; round++) {
    const response = await caller.call(messages, workspacePath, true);

    if (response.toolCalls.length === 0) {
      return {
        content: response.content,
        draftRequirements,
      };
    }

    for (const toolCall of response.toolCalls) {
      const result = executeAgentTool(toolCall, workspacePath, projectRevision);
      if (toolCall.name === "update_requirements_draft" && !result.isError) {
        const args: unknown = JSON.parse(toolCall.arguments);
        if (isRecord(args) && typeof args.content === "string") {
          draftRequirements = args.content;
          onDraftUpdate(args.content);
        }
      }

      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        tool_calls: [
          {
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        ],
      };

      if (response.reasoningContent) {
        assistantMsg.reasoning_content = response.reasoningContent;
      }

      if (response.reasoning) {
        assistantMsg.reasoning = response.reasoning;
      }

      messages.push(assistantMsg);

      const toolMessage: Message = {
        role: "tool",
        content: result.content,
        tool_call_id: toolCall.id,
      };
      messages.push(toolMessage);
    }
  }

  return {
    content: "",
    draftRequirements,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectCompletion(content: string): boolean {
  return content.includes("REQUIREMENTS_COMPLETE");
}

export function extractSpec(content: string): string {
  return content.replace(/REQUIREMENTS_COMPLETE/g, "").trim();
}
