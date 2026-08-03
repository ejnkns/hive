// Onboarding workflow internals; import via onboarding-workflow.ts.

import type { OperationContext, OperationFn } from "workflow-engine/runners";
import {
  ensureIntegrationBranch,
  gitOptional,
  readFlowSettings,
  resolveBasePath,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";

export const onboardingOperations: Record<string, OperationFn> = {
  ensure_integration_branch: ensureIntegrationBranchOp,
  write_project_metadata: writeProjectMetadata,
};

type OperationResult = Record<string, unknown>;

function ensureIntegrationBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const basePath = resolveBasePath(ctx.flowConfig());
  const { integrationBranch, branchPrefix } = readFlowSettings(
    ctx.flowConfig()
  );
  if (!integrationBranch || !branchPrefix) {
    throw new Error(
      "Flow config integrationBranch and branchPrefix are required"
    );
  }
  const result = ensureIntegrationBranch(task, { basePath }, ctx);
  const targetBranch = inferTargetBranch(
    basePath,
    integrationBranch,
    branchPrefix
  );
  ctx.patchFlowConfig({ basePath, targetBranch });
  return { ...result, targetBranch };
}

function writeProjectMetadata(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const config = ctx.flowConfig();
  const basePath = resolveBasePath(ctx.flowConfig());
  const name =
    typeof config.name === "string"
      ? config.name
      : (basePath.split("/").pop() ?? basePath);
  const targetBranch =
    typeof config.targetBranch === "string" ? config.targetBranch : "main";
  return { name, basePath, targetBranch };
}

// The user's development branch, excluding the queen-bee integration branch and
// its feature-branch prefix. Falls back to main/master or the most recent other
// branch.
function inferTargetBranch(
  basePath: string,
  integrationBranch: string,
  branchPrefix: string
): string {
  const isProjectBranch = (branch: string): boolean =>
    branch === integrationBranch || branch.startsWith(branchPrefix);
  const current = gitOptional(basePath, ["branch", "--show-current"]);
  if (current && !isProjectBranch(current)) return current;

  const branches = gitOptional(basePath, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .split("\n")
    .filter((branch) => branch && !isProjectBranch(branch));
  const preferred =
    branches.find((branch) => branch === "main") ??
    branches.find((branch) => branch === "master") ??
    branches[0];
  if (!preferred) {
    throw new Error("Project requires a target branch for Hive integration");
  }
  return preferred;
}
