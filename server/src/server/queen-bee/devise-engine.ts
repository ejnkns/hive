/** @public */

import type { Message } from "shared/message";
import { createDeviseModelCaller } from "./devise-engine/create-devise-model-caller";
import { DEVISE_SYSTEM_PROMPT } from "./devise-engine/devise-system-prompt";
import { executeDeviseTool } from "./devise-engine/devise-tools";

export type DeviseSession = {
  projectId: string;
  messages: Message[];
  status: "active" | "complete";
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
};

export type DeviseStartResult = {
  question: string;
};

export type DeviseRespondResult =
  | { type: "question"; question: string }
  | { type: "complete"; spec: string };

export function createDeviseEngine(): DeviseEngine {
  const sessions = new Map<string, DeviseSession>();
  const modelCaller = createDeviseModelCaller();

  return {
    async start(projectId, prompt, workspacePath) {
      const messages: Message[] = [
        { role: "system", content: DEVISE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ];

      const result = await callWithToolLoop(
        modelCaller,
        messages,
        workspacePath
      );

      messages.push({ role: "assistant", content: result });

      sessions.set(projectId, {
        projectId,
        messages,
        status: "active",
      });

      return { question: result };
    },

    async respond(projectId, answer, workspacePath) {
      const session = sessions.get(projectId);
      if (!session || session.status === "complete") {
        throw new Error("No active devise session for this project");
      }

      session.messages.push({ role: "user", content: answer });

      const result = await callWithToolLoop(
        modelCaller,
        session.messages,
        workspacePath
      );

      const isComplete = detectCompletion(result);

      session.messages.push({
        role: "assistant",
        content: isComplete ? extractSpec(result) : result,
      });

      if (isComplete) {
        session.status = "complete";
        sessions.delete(projectId);
        return { type: "complete", spec: extractSpec(result) };
      }

      return { type: "question", question: result };
    },
  };
}

async function callWithToolLoop(
  modelCaller: ReturnType<typeof createDeviseModelCaller>,
  messages: Message[],
  workspacePath: string,
  maxToolRounds = 10
): Promise<string> {
  for (let round = 0; round < maxToolRounds; round++) {
    const response = await modelCaller.call(messages, workspacePath, true);

    if (response.toolCalls.length === 0) {
      return response.content;
    }

    for (const toolCall of response.toolCalls) {
      const result = executeDeviseTool(toolCall, workspacePath);
      messages.push({
        role: "assistant",
        content: "",
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
      });

      const toolMessage: Message = {
        role: "tool",
        content: result.content,
        tool_call_id: toolCall.id,
      };
      messages.push(toolMessage);
    }
  }

  return "";
}

function detectCompletion(content: string): boolean {
  return content.includes("<requirements-complete>");
}

export function extractSpec(content: string): string {
  const match = content.match(
    /<requirements-complete>([\s\S]*?)<\/requirements-complete>/
  );
  return match ? match[1].trim() : content;
}
