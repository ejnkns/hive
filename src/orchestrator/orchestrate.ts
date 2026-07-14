/** @internal — only imported by orchestrator.ts */

import { logger } from "../shared/logger";
import type { Message } from "../shared/message";
import { consumeSSEStream } from "./orchestrate/consume-sse-stream";
import type {
  CompletionRequest,
  ModelCaller,
  OrchestrationConfig,
  OrchestrationResult,
} from "./types";

const DEFAULT_MAX_ITERATIONS = 10;

const TERMINAL_FINISH_REASONS = new Set(["stop", "length", "content-filter"]);

export async function orchestrate(
  config: OrchestrationConfig,
  modelCaller: ModelCaller
): Promise<OrchestrationResult> {
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const messages: Message[] = [...config.messages];
  const sessionId = config.sessionId;
  const toolRegistry = config.toolRegistry;
  const toolContext = config.toolContext;
  const onEvent = config.onEvent;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    onEvent?.({ type: "iteration_start", iteration });

    const payload: Record<string, unknown> = {
      messages,
      stream: true,
    };
    const toolDefinitions = toolRegistry.getDefinitions();
    if (toolDefinitions.length > 0) {
      payload.tools = toolDefinitions;
    }

    const request: CompletionRequest = { payload, sessionId };
    const response = await modelCaller.complete(request);

    if (!response.ok) {
      logger.debug(
        `orchestrate iteration ${String(iteration)} — model call failed (status ${String(response.status)})`
      );
      onEvent?.({
        type: "error",
        error: response.error ?? "Model call failed",
      });
      return {
        messages,
        finishReason: "error",
        finalContent: "",
        iterations: iteration + 1,
        error: response.error ?? "Model call failed",
      };
    }

    logger.debug(
      `orchestrate iteration ${String(iteration)} — response ok, status=${String(response.status)}, provider=${response.provider ?? "none"}, model=${response.model ?? "none"}, stream readable=${String(typeof response.stream?.read === "function")}`
    );

    onEvent?.({ type: "streaming_started", iteration });

    let accumulatedContent = "";
    const parsed = await consumeSSEStream(response.stream, (chunk) => {
      if (chunk.content) {
        accumulatedContent += chunk.content;
        onEvent?.({
          type: "content_delta",
          iteration,
          content: accumulatedContent,
        });
      }
    });

    logger.debug(
      `orchestrate iteration ${String(iteration)} — stream parsed: contentLength=${String(parsed.content.length)}, toolCalls=${String(parsed.toolCalls.length)}, finishReason=${parsed.finishReason ?? "null"}`
    );

    const assistantMessage: Message = {
      role: "assistant",
      content: parsed.content,
    };
    if (parsed.toolCalls.length > 0) {
      assistantMessage.tool_calls = parsed.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    messages.push(assistantMessage);

    onEvent?.({
      type: "model_complete",
      iteration,
      finishReason: parsed.finishReason,
      toolCallCount: parsed.toolCalls.length,
    });

    const isSuccess =
      parsed.toolCalls.length === 0 ||
      (parsed.finishReason !== null &&
        TERMINAL_FINISH_REASONS.has(parsed.finishReason));

    if (isSuccess) {
      const finishReason =
        (parsed.finishReason as "stop" | "length" | "content-filter") ?? "stop";
      onEvent?.({ type: "complete", finishReason, iterations: iteration + 1 });
      return {
        messages,
        finishReason,
        finalContent: parsed.content,
        iterations: iteration + 1,
      };
    }

    for (const toolCall of parsed.toolCalls) {
      const result = await toolRegistry.execute(toolCall, toolContext);
      const toolMessage: Message = {
        role: "tool",
        content: result.content,
        tool_call_id: result.toolCallId,
      };
      messages.push(toolMessage);
      logger.debug(
        `orchestrate iteration ${String(iteration)} — executed tool ${toolCall.name} (error=${String(result.isError)})`
      );
      onEvent?.({
        type: "tool_executed",
        iteration,
        toolName: toolCall.name,
        isError: result.isError,
        contentPreview: result.content.slice(0, 200),
      });
    }
  }

  onEvent?.({
    type: "complete",
    finishReason: "max-iterations",
    iterations: maxIterations,
  });
  return {
    messages,
    finishReason: "max-iterations",
    finalContent: "",
    iterations: maxIterations,
  };
}
