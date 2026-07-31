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
import type {
  ActionVariant,
  RuntimeGateContext,
  RuntimeWorkflowConfig,
  StateCategory,
} from "workflow-engine/workflow-types";
import { queenBeeFlow } from "../../../queen-bee/flow";
import { createEngineRunners } from "./engine-bridge";

const DUMMY_TASK: TaskDefinition = { id: "", label: "", role: "" };
const runtimes = new Map<
  string,
  FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
>();
let _persistence: FlowPersistence | null = null;

export function setFlowPersistence(persistence: FlowPersistence): void {
  _persistence = persistence;
}

export function getFlowPersistence(): FlowPersistence | null {
  return _persistence;
}

export function registerFlowForTest(
  flowId: string,
  runtime: FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
): void {
  runtimes.set(flowId, runtime);
}

export function getFlowRuntime(
  flowId: string
):
  | FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
  | undefined {
  return runtimes.get(flowId);
}

export function getAllFlows(): Array<{
  id: string;
  repoPath: string;
  name: string;
  targetBranch: string;
  maxConcurrentWorkers: number;
}> {
  // Flow config arrives as unknown (persistence) or from the erased
  // FlowRuntimeAPI generic; the field reads below narrow known fields.
  const seen = new Set<string>();
  const result: Array<{
    id: string;
    repoPath: string;
    name: string;
    targetBranch: string;
    maxConcurrentWorkers: number;
  }> = [];

  // Flows from persistence
  if (_persistence) {
    for (const { flowId, config } of _persistence.loadAllFlows()) {
      seen.add(flowId);
      const cfg = config as Record<string, unknown>;
      result.push({
        id: flowId,
        repoPath: (cfg.repoPath as string) ?? "",
        name: (cfg.name as string) ?? flowId,
        targetBranch: (cfg.targetBranch as string) ?? "main",
        maxConcurrentWorkers: (cfg.maxConcurrentWorkers as number) ?? 3,
      });
    }
  }

  // Flows registered directly (e.g. for tests)
  for (const [flowId, runtime] of runtimes) {
    if (seen.has(flowId)) continue;
    const cfg = runtime.getFlowConfig();
    result.push({
      id: flowId,
      repoPath: (cfg.repoPath as string) ?? "",
      name: (cfg.name as string) ?? flowId,
      targetBranch: (cfg.targetBranch as string) ?? "main",
      maxConcurrentWorkers: (cfg.maxConcurrentWorkers as number) ?? 3,
    });
  }

  return result.filter((f) => f.repoPath);
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

// ── Data-driven workflow definition types ──

export type DataDrivenStateDef = {
  id: string;
  label: string;
  description?: string;
  category?: StateCategory;
  tasks?: Array<{
    id: string;
    label: string;
    trigger: "auto" | "manual";
    role: "ai-task" | "ai-chat" | "operation";
    systemPrompt?: string;
    completionTool?: string;
  }>;
  autoTransitions?: Array<{
    to: string;
    onTaskStatus?: { taskId: string; status: "success" | "error" };
  }>;
  actions?: Array<{
    id: string;
    label: string;
    variant?: ActionVariant;
    transitionTo: string;
  }>;
};

export type DataDrivenWorkflowDef = {
  id: string;
  label: string;
  description?: string;
  states: DataDrivenStateDef[];
  initial: string;
  terminalStates: string[];
};

// ── Converter ──

function convertDataDrivenDef(
  def: DataDrivenWorkflowDef
): RuntimeWorkflowConfig {
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    taskOutputs: {},
    states: def.states.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      category: s.category,
      tasks: s.tasks?.map((t) => ({
        id: t.id,
        label: t.label,
        trigger: t.trigger,
        role: t.role,
        systemPrompt: t.systemPrompt,
        completionTool: t.completionTool,
      })),
      autoTransitions: s.autoTransitions?.map((t) => {
        const statusFilter = t.onTaskStatus;
        return {
          to: t.to,
          gate:
            statusFilter !== undefined
              ? (ctx: RuntimeGateContext) => {
                  const outcome = ctx.taskOutputs[statusFilter.taskId];
                  return (
                    outcome !== undefined &&
                    "status" in outcome &&
                    outcome.status === statusFilter.status
                  );
                }
              : () => true,
        };
      }),
      actions: s.actions?.map((a) => ({
        id: a.id,
        label: a.label,
        variant: a.variant ?? "default",
        transitionTo: a.transitionTo,
      })),
    })),
    initial: def.initial,
    terminalStates: def.terminalStates,
  };
}

export function createFlowFromDefinition(
  flowId: string,
  def: DataDrivenWorkflowDef,
  persistence: FlowPersistence,
  config?: Record<string, unknown>
): FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>> {
  const runners = createEngineRunners();
  const workflowDefs = [convertDataDrivenDef(def)];
  const flowConfig: Record<string, unknown> = {
    name: def.label,
    ...config,
    workflowDefinitions: workflowDefs,
  };

  const runtime = createFlowRuntime(
    flowId,
    workflowDefs,
    [],
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

// ── Workflow definition resolver ──

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

// ── Flow lifecycle ──

export function createFlowOnLink(
  flowId: string,
  repoPath: string,
  persistence: FlowPersistence,
  config?: Record<string, unknown>
): FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>> {
  const runners = createEngineRunners();
  const flowConfig: Record<string, unknown> = {
    repoPath,
    name: config?.name ?? flowId,
    maxConcurrentWorkers: 3,
    targetBranch: "main",
    ...config,
  };
  const resolvedWorkflows = resolveWorkflowConfigs(flowConfig);
  const runtime = createFlowRuntime(
    flowId,
    resolvedWorkflows,
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

  // Seed the requirements workflow instance (starts in "no_session")
  runtime.addWorkflowInstance("requirements", {
    workflowInstanceState: { projectId: flowId, repoPath },
  });

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
): FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>> | null {
  // flowConfig comes from persistence as unknown; its runtime shape is
  // guaranteed by the code that wrote it (createFlowOnLink / createFlowFromDefinition)
  const cfg = flowConfig as Record<string, unknown>;
  const storedDefs = cfg.workflowDefinitions as
    | RuntimeWorkflowConfig[]
    | undefined;

  if (flowId !== queenBeeFlow.id && !storedDefs) return null;

  const runners = createEngineRunners();
  // same persistence-boundary narrowing as above
  const resolvedWorkflows =
    storedDefs ?? resolveWorkflowConfigs(flowConfig as Record<string, unknown>);
  const runtime = createFlowRuntime(
    flowId,
    resolvedWorkflows,
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
