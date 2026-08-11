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
  commitFlowState,
  createAiChatRunner,
  createAiTaskRunner,
  createOperationRunner,
  createStandardToolDefinitions,
  createStandardToolRegistry,
  gitOptional,
  mergeBranch,
  prepareIsolatedWorkspace,
  readFlowSettings,
  toToolMaps,
  validateRepo,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type {
  ChatMessage,
  ModelCallStatus,
} from "workflow-engine/workflow-types";
import { handleChatCompletion } from "./proxy/handle-chat-completion.ts";
import { consumeSseStream } from "./sse-consume.ts";

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
  const settings = readFlowSettings(ctx.flowConfig());
  const instanceState = ctx.workflowInstanceState();
  const result = prepareIsolatedWorkspace({
    basePath: settings.basePath,
    workspacesBasePath: readWorkspacesBasePath(ctx.flowConfig()),
    integrationBranch: settings.integrationBranch,
    branchPrefix: settings.branchPrefix,
    projectId: readString(params.projectId) ?? ctx.workflowId,
    cardId: readString(params.cardId) ?? ctx.instanceId,
    attempt:
      readNumber(params.attempt) ?? readNumber(instanceState.attempt) ?? 1,
  });
  if (result.ok !== true) {
    throw new Error(result.message ?? "Failed to prepare isolated workspace");
  }
  // Record the prepared workspace on the card instance so its tasks can target
  // it via `workspacePath: "@instance:worktreePath"` and the merge-on-accept
  // path can discard it.
  ctx.patchWorkflowInstanceState({
    worktreePath: result.path,
    branchName: result.branchName,
  });
  // IsolatedWorkspaceResult is a plain data record; the operation runner
  // treats every operation output as Record<string, unknown>.
  return result as unknown as OperationResult;
}

// The engine's generic completion verification — the sibling of
// prepare_worktree. It checks that the isolated workspace (whose path and
// feature branch prepare_worktree recorded in workflowInstanceState) actually
// accumulated the kind of work the flow requires, so a flow declares its
// success contract instead of writing a git operation:
//   require: "committed" (default) — the feature branch is ahead of the
//     integration branch (real committed work).
//   require: "changes"            — any workspace delta, committed or not.
//   require: "none"               — always passes (the agent's word is the
//     contract; e.g. already_satisfied submissions the reviewer will verify).
// Throws on failure so the task errors and the flow's gates can react (bounded
// retry, escalation). Returns the evidence on success.
function wrapVerifyWorkspace(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const settings = readFlowSettings(ctx.flowConfig());
  const instanceState = ctx.workflowInstanceState();
  const workspacePath = readString(instanceState.worktreePath);
  const branchName = readString(instanceState.branchName);
  const require =
    readString(params.require) === "changes"
      ? "changes"
      : readString(params.require) === "none"
        ? "none"
        : "committed";

  if (require === "none") return { ok: true };
  if (!settings.integrationBranch) {
    throw new Error(
      "Flow config integrationBranch is required to verify workspace work"
    );
  }
  if (!workspacePath || !branchName) {
    throw new Error(
      "No prepared workspace recorded — run prepare_worktree before verify_workspace"
    );
  }
  if (!gitRepoAvailable(workspacePath)) {
    throw new Error(
      "Workspace is not a git repository — verify_workspace requires a repo-bound flow"
    );
  }

  const commitCount = Number(
    gitOptional(workspacePath, [
      "rev-list",
      "--count",
      `${settings.integrationBranch}..${branchName}`,
    ]) || 0
  );
  if (require === "committed" && commitCount < 1) {
    throw new Error(`No committed work on ${branchName}`);
  }
  if (require === "changes") {
    const dirty = gitOptional(workspacePath, ["status", "--porcelain"]) !== "";
    if (commitCount < 1 && !dirty) {
      throw new Error(`No changes in the workspace on ${branchName}`);
    }
  }
  return { ok: true, commitCount };
}

function gitRepoAvailable(workspacePath: string): boolean {
  // gitOptional returns "" on failure; a git-dir path is non-empty.
  return gitOptional(workspacePath, ["rev-parse", "--git-dir"]) !== "";
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
  signal?: AbortSignal,
  onDelta?: (delta: Record<string, unknown>) => void
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  let content = "";
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  return consumeSseStream(
    stream,
    (delta) => {
      onDelta?.(delta);
      if (delta.content && typeof delta.content === "string")
        content += delta.content;
      if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const tcr = tc as Record<string, unknown>;
          const index = typeof tcr.index === "number" ? tcr.index : undefined;
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
              arguments: typeof fn.arguments === "string" ? fn.arguments : "",
            });
          }
        }
      }
    },
    signal
  ).then(() => ({
    content,
    toolCalls: Array.from(toolCallsMap.values()).map(
      (tc) =>
        ({ id: tc.id, name: tc.name, arguments: tc.arguments }) as ToolCall
    ),
  }));
}

function createModelCaller(_engineTools: ToolDefinition[]) {
  return async (
    systemPrompt: string,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    onStatus?: (status: ModelCallStatus) => void
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
    // The request has been routed and the response is streaming: report the
    // chosen node, then flip to thinking/streaming as the deltas arrive.
    onStatus?.({
      stage: "dispatched",
      provider: result.provider ?? "",
      model: result.model ?? "",
    });
    const response = await consumeStream(result.stream, signal, (delta) => {
      if (typeof delta.reasoning_content === "string") {
        onStatus?.({ stage: "thinking" });
      } else if (typeof delta.content === "string" && delta.content !== "") {
        onStatus?.({ stage: "streaming" });
      }
    });
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
      taskOutputs: () => ctx.taskOutputs,
      patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
      workflowInstancesInState: ctx.workflowInstancesInState,
    };
  }

  // The flow's base directory — the bound repo root when present. Tools read
  // and write the flow's domain state relative to it (via the domain root).
  function readBasePath(ctx: TaskRunnerContext): string | undefined {
    const basePath = ctx.flowConfig.basePath;
    return typeof basePath === "string" && basePath !== ""
      ? basePath
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
          verify_workspace: wrapVerifyWorkspace,
          patch_flow_config: resolveAndPatchFlowConfig,
          commit_flow_state: commitFlowState,
          merge_branch: mergeBranch,
          validate_repo: validateRepo,
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
        patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
        workflowInstanceState: ctx.workflowInstanceState,
        patchRunningTaskStatus: ctx.patchRunningTaskStatus,
        createWorkflowInstance: ctx.createWorkflowInstance,
      }),
    aiChatRunner: (ctx) =>
      createAiChatRunner({
        modelCaller: createModelCaller(engineTools),
        toolDefinitions,
        toolExecutors,
        basePath: readBasePath(ctx),
        instanceId: ctx.instanceId,
        patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
        workflowInstanceState: ctx.workflowInstanceState,
        patchRunningTaskMessages: ctx.patchRunningTaskMessages,
        patchRunningTaskStatus: ctx.patchRunningTaskStatus,
        createWorkflowInstance: ctx.createWorkflowInstance,
      }),
    toolDefinitions,
    toolExecutors,
  };
}
