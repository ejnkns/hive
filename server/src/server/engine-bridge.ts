/** @public — one-time engine wiring. Creates configured runners with server-side dependencies. */

import type { Readable } from "node:stream";
import type {
  OperationFn,
  Tool,
  ToolCall,
  ToolDefinition,
  ToolExecutor,
} from "workflow-engine/runners";
import {
  createAiChatRunner,
  createAiTaskRunner,
  createOperationRunner,
  createStandardToolDefinitions,
  createStandardToolRegistry,
  prepareWorktree,
  toToolMaps,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { handleChatCompletion } from "./proxy/handle-chat-completion";

// ─── Infrastructure operation wiring ─────────────────────────────────────

type OperationResult = Record<string, unknown>;

// prepare_worktree is an engine infrastructure operation. This wrapper adapts
// the engine's prepareWorktree signature to the OperationFn shape the
// operation runner expects.
function wrapPrepareWorktree(
  _task: TaskDefinition,
  params: Record<string, unknown>
): OperationResult {
  const result = prepareWorktree({
    repoPath: params.repoPath as string,
    workspacesBasePath: params.workspacesBasePath as string,
    projectId: params.projectId as string,
    cardId: params.cardId as string,
    attempt: params.attempt as number,
  });
  return result as unknown as OperationResult;
}

// ─── Model caller adapter ──────────────────────────────────────────────

function consumeStream(
  stream: Readable,
  signal?: AbortSignal
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  let content = "";
  let buffer = "";
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  return new Promise((resolve, reject) => {
    function onAbort(): void {
      stream.destroy(new Error("Cancelled"));
      reject(signal?.reason ?? new Error("Cancelled"));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const choices = parsed.choices as
            | Array<Record<string, unknown>>
            | undefined;
          if (!choices?.[0]) continue;
          const delta = choices[0].delta as Record<string, unknown> | undefined;
          if (delta?.content && typeof delta.content === "string")
            content += delta.content;
          if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const tcr = tc as Record<string, unknown>;
              const index =
                typeof tcr.index === "number" ? tcr.index : undefined;
              if (index === undefined) continue;
              const existing = toolCallsMap.get(index);
              if (existing) {
                if (tcr.id && typeof tcr.id === "string") existing.id = tcr.id;
                const fn = tcr.function as Record<string, unknown> | undefined;
                if (fn?.name && typeof fn.name === "string")
                  existing.name = fn.name;
                if (fn?.arguments && typeof fn.arguments === "string")
                  existing.arguments += fn.arguments;
              } else {
                const fn = (tcr.function ?? {}) as Record<string, unknown>;
                toolCallsMap.set(index, {
                  id: typeof tcr.id === "string" ? tcr.id : "",
                  name: typeof fn.name === "string" ? fn.name : "",
                  arguments:
                    typeof fn.arguments === "string" ? fn.arguments : "",
                });
              }
            }
          }
        } catch {
          /* skip malformed chunks */
        }
      }
    });

    stream.on("end", () => {
      signal?.removeEventListener("abort", onAbort);
      const toolCalls = Array.from(toolCallsMap.values()).map(
        (tc) =>
          ({ id: tc.id, name: tc.name, arguments: tc.arguments }) as ToolCall
      );
      resolve({ content, toolCalls });
    });

    stream.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

function createModelCaller(_engineTools: ToolDefinition[]) {
  return async (
    systemPrompt: string,
    messages: { role: string; content: string }[],
    tools: ToolDefinition[],
    signal?: AbortSignal
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> => {
    const allMessages = [
      { role: "system", content: systemPrompt } as const,
      ...messages,
    ];
    const result = await handleChatCompletion(
      {
        messages: allMessages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
      },
      {},
      signal
    );
    if (!result.success || !result.stream) {
      throw new Error(result.error ?? "Model call failed");
    }
    const response = await consumeStream(result.stream, signal);
    return {
      content: response.content,
      toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    };
  };
}

// ─── Public API ────────────────────────────────────────────────────────

// The domain capabilities a flow definition carries: self-contained tools and
// deterministic operations. Infrastructure tools and prepare_worktree always
// ship with the engine; these are merged on top.
export type DomainCapabilities = {
  tools?: readonly Tool[];
  operations?: Record<string, OperationFn>;
};

export type EngineRunners = {
  operationRunner: () => ReturnType<typeof createOperationRunner>;
  aiTaskRunner: () => ReturnType<typeof createAiTaskRunner>;
  aiChatRunner: () => ReturnType<typeof createAiChatRunner>;
  toolDefinitions: Record<string, ToolDefinition>;
  toolExecutors: Record<string, ToolExecutor>;
};

export function createEngineRunners(
  domain: DomainCapabilities = {}
): EngineRunners {
  const standardDefs = createStandardToolDefinitions();
  const standardExecs = createStandardToolRegistry();
  const domainMaps = toToolMaps(domain.tools ?? []);

  const toolDefinitions: Record<string, ToolDefinition> = {
    ...standardDefs,
    ...domainMaps.definitions,
  };

  const toolExecutors: Record<string, ToolExecutor> = {
    ...standardExecs,
    ...domainMaps.executors,
  };

  const engineTools = Object.values(toolDefinitions);

  return {
    // Factories: each task execution gets an isolated runner instance so
    // concurrent ai-chat/ai-task sessions in one flow do not share state.
    operationRunner: () =>
      createOperationRunner({
        operations: {
          prepare_worktree: wrapPrepareWorktree,
          ...domain.operations,
        },
      }),
    aiTaskRunner: () =>
      createAiTaskRunner({
        modelCaller: createModelCaller(engineTools),
        toolDefinitions,
        toolExecutors,
      }),
    aiChatRunner: () =>
      createAiChatRunner({
        modelCaller: createModelCaller(engineTools),
        toolDefinitions,
        toolExecutors,
      }),
    toolDefinitions,
    toolExecutors,
  };
}
