// Test harness for the wayfinder preset: builds a createFlowRuntime with mock
// model callers so ai-chat/ai-task sessions run deterministically while
// operations and tools use the real engine wiring.

import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import type { ToolCall } from "workflow-engine/runners";
import {
  type AiChatModelCaller,
  type AiTaskModelCaller,
  createAiChatRunner,
  createAiTaskRunner,
} from "workflow-engine/runners";
import type { TaskRunnerContext } from "workflow-engine/task-runner";
import { createEngineRunners } from "../../engine-bridge.ts";
import {
  wayfinderCompiled as wayfinderFlow,
  wayfinderWorkflows,
} from "../compiled-presets.ts";

export type MakeRuntimeOptions = {
  basePath?: string;
  workspacesBasePath?: string;
  aiChatCaller: AiChatModelCaller;
  aiTaskCaller: AiTaskModelCaller;
};

export function makeWayfinderRuntime(options: MakeRuntimeOptions) {
  const flowConfig: Record<string, unknown> = {
    definitionId: "wayfinder",
    name: "Wayfinder",
    ...(options.basePath !== undefined ? { basePath: options.basePath } : {}),
    ...(options.workspacesBasePath !== undefined
      ? { workspacesBasePath: options.workspacesBasePath }
      : {}),
  };
  const baseRunners = createEngineRunners({
    tools: wayfinderFlow.tools,
    operations: wayfinderFlow.operations,
  });
  return createFlowRuntime(
    "wayfinder-test",
    wayfinderWorkflows,
    wayfinderFlow.edges,
    {
      operation: baseRunners.operationRunner,
      "ai-chat": (ctx) =>
        createAiChatRunner({
          modelCaller: options.aiChatCaller,
          toolDefinitions: baseRunners.toolDefinitions,
          toolExecutors: baseRunners.toolExecutors,
          basePath: readBasePath(ctx),
          instanceId: ctx.instanceId,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          workflowInstanceState: ctx.workflowInstanceState,
          patchRunningTaskMessages: ctx.patchRunningTaskMessages,
          createWorkflowInstance: ctx.createWorkflowInstance,
        }),
      "ai-task": (ctx) =>
        createAiTaskRunner({
          modelCaller: options.aiTaskCaller,
          toolDefinitions: baseRunners.toolDefinitions,
          toolExecutors: baseRunners.toolExecutors,
          basePath: readBasePath(ctx),
          instanceId: ctx.instanceId,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          workflowInstanceState: ctx.workflowInstanceState,
          createWorkflowInstance: ctx.createWorkflowInstance,
        }),
    },
    flowConfig
  );
}

function readBasePath(ctx: TaskRunnerContext): string | undefined {
  const basePath = ctx.flowConfig.basePath;
  return typeof basePath === "string" && basePath !== "" ? basePath : undefined;
}

export async function waitFor(
  condition: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// A caller that never calls tools; used where the session under test does not
// reach the model (e.g. the wrong workflow's runner is wired for a different
// test's runtime).
export function idleModelCaller(): AiChatModelCaller {
  return async () => ({ content: "idle" });
}

// ─── Mock model callers ─────────────────────────────────────────────────

type ModelResponse = { content: string; toolCalls?: ToolCall[] };

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return { id: crypto.randomUUID(), name, arguments: JSON.stringify(args) };
}

export function chatRespond(
  ...steps: Array<() => ModelResponse>
): AiChatModelCaller {
  let index = 0;
  return async () => {
    const step = steps[Math.min(index, steps.length - 1)];
    index++;
    return step();
  };
}

export function chatToolCall(
  name: string,
  args: Record<string, unknown>
): () => ModelResponse {
  return () => ({
    content: `Calling ${name}`,
    toolCalls: [toolCall(name, args)],
  });
}

export function chatReply(content: string): () => ModelResponse {
  return () => ({ content });
}

// A one-shot ai-task caller that submits one completion tool.
export function taskCompleter(
  name: string,
  args: Record<string, unknown>
): AiTaskModelCaller {
  return async () => ({
    content: "done",
    toolCalls: [toolCall(name, args)],
  });
}

// The charting session caller: the naming session records the destination via
// submit_map; the frontier session just chats. Dispatch on the system prompt.
export function chartingCaller(): AiChatModelCaller {
  return chatRespond(
    () => ({
      content: "The destination is settled",
      toolCalls: [
        toolCall("submit_map", {
          destination: "Ship the code editor",
          notes: "TypeScript; prioritise correctness over speed",
        }),
      ],
    }),
    chatReply("Map recorded — press Done when the destination reads right."),
    chatReply("The frontier is charted — add tickets to populate it.")
  );
}
