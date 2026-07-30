/** @public — manages FlowRuntime instances accessible to routes */

import { execFileSync, execSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  createFlowRuntime,
  type FlowRuntimeAPI,
} from "workflow-engine/create-flow-runtime";
import {
  checkIntegrationReadiness,
  ensureIntegrationBranch,
  fastForwardTargetBranch,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { queenBeeFlow } from "../../../queen-bee/flow";
import { createEngineRunners } from "./engine-bridge";

const DUMMY_TASK: TaskDefinition = { id: "", label: "", role: "" };
const runtimes = new Map<string, FlowRuntimeAPI<any, any>>();
let _persistence: FlowPersistence | null = null;

export function setFlowPersistence(persistence: FlowPersistence): void {
  _persistence = persistence;
}

export function registerFlowForTest(
  flowId: string,
  runtime: FlowRuntimeAPI<any, any>
): void {
  runtimes.set(flowId, runtime);
}

export function getFlowRuntime(
  flowId: string
): FlowRuntimeAPI<any, any> | undefined {
  return runtimes.get(flowId);
}

export function getAllFlows(): Array<{
  id: string;
  repoPath: string;
  name: string;
  targetBranch: string;
  maxConcurrentWorkers: number;
}> {
  if (!_persistence) return [];
  return _persistence
    .loadAllFlows()
    .map(({ flowId, config }) => {
      const cfg = config as Record<string, unknown>;
      return {
        id: flowId,
        repoPath: (cfg.repoPath as string) ?? "",
        name: (cfg.name as string) ?? flowId,
        targetBranch: (cfg.targetBranch as string) ?? "main",
        maxConcurrentWorkers: (cfg.maxConcurrentWorkers as number) ?? 3,
      };
    })
    .filter((f) => f.repoPath);
}

export function unlinkFlow(flowId: string): void {
  runtimes.delete(flowId);
}

// ── Project creation helpers ──

export function createFlowForRepo(
  repoPath: string,
  persistence: FlowPersistence,
  name?: string
): { id: string; repoPath: string; name: string; targetBranch: string } {
  const resolved = resolveRepoPath(repoPath);
  validateGitRepo(resolved);
  ensureRepoInitialized(resolved);

  const result = ensureIntegrationBranch(DUMMY_TASK, {
    repoPath: resolved,
    ok: true,
  });
  if (!result.ok) throw new Error("Failed to create integration branch");

  const projectName = name ?? resolved.split("/").pop() ?? resolved;
  const slug = slugify(projectName);
  const id = makeUnique(slug);
  const targetBranch = inferTargetBranch(resolved);

  createFlowOnLink(id, resolved, persistence, {
    name: projectName,
    targetBranch,
  });

  return { id, repoPath: resolved, name: projectName, targetBranch };
}

function resolveRepoPath(input: string): string {
  if (input.startsWith("/")) return input;
  return join(process.cwd(), input);
}

function validateGitRepo(repoPath: string): void {
  try {
    const stat = statSync(join(repoPath, ".git"));
    if (!stat.isDirectory()) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Not a git repository"))
      throw err;
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}

function ensureRepoInitialized(repoPath: string): void {
  try {
    execSync("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    });
    return;
  } catch {
    // no commits yet
  }
  try {
    writeFileSync(
      join(repoPath, "README.md"),
      `# ${repoPath.split("/").pop()}\n`
    );
    execSync("git add -A", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
    });
    execSync('git commit -m "Initial commit"', {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
    });
  } catch {
    try {
      execSync('git commit --allow-empty -m "Initial commit"', {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5_000,
      });
    } catch {
      // ignore
    }
  }
}

function inferTargetBranch(repoPath: string): string {
  const current = gitOptional(repoPath, ["branch", "--show-current"]);
  if (current && current !== "hive-main") return current;

  const branches = gitOptional(repoPath, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .split("\n")
    .filter(
      (b) =>
        b && b !== "hive-main" && !b.startsWith("hive/") && !b.startsWith("qb/")
    );
  const preferred =
    branches.find((b) => b === "main") ??
    branches.find((b) => b === "master") ??
    branches[0];
  if (!preferred) {
    throw new Error("Project requires a target branch for Hive integration");
  }
  return preferred;
}

function gitOptional(repoPath: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function makeUnique(slug: string): string {
  if (_persistence) {
    const existing = _persistence.loadAllFlows();
    const ids = new Set(existing.map((f) => f.flowId));
    if (!ids.has(slug)) return slug;
    let n = 2;
    while (ids.has(`${slug}-${n}`)) {
      n++;
    }
    return `${slug}-${n}`;
  }
  return slug;
}

// ── Integration operations ──

export function integrationStatus(
  repoPath: string,
  targetBranch: string
): Record<string, unknown> {
  return checkIntegrationReadiness(DUMMY_TASK, { repoPath, targetBranch });
}

export function integrationIntegrate(
  repoPath: string,
  targetBranch: string
): Record<string, unknown> {
  return fastForwardTargetBranch(DUMMY_TASK, { repoPath, targetBranch });
}

// ── Flow lifecycle ──

export function createFlowOnLink(
  flowId: string,
  repoPath: string,
  persistence: FlowPersistence,
  config?: Record<string, unknown>
): FlowRuntimeAPI<any, any> {
  const runners = createEngineRunners();
  const flowConfig: Record<string, unknown> = {
    repoPath,
    name: config?.name ?? flowId,
    maxConcurrentWorkers: 3,
    targetBranch: "main",
    ...config,
  };
  const runtime = createFlowRuntime(
    flowId,
    queenBeeFlow.workflows,
    queenBeeFlow.edges,
    {
      operation: runners.operationRunner,
      "ai-task": runners.aiTaskRunner,
      "ai-chat": runners.aiChatRunner,
    },
    flowConfig,
    {},
    persistence
  );

  persistence.saveFlow(flowId, flowConfig, {});
  runtimes.set(flowId, runtime);
  return runtime;
}

export function rehydrateFlow(
  persistence: FlowPersistence,
  flowId: string,
  flowConfig: unknown,
  flowState: unknown,
  instances: Array<{
    workflowId: string;
    state: Record<string, unknown>;
  }>
): FlowRuntimeAPI<any, any> | null {
  if (flowId !== queenBeeFlow.id) return null;

  const runners = createEngineRunners();
  const runtime = createFlowRuntime(
    flowId,
    queenBeeFlow.workflows,
    queenBeeFlow.edges,
    {
      operation: runners.operationRunner,
      "ai-task": runners.aiTaskRunner,
      "ai-chat": runners.aiChatRunner,
    },
    flowConfig as Record<string, unknown>,
    flowState as Record<string, unknown>,
    persistence
  );

  for (const instance of instances) {
    const restoredState = {
      ...instance.state,
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };
    const controller = runtime.addWorkflowInstance(
      instance.workflowId,
      restoredState
    );
    if (instance.state.hasRunningTask) {
      controller.startAutoTasks();
    }
  }

  runtimes.set(flowId, runtime);
  return runtime;
}
