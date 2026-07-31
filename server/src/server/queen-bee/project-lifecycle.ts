/** @private — queen-bee project creation, git integration, and definition. */

import { execFileSync, execSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  checkIntegrationReadiness,
  ensureIntegrationBranch,
  fastForwardTargetBranch,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { RuntimeWorkflowConfig } from "workflow-engine/workflow-types";
import { queenBeeFlow } from "../../../../queen-bee/flow";
import {
  createFlow,
  type FlowDefinition,
  getFlowPersistence,
} from "../flow-registry";

const DUMMY_TASK: TaskDefinition = { id: "", label: "", role: "" };

// ── Queen-bee flow definition (external config, registered at boot) ──

function resolveWorkflowConfigs(
  config: Record<string, unknown>
): RuntimeWorkflowConfig[] {
  const maxWorkers = readMaxWorkers(config);
  const systemPrompts = readSystemPrompts(config);

  return queenBeeFlow.workflows.map((wf) => ({
    ...wf,
    states: wf.states.map((state) => ({
      ...state,
      actions: state.actions?.map((action) => {
        if (
          action.id === "run" &&
          wf.id === "cards" &&
          action.maxWorkflowInstancesInTarget !== undefined
        ) {
          return { ...action, maxWorkflowInstancesInTarget: maxWorkers };
        }
        return action;
      }),
      tasks: state.tasks?.map((task) => {
        if (task.systemPrompt && systemPrompts?.[task.id]) {
          return { ...task, systemPrompt: systemPrompts[task.id] };
        }
        return task;
      }),
    })),
  }));
}

function readMaxWorkers(config: Record<string, unknown>): number {
  const raw = config.maxConcurrentWorkers;
  return typeof raw === "number" ? raw : 3;
}

function readSystemPrompts(
  config: Record<string, unknown>
): Record<string, string> | undefined {
  const raw = config.systemPrompts;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

export const queenBeeFlowDefinition: FlowDefinition = {
  id: queenBeeFlow.id,
  label: queenBeeFlow.label,
  buildWorkflows: resolveWorkflowConfigs,
  edges: queenBeeFlow.edges,
};

// ── Project creation ──

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
  const id = makeUnique(slug, persistence);
  const targetBranch = inferTargetBranch(resolved);

  createFlow(id, queenBeeFlow.id, persistence, {
    repoPath: resolved,
    name: projectName,
    maxConcurrentWorkers: 3,
    targetBranch,
  });

  return { id, repoPath: resolved, name: projectName, targetBranch };
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

// ── Git helpers ──

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

function makeUnique(slug: string, persistence: FlowPersistence): string {
  const persistenceOrGlobal = getFlowPersistence() ?? persistence;
  const existing = persistenceOrGlobal.loadAllFlows();
  const ids = new Set(existing.map((f) => f.flowId));
  if (!ids.has(slug)) return slug;
  let n = 2;
  while (ids.has(`${slug}-${n}`)) {
    n++;
  }
  return `${slug}-${n}`;
}
