// The onboarding workflow's ensure_integration_branch operation, referenced by
// the queen-bee blueprint.

import {
  defineOperations,
  ensureIntegrationBranch,
  gitOptional,
  type OperationContext,
  readFlowSettings,
  resolveBasePath,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { OnboardingState } from "../types.ts";

type OperationResult = Record<string, unknown>;

function ensureIntegrationBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<OnboardingState>
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
  ctx.patchFlowState({ targetBranch });
  return { ...result, targetBranch };
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

export const ensure_integration_branchOperations =
  defineOperations<OnboardingState>({
    ensure_integration_branch: ensureIntegrationBranchOp,
  });
