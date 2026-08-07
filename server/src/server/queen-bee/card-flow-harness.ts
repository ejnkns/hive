// Shared harness for driving the queen-bee cards workflow with scripted agent
// behaviors: real engine ops, real git worktrees, mock model callers. Used by
// the domain-persistence tests and the behavior-library invariant suite.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFlowRuntime,
  type FlowPersistence,
} from "workflow-engine/create-flow-runtime";
import {
  type AiChatModelCaller,
  type AiTaskModelCaller,
  createAiChatRunner,
  createAiTaskRunner,
  type TaskRunnerContext,
} from "workflow-engine/runners";
import {
  queenBeeFlow,
  queenBeeOperations,
} from "../../../../presets/queen-bee/flow";
import { createEngineRunners } from "../engine-bridge";

export type CardFlowOptions = {
  basePath: string;
  workspacesBasePath: string;
  workerCaller: AiChatModelCaller;
  reviewerCaller: AiTaskModelCaller;
  persistence?: FlowPersistence;
};

export function makeCardRuntime(options: CardFlowOptions) {
  const flowConfig = {
    definitionId: "queen-bee",
    name: "Project",
    basePath: options.basePath,
    integrationBranch: "queen-bee-main",
    branchPrefix: "queen-bee/",
    domainDir: ".queen-bee",
    workspacesBasePath: options.workspacesBasePath,
  };
  const baseRunners = createEngineRunners({
    tools: queenBeeFlow.tools,
    operations: queenBeeOperations,
  });
  return createFlowRuntime(
    "project",
    queenBeeFlow.workflows,
    queenBeeFlow.edges,
    {
      operation: baseRunners.operationRunner,
      "ai-chat": (ctx) =>
        createAiChatRunner({
          modelCaller: options.workerCaller,
          toolDefinitions: baseRunners.toolDefinitions,
          toolExecutors: baseRunners.toolExecutors,
          basePath: readConfiguredBasePath(ctx),
          instanceId: ctx.instanceId,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          workflowInstanceState: ctx.workflowInstanceState,
        }),
      "ai-task": (ctx) =>
        createAiTaskRunner({
          modelCaller: options.reviewerCaller,
          toolDefinitions: baseRunners.toolDefinitions,
          toolExecutors: baseRunners.toolExecutors,
          basePath: readConfiguredBasePath(ctx),
          instanceId: ctx.instanceId,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          workflowInstanceState: ctx.workflowInstanceState,
        }),
    },
    flowConfig,
    {},
    options.persistence
  );
}

function readConfiguredBasePath(ctx: TaskRunnerContext): string | undefined {
  const basePath = ctx.flowConfig.basePath;
  return typeof basePath === "string" && basePath !== "" ? basePath : undefined;
}

// A fresh git repo (main + queen-bee-main) to run a card against.
export function setupCardRepo(): { root: string; basePath: string } {
  const root = mkdtempSync(join(tmpdir(), "hive-card-flow-"));
  const basePath = join(root, "repo");
  mkdirSync(basePath);
  execSync("git init -b main", { cwd: basePath, encoding: "utf-8" });
  execSync("git config user.email test@example.com", {
    cwd: basePath,
    encoding: "utf-8",
  });
  execSync("git config user.name Test", { cwd: basePath, encoding: "utf-8" });
  execSync("git commit --allow-empty -m initial", {
    cwd: basePath,
    encoding: "utf-8",
  });
  execSync("git branch queen-bee-main", { cwd: basePath, encoding: "utf-8" });
  return { root, basePath };
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

// ── Agent behavior library ──
//
// Each behavior is a scripted model caller reproducing a real agent outcome.
// The invariant suite runs every behavior and asserts the card terminates in a
// bounded, human-actionable state — never an infinite loop.

// The honest worker: reads, writes, commits, submits as implemented.
export function honestWorker(): AiChatModelCaller {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls === 1) {
      return {
        content: "Implementing",
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            arguments: JSON.stringify({
              path: "feature.txt",
              content: "implemented",
            }),
          },
        ],
      };
    }
    if (calls === 2) {
      return {
        content: "Committing",
        toolCalls: [
          {
            id: "w2",
            name: "commit_work",
            arguments: JSON.stringify({
              message: "implement feature",
              paths: ["feature.txt"],
            }),
          },
        ],
      };
    }
    return {
      content: "Submitting",
      toolCalls: [
        {
          id: "w3",
          name: "submit_work",
          arguments: JSON.stringify({ outcome: "implemented" }),
        },
      ],
    };
  };
}

// The worker that finds the behavior already present: submits without a
// commit, so the card must route to review (no validation) and the reviewer
// decides.
export function alreadySatisfiedWorker(): AiChatModelCaller {
  return async () => ({
    content: "Already implemented by the merged dependency",
    toolCalls: [
      {
        id: "s1",
        name: "submit_work",
        arguments: JSON.stringify({
          outcome: "already_satisfied",
          noChangeRationale: "Behavior already present",
        }),
      },
    ],
  });
}

// The worker that submits as implemented but never commits: the committed-work
// validation must fail, and the engine's error counter must escalate the card
// to unfulfillable instead of looping.
export function noCommitWorker(): AiChatModelCaller {
  return async () => ({
    content: "Nothing to change",
    toolCalls: [
      {
        id: "s1",
        name: "submit_work",
        arguments: JSON.stringify({ outcome: "implemented" }),
      },
    ],
  });
}

// The worker that calls a tool the registry does not know: the session must
// surface the failure to the model and still complete (or escalate), never
// hang.
export function toolAbuseWorker(): AiChatModelCaller {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls === 1) {
      return {
        content: "Doing something weird",
        toolCalls: [
          {
            id: "x1",
            name: "nonexistent_tool",
            arguments: JSON.stringify({}),
          },
        ],
      };
    }
    return {
      content: "Submitting anyway",
      toolCalls: [
        {
          id: "s1",
          name: "submit_work",
          arguments: JSON.stringify({ outcome: "implemented" }),
        },
      ],
    };
  };
}

// The reviewer that approves any claim.
export function approvingReviewer(): AiTaskModelCaller {
  return async () => ({
    content: "The change looks good",
    toolCalls: [
      {
        id: "r1",
        name: "submit_review",
        arguments: JSON.stringify({
          verdict: "approved",
          findings: [],
          verificationAssessment: { status: "sufficient", notes: "ok" },
        }),
      },
    ],
  });
}

// The reviewer that rejects any claim (requests changes).
export function rejectingReviewer(): AiTaskModelCaller {
  return async () => ({
    content: "Not good enough",
    toolCalls: [
      {
        id: "r1",
        name: "submit_review",
        arguments: JSON.stringify({
          verdict: "changes_requested",
          findings: [
            {
              requirement: "works",
              severity: "blocking",
              finding: "does not work",
              recommendation: "make it work",
            },
          ],
        }),
      },
    ],
  });
}

export function cleanupCardRepo(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

// A ready card instance with the standard fixture spec.
export function addReadyCard(runtime: ReturnType<typeof makeCardRuntime>) {
  const controller = runtime.addWorkflowInstance("cards", {
    workflowInstanceState: {
      attempt: 1,
      cardSpec: {
        title: "Fixture card",
        description: "Do the thing",
        acceptanceCriteria: ["works"],
        dependsOn: [],
      },
    },
  });
  controller.dispatchAction("run");
  return controller;
}

export type { AiChatModelCaller, AiTaskModelCaller };
