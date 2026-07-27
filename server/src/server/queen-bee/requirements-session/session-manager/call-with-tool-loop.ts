import { isRecord } from "shared/board-types";
import type { Message } from "shared/message";
import { appendAgentToolExchanges } from "../../shared/append-agent-tool-exchanges";
import { executeAgentTool } from "../agent-tools";
import type { AgentModelCaller } from "../create-model-caller";

export async function callWithToolLoop(
  caller: AgentModelCaller,
  messages: Message[],
  workspacePath: string,
  onDraftUpdate: (content: string) => void = () => {},
  maxToolRounds: number,
  projectRevision?: string,
  signal?: AbortSignal
): Promise<{ content: string; draftRequirements?: string }> {
  let draftRequirements: string | undefined;
  for (let round = 0; round < maxToolRounds; round++) {
    const response = await caller.call(messages, workspacePath, true, signal);

    if (response.toolCalls.length === 0) {
      return {
        content: response.content,
        draftRequirements,
      };
    }

    const exchanges = [];
    for (const toolCall of response.toolCalls) {
      const result = executeAgentTool(toolCall, workspacePath, projectRevision);
      if (toolCall.name === "update_requirements_draft" && !result.isError) {
        const args: unknown = JSON.parse(toolCall.arguments);
        if (isRecord(args) && typeof args.content === "string") {
          draftRequirements = args.content;
          onDraftUpdate(args.content);
        }
      }

      exchanges.push({ toolCall, content: result.content });
    }
    appendAgentToolExchanges(messages, response, exchanges);
  }

  return {
    content: "",
    draftRequirements,
  };
}
