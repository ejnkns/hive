import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "shared/message";
import type { ToolCall } from "./agent-tools";
import type {
  AgentModelCaller,
  AgentModelResponse,
} from "./create-model-caller";

export function createMockCaller(
  responses: AgentModelResponse[]
): AgentModelCaller {
  let index = 0;
  return {
    call: async (
      _messages: Message[],
      _workspacePath: string,
      _includeTools: boolean
    ): Promise<AgentModelResponse> => {
      const response = responses[index];
      if (!response) throw new Error("No more mock responses");
      index++;
      return response;
    },
  };
}

export function emptyResponse(content: string): AgentModelResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

export function completionResponse(): AgentModelResponse {
  return {
    content: "# Requirements\n\n## Overview\nTest app\n\nREQUIREMENTS_COMPLETE",
    toolCalls: [],
    finishReason: "stop",
  };
}

export function draftResponse(): AgentModelResponse {
  return toolResponse("", [
    {
      id: "draft-1",
      name: "update_requirements_draft",
      arguments: JSON.stringify({
        content: "# Requirements\n\n## Overview\nTest app",
      }),
    },
  ]);
}

export function toolResponse(
  content: string,
  toolCalls: ToolCall[]
): AgentModelResponse {
  return { content, toolCalls, finishReason: "tool_calls" };
}

export function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-req-session-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
  writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;");
  return dir;
}
