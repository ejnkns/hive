/** @public — shared by Queen Bee agent-role execution loops. */

import type { Message } from "shared/message";
import type { AgentModelResponse } from "../devise-engine/create-devise-model-caller";

export function appendAgentToolExchanges(
  messages: Message[],
  response: AgentModelResponse,
  exchanges: AgentToolExchange[]
): void {
  const assistantMessage: Message = {
    role: "assistant",
    content: response.content,
    tool_calls: response.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    })),
  };
  if (response.reasoningContent) {
    assistantMessage.reasoning_content = response.reasoningContent;
  }
  if (response.reasoning) {
    assistantMessage.reasoning = response.reasoning;
  }
  messages.push(
    assistantMessage,
    ...exchanges.map(
      ({ toolCall, content }): Message => ({
        role: "tool",
        content,
        tool_call_id: toolCall.id,
      })
    )
  );
}

type AgentToolExchange = {
  toolCall: { id: string; name: string; arguments: string };
  content: string;
};
