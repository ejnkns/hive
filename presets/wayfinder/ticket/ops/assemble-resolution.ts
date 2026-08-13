// The ticket workflow's assemble_resolution operation, referenced by the wayfinder blueprint.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { readString } from "../../shared/read.ts";
import type { TicketState } from "../types.ts";

// The resolving task ids whose outputs can carry a resolution: a completion
// tool call (the parsed arguments ARE the ai-task output, or an ai-chat
// surfaces them as output.completion), or a Done-ended ai-chat transcript
// whose last generated completion-tool call carries the resolution.
const RESOLUTION_TASK_IDS = [
  "prototypeSession",
  "grillSession",
  "taskSession",
  "taskHitlSession",
] as const;

// The generated completion tool name per resolving task (the renderer derives
// it from the workflow id + task id).
function completionToolOf(taskId: string): string {
  return `ticket_${taskId}_complete`;
}

export type ResolutionOutput = {
  decision: string;
  gist: string;
  artifactPath?: string;
};

// Builds the persisted decision record: a markdown entry under the domain root
// that the build phase's specing agent reads. The resolution comes from the
// completed resolving task — either the parsed completion arguments (ai-task)
// or the ai-chat output's `completion`, or, when the session ended via the
// human's Done action, recovered from the last completion-tool call in the
// transcript. For research tickets the resolution is the research findings
// output.
function assembleResolutionOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<TicketState>
): string {
  const state = ctx.workflowInstanceState();
  const title = readString(state.title) ?? ctx.instanceId;
  const question = readString(state.question) ?? "";
  const resolution = readResolution(ctx);
  return [
    `# Decision — ${title}`,
    "",
    `Ticket: ${ctx.instanceId}`,
    `Type: ${state.type ?? "unknown"}`,
    question !== "" ? `Question: ${question}` : "",
    "",
    "## Decision",
    resolution.decision,
    "",
    "## Gist",
    resolution.gist,
    ...(resolution.artifactPath !== undefined && resolution.artifactPath !== ""
      ? ["", `Artifact: ${resolution.artifactPath}`]
      : []),
    "",
  ].join("\n");
}

// Resolves the resolution carried by whichever resolving task completed. A
// completion-ended task carries the parsed arguments (ai-task output or
// ai-chat output.completion); a Done-ended transcript may carry a generated
// completion-tool call; a research ticket's findings serve as the decision.
function readResolution(ctx: OperationContext<TicketState>): ResolutionOutput {
  const direct = readDirectResolution(ctx);
  if (direct !== undefined) return direct;

  const research = ctx.taskOutputs().research as
    | { status?: string; output?: { findings?: unknown; question?: unknown } }
    | undefined;
  if (research?.status === "success") {
    const findings = readString(research.output?.findings);
    const question = readString(research.output?.question) ?? "";
    if (findings !== undefined) {
      return {
        decision: findings,
        gist: `Research report on: ${question}`,
      };
    }
  }

  throw new Error("No resolution to assemble");
}

function readDirectResolution(
  ctx: OperationContext<TicketState>
): ResolutionOutput | undefined {
  const taskOutputs = ctx.taskOutputs() as Record<
    string,
    { status?: string; output?: unknown } | undefined
  >;
  for (const taskId of RESOLUTION_TASK_IDS as readonly string[]) {
    const output = taskOutputs[taskId]?.output;
    if (output === undefined || output === null || typeof output !== "object") {
      continue;
    }
    // ai-chat: the parsed completion arguments surface as output.completion
    // next to the transcript.
    const completion = (output as { completion?: unknown }).completion;
    if (completion !== null && typeof completion === "object") {
      const fromCompletion = resolutionOf(completion);
      if (fromCompletion !== undefined) return fromCompletion;
    }
    const record = output as { messages?: unknown };
    const fromRecord = resolutionOf(output);
    if (fromRecord !== undefined) return fromRecord;
    const recovered = recoverFromTranscript(record.messages, taskId);
    if (recovered !== undefined) return recovered;
  }
  return undefined;
}

function resolutionOf(value: unknown): ResolutionOutput | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as {
    decision?: unknown;
    gist?: unknown;
    artifactPath?: unknown;
  };
  if (typeof record.decision !== "string" || record.decision === "") {
    return undefined;
  }
  return {
    decision: record.decision,
    gist: readString(record.gist) ?? "",
    ...(typeof record.artifactPath === "string"
      ? { artifactPath: record.artifactPath }
      : {}),
  };
}

// A Done-ended session's output is the transcript; the resolution lives in the
// last generated completion-tool call the agent made before the human pressed
// Done.
function recoverFromTranscript(
  messages: unknown,
  taskId: string
): ResolutionOutput | undefined {
  if (!Array.isArray(messages)) return undefined;
  let found: ResolutionOutput | undefined;
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const entry = message as { role?: unknown; tool_calls?: unknown };
    if (entry.role !== "assistant") continue;
    if (!Array.isArray(entry.tool_calls)) continue;
    for (const call of entry.tool_calls) {
      if (call === null || typeof call !== "object") continue;
      const toolCall = call as {
        function?: { name?: unknown; arguments?: unknown };
      };
      if (toolCall.function?.name !== completionToolOf(taskId)) continue;
      const rawArguments = toolCall.function.arguments;
      if (typeof rawArguments !== "string") continue;
      try {
        const parsed = JSON.parse(rawArguments) as {
          decision?: unknown;
          gist?: unknown;
          artifactPath?: unknown;
        };
        const recovered = resolutionOf(parsed);
        if (recovered !== undefined) found = recovered;
      } catch {
        // malformed arguments; keep scanning
      }
    }
  }
  return found;
}

export const assemble_resolutionOperations = defineOperations<TicketState>({
  assemble_resolution: assembleResolutionOp,
});
