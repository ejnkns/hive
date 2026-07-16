/** @public */

import type { Message } from "shared/message";
import { createDeviseModelCaller } from "./devise-engine/create-devise-model-caller";
import { DEVISE_SYSTEM_PROMPT } from "./devise-engine/devise-system-prompt";

export type DeviseSession = {
  projectId: string;
  messages: Message[];
  status: "active" | "complete";
};

export type DeviseEngine = {
  start(projectId: string, prompt: string): Promise<DeviseStartResult>;
  respond(projectId: string, answer: string): Promise<DeviseRespondResult>;
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
    async start(projectId, prompt) {
      const messages: Message[] = [
        { role: "system", content: DEVISE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ];

      const result = await modelCaller.call(messages);

      messages.push({ role: "assistant", content: result.content });

      sessions.set(projectId, {
        projectId,
        messages,
        status: "active",
      });

      return { question: result.content };
    },

    async respond(projectId, answer) {
      const session = sessions.get(projectId);
      if (!session || session.status === "complete") {
        throw new Error("No active devise session for this project");
      }

      session.messages.push({ role: "user", content: answer });

      const result = await modelCaller.call(session.messages);

      session.messages.push({ role: "assistant", content: result.content });

      const isComplete = detectCompletion(result.content);

      if (isComplete) {
        session.status = "complete";
        sessions.delete(projectId);
        return { type: "complete", spec: result.content };
      }

      return { type: "question", question: result.content };
    },
  };
}

function detectCompletion(content: string): boolean {
  return (
    content.includes("# Requirements") ||
    content.includes("# Overview") ||
    content.includes("## Overview")
  );
}
