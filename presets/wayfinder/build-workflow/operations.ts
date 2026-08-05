// Build-phase workflow internals; import via build-workflow.ts.

import { homedir } from "node:os";
import { join } from "node:path";
import type { OperationContext, OperationFn } from "workflow-engine/runners";
import {
  mergeBranch,
  prepareIsolatedWorkspace,
  readFlowSettings,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { BuildPlan, BuildTicket } from "../build-workflow";

export const buildOperations: Record<string, OperationFn> = {
  finalize_spec: finalizeSpecOp,
  persist_build_plan: persistBuildPlanOp,
  prepare_build_workspace: prepareBuildWorkspaceOp,
  merge_build_work: mergeBuildWorkOp,
};

// The spec is the specing session's running output, recorded in the instance
// state by the submit_spec tool. Finalizing returns the text; the task persists
// it as spec.md. As a recovery for sessions where the instance state lost the
// spec, it extracts the document from the session's submit_spec tool call
// arguments — never the agent's conversational reply text.
function finalizeSpecOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): string {
  const raw = ctx.workflowInstanceState().spec;
  const spec = typeof raw === "string" ? raw : "";
  if (spec !== "") return spec;

  const specSession = ctx.taskOutputs().specSession as
    | { status?: string; output?: { messages?: unknown } }
    | undefined;
  const fromToolCall =
    specSession?.status === "success"
      ? extractSpecFromToolCalls(specSession.output?.messages)
      : undefined;
  if (fromToolCall !== undefined) return fromToolCall;

  throw new Error("No spec to finalize");
}

// The specing agent records the spec by calling submit_spec; the document lives
// in that call's arguments, never in the agent's chat reply. Recover the last
// such call's content from the session message history.
function extractSpecFromToolCalls(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  let found: string | undefined;
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
      if (toolCall.function?.name !== "submit_spec") continue;
      const rawArguments = toolCall.function.arguments;
      if (typeof rawArguments !== "string") continue;
      try {
        const parsed = JSON.parse(rawArguments) as { spec?: unknown };
        if (typeof parsed.spec === "string" && parsed.spec !== "") {
          found = parsed.spec;
        }
      } catch {
        // malformed arguments; keep scanning
      }
    }
  }
  return found;
}

// The accepted plan persists as a readable markdown document under the domain
// root, recording the tickets the build-item fan-out creates.
function persistBuildPlanOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): string {
  const output = ctx.taskOutputs().plan as
    | { status?: string; output?: BuildPlan }
    | undefined;
  const tickets = output?.output?.tickets;
  if (output?.status !== "success" || !Array.isArray(tickets)) {
    throw new Error("No build plan to persist");
  }
  const sections = tickets.flatMap((ticket) => buildTicketSection(ticket));
  return ["# Build Plan", "", ...sections, ""].join("\n");
}

function buildTicketSection(ticket: BuildTicket): string[] {
  return [
    `## ${ticket.title}`,
    "",
    ticket.description,
    "",
    "Acceptance criteria:",
    ...(ticket.acceptanceCriteria.length > 0
      ? ticket.acceptanceCriteria.map((criterion) => `- ${criterion}`)
      : ["- (none)"]),
    ...(ticket.dependsOn.length > 0
      ? ["", `Blocks on: ${ticket.dependsOn.join(", ")}`]
      : []),
    "",
  ];
}

// A repo-bound build workspace is a git worktree on a feature branch when the
// flow declares the git identity (integrationBranch/branchPrefix); without one
// — a planning-only flow, or a repo-bound flow with no git config — it is a
// plain sandbox directory. The worker's edits land there either way; accepted
// work stays in the workspace (see merge_build_work).
function prepareBuildWorkspaceOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): Record<string, unknown> {
  const result = prepareWorkspace(ctx);
  if (result.ok !== true) {
    throw new Error(result.message ?? "Failed to prepare build workspace");
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

// Accepted build work merges into the flow's integration branch only when the
// flow declares the git identity (basePath + integrationBranch + branchPrefix);
// otherwise it stays in the workspace for the user to integrate manually.
function mergeBuildWorkOp(
  task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
): Record<string, unknown> {
  const settings = readFlowSettings(ctx.flowConfig());
  if (
    settings.basePath === undefined ||
    settings.integrationBranch === undefined ||
    settings.branchPrefix === undefined
  ) {
    return { ok: true, skipped: true };
  }
  return mergeBranch(task, params, ctx);
}

function prepareWorkspace(ctx: OperationContext) {
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
