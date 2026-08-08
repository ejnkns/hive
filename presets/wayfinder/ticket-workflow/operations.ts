// Ticket workflow internals; import via ticket-workflow.ts.

import { homedir } from "node:os";
import { join } from "node:path";
import {
  type OperationContext,
  prepareIsolatedWorkspace,
  readFlowSettings,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import {
  RESOLUTION_TASK_IDS,
  type ResolutionOutput,
  type TicketItemState,
  type TicketType,
} from "../ticket-workflow";

// flow.ts binds the state type and merges this into the preset's registry.
export const ticketOperations = {
  normalize_ticket: normalizeTicketOp,
  prepare_prototype_workspace: preparePrototypeWorkspaceOp,
  assemble_resolution: assembleResolutionOp,
  persist_research_findings: persistResearchFindingsOp,
};

const TICKET_TYPES: readonly TicketType[] = [
  "research",
  "prototype",
  "grilling",
  "task",
];

// Creates a ticket with a sharp shape regardless of how it was born: the Add
// ticket / Add fog entry forms collect loose strings (dependsOn as a
// comma-separated id list, a type the human may have typed loosely, fog entries
// with only a brief), while agent-created tickets via create_instance carry
// proper arrays. Normalizing once in fog lets the claim gates and the engine's
// dependsOnState backstop read a stable shape.
function normalizeTicketOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<TicketItemState>
): Record<string, unknown> {
  const state = ctx.workflowInstanceState();
  const rawType = readString(state.type)?.toLowerCase().trim();
  // TICKET_TYPES.some narrows rawType to one of the four literals, so the cast
  // only ever narrows a string already proven to be a TicketType.
  const type: TicketType =
    rawType !== undefined &&
    TICKET_TYPES.some((ticketType) => ticketType === rawType)
      ? (rawType as TicketType)
      : "grilling";
  const title =
    readString(state.title) ??
    readString(state.brief) ??
    readString(state.question) ??
    "Untitled ticket";
  const question =
    readString(state.question) ?? readString(state.brief) ?? title;
  const dependsOn = readDependsOn(state.dependsOn);
  ctx.patchWorkflowInstanceState({ title, question, type, dependsOn });
  return { ok: true, type, dependsOn };
}

// A repo-bound prototype workspace is a git worktree on a throwaway branch when
// the flow declares the git identity (integrationBranch/branchPrefix); without
// one — a planning-only flow, or a repo-bound flow with no git config — it is a
// plain sandbox directory. The artifact stays in the prepared workspace and the
// resolution links its path.
function preparePrototypeWorkspaceOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<TicketItemState>
): Record<string, unknown> {
  const result = prepareWorkspace(ctx);
  if (result.ok !== true) {
    throw new Error(result.message ?? "Failed to prepare prototype workspace");
  }
  ctx.patchWorkflowInstanceState({
    worktreePath: result.path,
    branchName: result.branchName,
  });
  return {
    ok: true,
    path: result.path,
    branchName: result.branchName,
    baseCommit: result.baseCommit,
  };
}

// Builds the persisted decision record: a markdown entry under the domain root
// that the build phase's specing agent reads. The resolution comes from the
// completed resolving task — either the parsed submit_resolution arguments or,
// when the session ended via the human's Done action, recovered from the last
// submit_resolution call in the transcript. For research tickets the resolution
// is the research findings output.
function assembleResolutionOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<TicketItemState>
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

// Research findings persist as their own cited file so the build phase can cite
// the report independently of the decision record.
function persistResearchFindingsOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): string {
  const output = ctx.taskOutputs().research as
    | {
        status?: string;
        output?: { question?: unknown; findings?: unknown; sources?: unknown };
      }
    | undefined;
  const question = readString(output?.output?.question) ?? "";
  const findings = readString(output?.output?.findings);
  if (output?.status !== "success" || findings === undefined) {
    throw new Error("No research findings to persist");
  }
  const sources = readStringArray(output.output?.sources);
  return [
    `# Research — ${question}`,
    "",
    findings,
    "",
    "## Sources",
    ...(sources.length > 0
      ? sources.map((source) => `- ${source}`)
      : ["(none recorded)"]),
    "",
  ].join("\n");
}

// ─── helpers ───────────────────────────────────────────────────────────

// Resolves the resolution carried by whichever resolving task completed. The
// recording submit_resolution tool writes it into the instance state first; a
// completion-ended task carries the parsed arguments as its output; a
// Done-ended transcript may carry a submit_resolution call; a research ticket's
// findings serve as the decision.
function readResolution(
  ctx: OperationContext<TicketItemState>
): ResolutionOutput {
  const state = ctx.workflowInstanceState();
  const recorded = state.resolution;
  if (recorded !== null && typeof recorded === "object") {
    const record = recorded;
    if (typeof record.decision === "string" && record.decision !== "") {
      return {
        decision: record.decision,
        gist: readString(record.gist) ?? "",
        ...(typeof record.artifactPath === "string"
          ? { artifactPath: record.artifactPath }
          : {}),
      };
    }
  }

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
  ctx: OperationContext
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
    const record = output as Partial<ResolutionOutput> & { messages?: unknown };
    if (typeof record.decision === "string" && record.decision !== "") {
      return {
        decision: record.decision,
        gist: readString(record.gist) ?? "",
        ...(typeof record.artifactPath === "string"
          ? { artifactPath: record.artifactPath }
          : {}),
      };
    }
    const recovered = recoverFromTranscript(record.messages);
    if (recovered !== undefined) return recovered;
  }
  return undefined;
}

// A Done-ended session's output is the transcript; the resolution lives in the
// last submit_resolution call the agent made before the human pressed Done.
function recoverFromTranscript(
  messages: unknown
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
      if (toolCall.function?.name !== "submit_resolution") continue;
      const rawArguments = toolCall.function.arguments;
      if (typeof rawArguments !== "string") continue;
      try {
        const parsed = JSON.parse(rawArguments) as {
          decision?: unknown;
          gist?: unknown;
          artifactPath?: unknown;
        };
        if (typeof parsed.decision === "string" && parsed.decision !== "") {
          found = {
            decision: parsed.decision,
            gist: readString(parsed.gist) ?? "",
            ...(typeof parsed.artifactPath === "string"
              ? { artifactPath: parsed.artifactPath }
              : {}),
          };
        }
      } catch {
        // malformed arguments; keep scanning
      }
    }
  }
  return found;
}

// Reads only flow config, so it accepts any workflow's typed context.
function prepareWorkspace<TState extends Record<string, unknown>>(
  ctx: OperationContext<TState>
) {
  const settings = readFlowSettings(ctx.flowConfig());
  const workspacesBasePath =
    readString(ctx.flowConfig().workspacesBasePath) ??
    join(homedir(), ".hive", "workspaces");
  const gitReady =
    settings.basePath !== undefined &&
    settings.integrationBranch !== undefined &&
    settings.branchPrefix !== undefined;
  return prepareIsolatedWorkspace({
    basePath: gitReady ? settings.basePath : undefined,
    workspacesBasePath,
    integrationBranch: settings.integrationBranch,
    branchPrefix: settings.branchPrefix,
    projectId: ctx.workflowId,
    cardId: ctx.instanceId,
    attempt: 1,
  });
}

function readDependsOn(value: unknown): string[] {
  if (typeof value === "string" && value !== "") {
    return value
      .split(/[,\s]+/)
      .map((id) => id.trim())
      .filter((id) => id !== "");
  }
  return readStringArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
