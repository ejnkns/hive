/** @public — one-time engine wiring. Creates configured runners with server-side dependencies. */

import { homedir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type {
  OperationContext,
  OperationFn,
  TaskRunnerContext,
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
  prepareIsolatedWorkspace,
  toToolMaps,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { handleChatCompletion } from "./proxy/handle-chat-completion";

// ─── Infrastructure operation wiring ─────────────────────────────────────

type OperationResult = Record<string, unknown>;

// prepare_worktree is an engine infrastructure operation. It branches on the
// flow's repo binding: with a repo it prepares a git worktree on a feature
// branch; without one it prepares a plain sandbox directory. The repo binding
// and workspace base come from flow config; the card id and attempt come from
// the workflow instance context or the task's operationInputs.
function wrapPrepareWorktree(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const config = ctx.flowConfig();
  const instanceState = ctx.workflowInstanceState();
  const result = prepareIsolatedWorkspace({
    repoPath: typeof config.repoPath === "string" ? config.repoPath : undefined,
    workspacesBasePath: readWorkspacesBasePath(config),
    projectId:
      readString(params.projectId) ??
      readString(instanceState.projectId) ??
      ctx.workflowId,
    cardId: readString(params.cardId) ?? ctx.instanceId,
    attempt:
      readNumber(params.attempt) ?? readNumber(instanceState.attempt) ?? 1,
  });
  return result as unknown as OperationResult;
}

const DEFAULT_WORKSPACES_BASE_PATH = join(homedir(), ".hive", "workspaces");

function readWorkspacesBasePath(config: Record<string, unknown>): string {
  return readString(config.workspacesBasePath) ?? DEFAULT_WORKSPACES_BASE_PATH;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

// ─── patch_flow_config ─────────────────────────────────────────────────

// patch_flow_config writes fields into FlowConfig from within a workflow task,
// wrapping the runtime's patchFlowConfig. Params come from the task's
// operationInputs. A value equal to `@flow:<field>` copies the current value
// of that flow config field instead — used when the task's inputs are decided
// by an earlier step at runtime (e.g. a computed targetBranch).
const FLOW_CONFIG_REF_PREFIX = "@flow:";

function isFlowConfigRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(FLOW_CONFIG_REF_PREFIX);
}

function resolveAndPatchFlowConfig(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const config = ctx.flowConfig();
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    patch[key] = isFlowConfigRef(value)
      ? config[value.slice(FLOW_CONFIG_REF_PREFIX.length)]
      : value;
  }
  ctx.patchFlowConfig(patch);
  return { ok: true, config: ctx.flowConfig() };
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
  operationRunner: (
    ctx: TaskRunnerContext
  ) => ReturnType<typeof createOperationRunner>;
  aiTaskRunner: (
    ctx: TaskRunnerContext
  ) => ReturnType<typeof createAiTaskRunner>;
  aiChatRunner: (
    ctx: TaskRunnerContext
  ) => ReturnType<typeof createAiChatRunner>;
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

  function buildOperationContext(ctx: TaskRunnerContext): OperationContext {
    return {
      flowConfig: () => ctx.flowConfig,
      patchFlowConfig: ctx.patchFlowConfig,
      instanceId: ctx.instanceId,
      workflowId: ctx.workflowId,
      currentState: ctx.currentState,
      workflowInstanceState: () => ctx.workflowInstanceState,
    };
  }

  // The flow's base directory — the bound repo root when present. Tools that
  // persist flow-level domain state (queen-bee's .hive/) write relative to it.
  function readBasePath(ctx: TaskRunnerContext): string | undefined {
    const repoPath = ctx.flowConfig.repoPath;
    return typeof repoPath === "string" && repoPath !== ""
      ? repoPath
      : undefined;
  }

  return {
    // Factories: each task execution gets an isolated runner instance so
    // concurrent ai-chat/ai-task sessions in one flow do not share state.
    operationRunner: (ctx) =>
      createOperationRunner({
        getContext: () => buildOperationContext(ctx),
        operations: {
          prepare_worktree: wrapPrepareWorktree,
          patch_flow_config: resolveAndPatchFlowConfig,
          ...domain.operations,
        },
      }),
    aiTaskRunner: (ctx) =>
      createAiTaskRunner({
        modelCaller: createModelCaller(engineTools),
        toolDefinitions,
        toolExecutors,
        basePath: readBasePath(ctx),
        instanceId: ctx.instanceId,
      }),
    aiChatRunner: (ctx) =>
      createAiChatRunner({
        modelCaller: createModelCaller(engineTools),
        toolDefinitions,
        toolExecutors,
        basePath: readBasePath(ctx),
        instanceId: ctx.instanceId,
      }),
    toolDefinitions,
    toolExecutors,
  };
}
