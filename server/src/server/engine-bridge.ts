/** @public — one-time engine wiring. Creates configured runners with server-side dependencies. */

import type { Readable } from "node:stream";
import type {
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
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { handleChatCompletion } from "./proxy/handle-chat-completion";

// ─── QB-specific tool definitions ──────────────────────────────────────

const submitWorkDef: ToolDefinition = {
  type: "function",
  function: {
    name: "submit_work",
    description:
      "Submit committed work to the deterministic Completion Gate. This must be the only tool call in the response.",
    parameters: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          description: "Either 'implemented' or 'already_satisfied'.",
        },
        verificationCallIds: {
          type: "array",
          description:
            "Successful run_command tool call IDs that verified the current commit.",
          items: { type: "string" },
        },
        verificationNotRunReason: { type: "string" },
        noChangeRationale: { type: "string" },
      },
      required: ["outcome"],
    },
  },
};

const submitReviewDef: ToolDefinition = {
  type: "function",
  function: {
    name: "submit_review",
    description:
      "Submit the terminal structured review. This must be the only tool call in the response.",
    parameters: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["approved", "changes_requested"],
        },
        recommendedApproach: {
          type: "string",
          enum: ["update", "new"],
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: { type: "string", enum: ["blocking", "warning"] },
              requirement: { type: "string" },
              evidence: { type: "string" },
              recommendation: { type: "string" },
            },
            required: ["severity", "requirement", "evidence", "recommendation"],
          },
        },
        verificationAssessment: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["sufficient", "insufficient"] },
            notes: { type: "string" },
          },
          required: ["status", "notes"],
        },
      },
      required: ["verdict", "findings", "verificationAssessment"],
    },
  },
};

const updateDraftDef: ToolDefinition = {
  type: "function",
  function: {
    name: "update_requirements_draft",
    description:
      "Replace the session's proposed requirements draft. This never mutates the canonical requirements document.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The full requirements document in markdown format.",
        },
      },
      required: ["content"],
    },
  },
};

// ─── QB-specific tool executors ────────────────────────────────────────

const submitWorkExec: ToolExecutor = async (call, _ctx) => {
  return {
    toolCallId: call.id,
    content: "Work submitted for review",
    isError: false,
  };
};

const submitReviewExec: ToolExecutor = async (call, _ctx) => {
  return { toolCallId: call.id, content: "Review submitted", isError: false };
};

const updateDraftExec: ToolExecutor = async (call, _ctx) => {
  return {
    toolCallId: call.id,
    content: "Requirements draft updated",
    isError: false,
  };
};

// ─── QB-specific operations ───────────────────────────────────────────

type OperationResult = Record<string, unknown>;

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

function validateCompletion(
  _task: TaskDefinition,
  _params: Record<string, unknown>
): OperationResult {
  return { ok: true };
}

function buildReviewPackage(
  _task: TaskDefinition,
  _params: Record<string, unknown>
): OperationResult {
  return { packageId: "placeholder" };
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

export type EngineRunners = {
  operationRunner: ReturnType<typeof createOperationRunner>;
  aiTaskRunner: ReturnType<typeof createAiTaskRunner>;
  aiChatRunner: ReturnType<typeof createAiChatRunner>;
  toolDefinitions: Record<string, ToolDefinition>;
  toolExecutors: Record<string, ToolExecutor>;
};

export function createEngineRunners(): EngineRunners {
  const standardDefs = createStandardToolDefinitions();
  const standardExecs = createStandardToolRegistry();

  const toolDefinitions: Record<string, ToolDefinition> = {
    ...standardDefs,
    submit_work: submitWorkDef,
    submit_review: submitReviewDef,
    update_requirements_draft: updateDraftDef,
  };

  const toolExecutors: Record<string, ToolExecutor> = {
    ...standardExecs,
    submit_work: submitWorkExec,
    submit_review: submitReviewExec,
    update_requirements_draft: updateDraftExec,
  };

  const engineTools = Object.values(toolDefinitions);

  return {
    operationRunner: createOperationRunner({
      operations: {
        prepare_worktree: wrapPrepareWorktree,
        validate_completion: validateCompletion,
        build_review_package: buildReviewPackage,
      },
    }),
    aiTaskRunner: createAiTaskRunner({
      modelCaller: createModelCaller(engineTools),
      toolDefinitions,
      toolExecutors,
    }),
    aiChatRunner: createAiChatRunner({
      modelCaller: createModelCaller(engineTools),
      toolDefinitions,
      toolExecutors,
    }),
    toolDefinitions,
    toolExecutors,
  };
}
