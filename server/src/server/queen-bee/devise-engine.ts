/** @public */

import { randomUUID } from "node:crypto";
import type { Message } from "shared/message";
import {
  createDeviseModelCaller,
  type DeviseModelCaller,
} from "./devise-engine/create-devise-model-caller";
import { DEVISE_SYSTEM_PROMPT } from "./devise-engine/devise-system-prompt";
import { executeDeviseTool } from "./devise-engine/devise-tools";
import type {
  PersistedDeviseSession,
  QueenBeeRuntimeStore,
} from "./queen-bee-runtime-store";
import { readRequirements, requirementsRevision } from "./requirements-store";

export type DeviseSession = PersistedDeviseSession;

export type DeviseEngine = {
  start(
    projectId: string,
    prompt: string,
    workspacePath: string
  ): Promise<DeviseStartResult>;
  respond(
    projectId: string,
    answer: string,
    workspacePath: string
  ): Promise<DeviseRespondResult>;
  getSession(projectId: string): DeviseSession | undefined;
  startCard(
    projectId: string,
    cardId: string,
    prompt: string,
    workspacePath: string
  ): Promise<DeviseStartResult>;
  respondCard(
    projectId: string,
    cardId: string,
    answer: string,
    workspacePath: string
  ): Promise<DeviseRespondResult>;
  getCardSession(projectId: string, cardId: string): DeviseSession | undefined;
};

export type DeviseStartResult = {
  question: string;
  draftRequirements?: string;
};

export type DeviseRespondResult =
  | { type: "question"; question: string; draftRequirements?: string }
  | { type: "complete"; spec: string; draftRequirements: string };

export function createDeviseEngine(
  modelCaller?: DeviseModelCaller,
  runtimeStore?: QueenBeeRuntimeStore
): DeviseEngine {
  const caller = modelCaller ?? createDeviseModelCaller();
  const sessions = new Map<string, DeviseSession>();

  return {
    async start(projectId, prompt, workspacePath) {
      return startSession(projectId, projectId, prompt, workspacePath);
    },

    async startCard(projectId, cardId, prompt, workspacePath) {
      return startSession(
        cardSessionKey(projectId, cardId),
        projectId,
        prompt,
        workspacePath,
        cardId
      );
    },

    async respond(projectId, answer, workspacePath) {
      return respondSession(projectId, answer, workspacePath);
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
        .filter((session) => session.projectId === projectId && !session.cardId)
        .at(-1);
    },

    getCardSession(projectId, cardId) {
      restoreProject(projectId);
      return sessions.get(cardSessionKey(projectId, cardId));
    },
  };

  async function startSession(
    sessionKey: string,
    projectId: string,
    prompt: string,
    workspacePath: string,
    cardId?: string
  ): Promise<DeviseStartResult> {
    restoreProject(projectId);
    const activeSession = [...sessions.values()].find(
      (session) =>
        session.projectId === projectId && session.status === "active"
    );
    if (activeSession) {
      throw new Error(
        "This project already has an active Devise Agent session"
      );
    }
    const messages: Message[] = [
      { role: "system", content: DEVISE_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    const result = await callWithToolLoop(caller, messages, workspacePath);

    messages.push({ role: "assistant", content: result.content });

    const now = new Date().toISOString();
    const session: DeviseSession = {
      sessionId: randomUUID(),
      projectId,
      cardId,
      messages,
      status: "active",
      baseRequirementsRevision: requirementsRevision(
        readRequirements(workspacePath)
      ),
      draftRequirements: result.draftRequirements,
      startedAt: now,
      updatedAt: now,
    };
    sessions.set(sessionKey, session);
    runtimeStore?.saveDeviseSession(session);

    return {
      question: result.content,
      draftRequirements: result.draftRequirements,
    };
  }

  async function respondSession(
    sessionKey: string,
    answer: string,
    workspacePath: string
  ): Promise<DeviseRespondResult> {
    const projectId = sessionKey.split(":card:")[0] ?? sessionKey;
    restoreProject(projectId);
    const session = sessions.get(sessionKey);
    if (!session || session.status === "complete") {
      throw new Error("No active devise session for this project");
    }

    session.messages.push({ role: "user", content: answer });

    const result = await callWithToolLoop(
      caller,
      session.messages,
      workspacePath
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
          "Devise Agent completed without submitting a requirements draft"
        );
      }
      session.status = "complete";
      session.updatedAt = new Date().toISOString();
      runtimeStore?.saveDeviseSession(session);
      return {
        type: "complete",
        spec: extractSpec(result.content),
        draftRequirements: session.draftRequirements,
      };
    }

    session.updatedAt = new Date().toISOString();
    runtimeStore?.saveDeviseSession(session);
    return {
      type: "question",
      question: result.content,
      draftRequirements: session.draftRequirements,
    };
  }

  function restoreProject(projectId: string): void {
    if (!runtimeStore) return;
    for (const session of runtimeStore.getDeviseSessions(projectId)) {
      const key = session.cardId
        ? cardSessionKey(projectId, session.cardId)
        : projectId;
      const existing = sessions.get(key);
      if (!existing || existing.updatedAt < session.updatedAt) {
        sessions.set(key, session);
      }
    }
  }
}

function cardSessionKey(projectId: string, cardId: string): string {
  return `${projectId}:card:${cardId}`;
}

async function callWithToolLoop(
  caller: DeviseModelCaller,
  messages: Message[],
  workspacePath: string,
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
      const result = executeDeviseTool(toolCall, workspacePath);
      if (toolCall.name === "update_requirements_draft" && !result.isError) {
        const args = JSON.parse(toolCall.arguments) as { content?: unknown };
        if (typeof args.content === "string") {
          draftRequirements = args.content;
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

function detectCompletion(content: string): boolean {
  return content.includes("REQUIREMENTS_COMPLETE");
}

export function extractSpec(content: string): string {
  return content.replace(/REQUIREMENTS_COMPLETE/g, "").trim();
}
