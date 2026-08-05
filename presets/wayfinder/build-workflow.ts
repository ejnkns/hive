/** @public — the build-phase module: the build workflow and its per-ticket build-item workflow. */
import { defineWorkflow } from "workflow-engine/workflow-types";
import {
  BUILD_REVIEWER_SYSTEM_PROMPT,
  BUILD_WORKER_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  SPECING_SYSTEM_PROMPT,
} from "./build-workflow/prompts";
import type { SessionTranscript } from "./ticket-workflow";

export { buildOperations } from "./build-workflow/operations";

// The worker's submit_work completion is an ai-chat session, so its task output
// is the transcript; the outcome lives in the submit_work tool call arguments.
function workerOutcome(output: unknown): "implemented" | "blocked" | undefined {
  if (output === null || typeof output !== "object") return undefined;
  const record = output as { toolCalls?: unknown };
  if (!Array.isArray(record.toolCalls)) return undefined;
  for (const call of record.toolCalls) {
    if (call === null || typeof call !== "object") continue;
    const toolCall = call as { name?: unknown; arguments?: unknown };
    if (toolCall.name !== "submit_work") continue;
    if (typeof toolCall.arguments !== "string") continue;
    try {
      const parsed = JSON.parse(toolCall.arguments) as {
        outcome?: unknown;
      };
      if (parsed.outcome === "implemented" || parsed.outcome === "blocked") {
        return parsed.outcome;
      }
    } catch {
      // malformed arguments; keep scanning
    }
  }
  return undefined;
}

// ─── Build workflow ─────────────────────────────────────────────────────

// A build ticket proposed by the planner. dependsOn references other proposed
// build ticket titles; ids do not exist until the fan-out, so the build-item
// workflow carries them as titles (mirroring queen-bee's plan-time wiring).
export type BuildTicket = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
};

// The planner's structured output (the parsed submit_build_plan arguments).
export type BuildPlan = {
  tickets: BuildTicket[];
};

export type BuildTaskOutputs = {
  specSession: SessionTranscript;
  finalizeSpec: string;
  plan: BuildPlan;
  persistPlan: string;
};

export type BuildStateId =
  | "specing"
  | "planned"
  | "proposed"
  | "finalizing"
  | "accepted";

export const buildWorkflow = defineWorkflow({
  id: "build",
  label: "Build",
  description:
    "The implementation phase: spec the collapsed decisions, plan tracer-bullet tickets, quiz the breakdown, then fan out build items.",
  instance: { title: "Build" },
  taskOutputs: {
    specSession: {} as SessionTranscript,
    finalizeSpec: {} as string,
    plan: {} as BuildPlan,
    persistPlan: {} as string,
  },
  workflowInstanceState: {} as {
    spec?: string;
    seams?: string[];
  },
  states: [
    {
      id: "specing",
      label: "Specing",
      category: "initial",
      description:
        "Synthesize the decision records into a spec and check the seams with the human.",
      tasks: [
        {
          id: "specSession",
          label: "Spec session",
          trigger: "auto",
          role: "ai-chat",
          tools: ["list_directory", "read_file", "search_code", "submit_spec"],
          startOnUserInput: true,
          systemPrompt: SPECING_SYSTEM_PROMPT,
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          completesRunningTask: true,
          // The spec must be recorded before planning: the planner is grounded
          // in it and finalizing persists it. Prevents reaching planned with no
          // spec.
          gate: (ctx) => {
            const spec = ctx.workflowInstanceState.spec;
            return (
              ctx.hasRunningTask &&
              typeof spec === "string" &&
              spec.trim() !== ""
            );
          },
          transitionTo: "planned",
        },
        {
          id: "restart",
          label: "Restart session",
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "specing",
        },
      ],
    },
    {
      id: "planned",
      label: "Planned",
      category: "active",
      tasks: [
        {
          id: "finalizeSpec",
          label: "Write spec document",
          trigger: "auto",
          role: "operation",
          operations: ["finalize_spec"],
          persist: { path: "spec.md" },
          render: { kind: "markdown" },
        },
        {
          id: "plan",
          label: "Run planner",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file", "search_code", "submit_build_plan"],
          completionTool: "submit_build_plan",
          // The spec is injected into the planner's first message; without it
          // the planner would propose tickets ungrounded.
          inputFromInstanceState: "spec",
          systemPrompt: PLANNER_SYSTEM_PROMPT,
          render: {
            kind: "cards",
            props: {
              items: "tickets",
              title: "title",
              description: "description",
              bullets: "acceptanceCriteria",
            },
          },
        },
      ],
      autoTransitions: [
        {
          to: "proposed",
          gate: (ctx) =>
            ctx.taskOutputs.finalizeSpec?.status === "success" &&
            ctx.taskOutputs.plan?.status === "success",
        },
      ],
    },
    {
      id: "proposed",
      label: "Proposed",
      category: "active",
      description:
        "The draft build plan — quiz the breakdown before the fan-out.",
      actions: [
        {
          id: "accept_proposal",
          label: "Accept and create build items",
          variant: "primary",
          gate: (ctx) =>
            !ctx.hasRunningTask && ctx.taskOutputs.plan?.status === "success",
          transitionTo: "finalizing",
        },
        {
          id: "request_revision",
          label: "Request revision",
          variant: "secondary",
          gate: (ctx) =>
            !ctx.hasRunningTask && ctx.taskOutputs.plan?.status === "success",
          transitionTo: "specing",
        },
      ],
    },
    {
      id: "finalizing",
      label: "Finalizing",
      category: "active",
      tasks: [
        {
          id: "persistPlan",
          label: "Persist build plan",
          trigger: "auto",
          role: "operation",
          operations: ["persist_build_plan"],
          persist: { path: "build-plan.md" },
          render: { kind: "markdown" },
        },
      ],
      autoTransitions: [
        {
          to: "accepted",
          gate: (ctx) => ctx.taskOutputs.persistPlan?.status === "success",
        },
      ],
    },
    {
      id: "accepted",
      label: "Accepted",
      category: "terminal",
      description: "The plan is accepted; build items fan out.",
    },
  ],
  initial: "specing",
  terminalStates: ["accepted"],
});

// ─── Build-item workflow ────────────────────────────────────────────────

export type BuildItemWorkflowInstanceState = {
  ticket: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
  };
  dependsOn: string[];
  worktreePath?: string;
  branchName?: string;
};

export type BuildItemTaskOutputs = {
  prepareWorkspace: { ok: boolean; path?: string; branchName?: string };
  // The ai-chat worker ends via submit_work but returns the transcript shape;
  // the outcome is extracted from the submit_work call (see workerOutcome).
  runAgent: SessionTranscript;
  review: {
    verdict: "approved" | "changes_requested";
    findings: Array<Record<string, unknown>>;
  };
  mergeWork: { ok: boolean; skipped?: boolean; revision?: string };
};

export type BuildItemStateId =
  | "ready"
  | "working"
  | "running"
  | "reviewing"
  | "accepting"
  | "done"
  | "unfulfillable";

export const buildItemWorkflow = defineWorkflow({
  id: "build-item",
  label: "Build Item",
  description:
    "One build ticket: worker implements in an isolated workspace, reviewer audits on two axes.",
  instance: { title: "ticket.title" },
  display: {
    fields: [
      {
        path: "ticket",
        label: "Build ticket",
        render: {
          kind: "card",
          props: {
            title: "title",
            description: "description",
            bullets: "acceptanceCriteria",
          },
        },
      },
    ],
  },
  taskOutputs: {
    prepareWorkspace: {} as { ok: boolean; path?: string; branchName?: string },
    runAgent: {} as SessionTranscript,
    review: {} as {
      verdict: "approved" | "changes_requested";
      findings: Array<Record<string, unknown>>;
    },
    mergeWork: {} as { ok: boolean; skipped?: boolean; revision?: string },
  },
  workflowInstanceState: {} as BuildItemWorkflowInstanceState,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [
        {
          id: "run",
          label: "Run build item",
          variant: "primary",
          maxWorkflowInstancesInTarget: 3,
          dependsOnState: "done",
          gate: (ctx) => !ctx.hasRunningTask,
          transitionTo: "working",
        },
      ],
    },
    {
      id: "working",
      label: "Working",
      category: "active",
      tasks: [
        {
          id: "prepareWorkspace",
          label: "Prepare workspace",
          trigger: "auto",
          role: "operation",
          operations: ["prepare_build_workspace"],
        },
      ],
      autoTransitions: [
        {
          to: "unfulfillable",
          gate: (ctx) => ctx.taskOutputs.prepareWorkspace?.status === "error",
        },
        {
          to: "running",
          gate: (ctx) => ctx.taskOutputs.prepareWorkspace?.status === "success",
        },
      ],
    },
    {
      id: "running",
      label: "Running",
      category: "active",
      tasks: [
        {
          id: "runAgent",
          label: "Run build worker",
          trigger: "auto",
          role: "ai-chat",
          workspacePath: "@instance:worktreePath",
          tools: [
            "read_file",
            "write_file",
            "run_command",
            "git_status",
            "git_diff",
            "git_log",
            "commit_work",
            "submit_work",
          ],
          // The ticket context is injected as the worker's first message.
          inputFromInstanceState: "ticket",
          completionTool: "submit_work",
          systemPrompt: BUILD_WORKER_SYSTEM_PROMPT,
        },
      ],
      autoTransitions: [
        {
          to: "unfulfillable",
          gate: (ctx) =>
            workerOutcome(ctx.taskOutputs.runAgent?.output) === "blocked",
        },
        {
          to: "reviewing",
          gate: (ctx) =>
            workerOutcome(ctx.taskOutputs.runAgent?.output) === "implemented",
        },
      ],
      actions: [
        {
          id: "retry",
          label: "Retry worker",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.runAgent?.status === "error",
          transitionTo: "running",
        },
      ],
    },
    {
      id: "reviewing",
      label: "Reviewing",
      category: "active",
      tasks: [
        {
          id: "review",
          label: "Run code review",
          trigger: "auto",
          role: "ai-task",
          workspacePath: "@instance:worktreePath",
          tools: [
            "read_file",
            "list_directory",
            "search_code",
            "git_diff",
            "git_log",
            "git_show",
            "submit_review",
          ],
          completionTool: "submit_review",
          systemPrompt: BUILD_REVIEWER_SYSTEM_PROMPT,
          render: { kind: "card", props: { title: "verdict" } },
        },
      ],
      autoTransitions: [
        {
          to: "accepting",
          gate: (ctx) => ctx.taskOutputs.review?.output?.verdict === "approved",
        },
        {
          to: "working",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
        },
      ],
      actions: [
        {
          id: "retry_review",
          label: "Retry review",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.review?.status === "error",
          transitionTo: "reviewing",
        },
      ],
    },
    {
      id: "accepting",
      label: "Accepting",
      category: "active",
      tasks: [
        {
          id: "mergeWork",
          label: "Merge accepted work",
          trigger: "auto",
          role: "operation",
          operations: ["merge_build_work"],
        },
      ],
      autoTransitions: [
        {
          to: "done",
          gate: (ctx) => ctx.taskOutputs.mergeWork?.status === "success",
        },
        {
          to: "reviewing",
          gate: (ctx) => ctx.taskOutputs.mergeWork?.status === "error",
        },
      ],
    },
    {
      id: "done",
      label: "Done",
      category: "terminal",
    },
    {
      id: "unfulfillable",
      label: "Unfulfillable",
      category: "error",
      actions: [
        {
          id: "retry",
          label: "Retry build item",
          variant: "primary",
          transitionTo: "working",
        },
        {
          id: "archive",
          label: "Archive",
          variant: "secondary",
          transitionTo: "done",
        },
      ],
    },
  ],
  initial: "ready",
  terminalStates: ["done"],
});
