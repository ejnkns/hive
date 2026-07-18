/** @public */

import type { Message } from "shared/message";
import {
  createDeviseModelCaller,
  type DeviseModelCaller,
} from "./devise-engine/create-devise-model-caller";
import { DEVISE_SYSTEM_PROMPT } from "./devise-engine/devise-system-prompt";
import { executeDeviseTool } from "./devise-engine/devise-tools";
import { requirementsRevision } from "./requirements-store";

export type DeviseSession = {
  projectId: string;
  cardId?: string;
  messages: Message[];
  status: "active" | "complete";
  requirementsRevision?: string;
};

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
};

export type DeviseRespondResult =
  | { type: "question"; question: string }
  | { type: "complete"; spec: string };

export function createDeviseEngine(
  modelCaller?: DeviseModelCaller
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
      return sessions.get(projectId);
    },

    getCardSession(projectId, cardId) {
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
    const messages: Message[] = [
      { role: "system", content: DEVISE_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    const result = await callWithToolLoop(caller, messages, workspacePath);

    messages.push({ role: "assistant", content: result.content });

    sessions.set(sessionKey, {
      projectId,
      cardId,
      messages,
      status: "active",
      requirementsRevision: result.requirementsRevision,
    });

    return { question: result.content };
  }

  async function respondSession(
    sessionKey: string,
    answer: string,
    workspacePath: string
  ): Promise<DeviseRespondResult> {
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

    if (result.requirementsRevision) {
      session.requirementsRevision = result.requirementsRevision;
    }
    const isComplete = detectCompletion(result.content);

    session.messages.push({
      role: "assistant",
      content: isComplete ? extractSpec(result.content) : result.content,
    });

    if (isComplete) {
      session.status = "complete";
      return { type: "complete", spec: extractSpec(result.content) };
    }

    return { type: "question", question: result.content };
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
): Promise<{ content: string; requirementsRevision?: string }> {
  let updatedRequirementsRevision: string | undefined;
  for (let round = 0; round < maxToolRounds; round++) {
    const response = await caller.call(messages, workspacePath, true);

    if (response.toolCalls.length === 0) {
      return {
        content: response.content,
        requirementsRevision: updatedRequirementsRevision,
      };
    }

    for (const toolCall of response.toolCalls) {
      const result = executeDeviseTool(toolCall, workspacePath);
      if (toolCall.name === "update_requirements" && !result.isError) {
        const args = JSON.parse(toolCall.arguments) as { content?: unknown };
        if (typeof args.content === "string") {
          updatedRequirementsRevision = requirementsRevision(args.content);
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
    requirementsRevision: updatedRequirementsRevision,
  };
}

function detectCompletion(content: string): boolean {
  return content.includes("REQUIREMENTS_COMPLETE");
}

export function extractSpec(content: string): string {
  return content.replace(/REQUIREMENTS_COMPLETE/g, "").trim();
}
