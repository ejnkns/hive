/** @private — only imported by create-standard-tool-registry.ts */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFlowSettings } from "../../read-flow-settings.ts";
import { readWorkflowAttempt } from "../../shared/read-workflow-attempt.ts";
import type { TaskDefinition } from "../../task-runner.ts";
import type { OperationContext } from "../create-operation-runner.ts";
import { gitSucceeds, runGit } from "../git-command.ts";

// Branch names and the domain root come from flow config, never hardcoded.
// integrationBranch/branchPrefix/domainDir have no engine defaults — a flow
// must declare them (queen-bee wires them in a later phase). Ops THROW on
// logical failure so the task errors and gates inspect taskOutputs.<t>.status
// rather than an ok field; successful ops return their result directly.

// ─── public operation exports ──────────────────────────────────────────

export function ensureIntegrationBranch(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx?: OperationContext
): Record<string, unknown> {
  const basePath = params.basePath as string;
  const integrationBranch = readIntegrationBranch(ctx);
  if (!integrationBranch) {
    throw new Error("Flow config integrationBranch is not set");
  }
  if (!hasBranch(basePath, integrationBranch)) {
    runGit(basePath, ["branch", integrationBranch, "HEAD"]);
  }
  return {
    ok: true,
    branchName: integrationBranch,
    revision: runGit(basePath, ["rev-parse", integrationBranch]),
  };
}

function checkIntegrationReadiness(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx?: OperationContext
): Record<string, unknown> {
  const basePath = params.basePath as string;
  const targetBranch = params.targetBranch as string;
  const integrationBranch = readIntegrationBranch(ctx);
  if (!integrationBranch) {
    throw new Error("Flow config integrationBranch is not set");
  }
  const integration = runGit(basePath, ["rev-parse", integrationBranch]);
  const targetRev = runGit(basePath, ["rev-parse", targetBranch]);
  const ahead = Number(
    runGit(basePath, [
      "rev-list",
      "--count",
      `${targetBranch}..${integrationBranch}`,
    ])
  );
  const behind = Number(
    runGit(basePath, [
      "rev-list",
      "--count",
      `${integrationBranch}..${targetBranch}`,
    ])
  );
  const integrated = gitSucceeds(basePath, [
    "merge-base",
    "--is-ancestor",
    integrationBranch,
    targetBranch,
  ]);
  const ready = gitSucceeds(basePath, [
    "merge-base",
    "--is-ancestor",
    targetBranch,
    integrationBranch,
  ]);
  const state = integrated ? "integrated" : ready ? "ready" : "diverged";
  return {
    ok: true,
    integrationBranch,
    integrationRevision: integration,
    targetBranch,
    targetRevision: targetRev,
    state,
    ahead,
    behind,
    canIntegrate: state === "ready" && ahead > 0,
  };
}

export function fastForwardTargetBranch(
  task: TaskDefinition,
  params: Record<string, unknown>,
  ctx?: OperationContext
): Record<string, unknown> {
  const basePath = params.basePath as string;
  const targetBranch = params.targetBranch as string;
  const integrationBranch = readIntegrationBranch(ctx);
  if (!integrationBranch) {
    throw new Error("Flow config integrationBranch is not set");
  }
  const result = checkIntegrationReadiness(task, params, ctx);
  if (result.state === "integrated") {
    return { ok: true, alreadyIntegrated: true };
  }
  if (result.state === "diverged") {
    throw new Error(`${targetBranch} and ${integrationBranch} have diverged`);
  }

  const checkedOutPath = branchWorktreePath(basePath, targetBranch);
  if (checkedOutPath) {
    // The flow writes its domain state into this checkout, and commit_flow_state
    // records it on the integration branch — leaving identical untracked copies
    // that a fast-forward bringing those files in would refuse to overwrite
    // ("untracked working tree files would be overwritten by merge"). The flow
    // must not block itself: clear the untracked domain files that are
    // byte-identical to the integration branch (lossless — the merge restores
    // them). Anything else stays, and git's own merge safety refuses to
    // overwrite real local changes.
    clearFlowDomainState(checkedOutPath, ctx);
    runGit(checkedOutPath, ["merge", "--ff-only", integrationBranch]);
  } else {
    runGit(basePath, [
      "update-ref",
      `refs/heads/${targetBranch}`,
      result.integrationRevision as string,
      result.targetRevision as string,
    ]);
  }
  return { ok: true, revision: runGit(basePath, ["rev-parse", targetBranch]) };
}

// Commits the declared domainDir (under basePath) to integrationBranch.
// Explicit, never automatic: persisting writes the working-tree file; the flow
// author decides when a state becomes a checkpoint by running this op. Safe
// when no repo is bound (no-op); requires integrationBranch + domainDir in
// flow config for a git-bound flow.
export function commitFlowState(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
): Record<string, unknown> {
  const { basePath, domainDir, integrationBranch } = readFlowSettings(
    ctx.flowConfig()
  );
  if (!basePath) return { ok: true, skipped: true };
  if (!domainDir) throw new Error("Flow config domainDir is not set");
  if (!integrationBranch) {
    throw new Error("Flow config integrationBranch is not set");
  }

  const message =
    typeof params.message === "string" ? params.message : "commit flow state";
  const sourceDir = join(basePath, domainDir);
  if (!existsSync(sourceDir)) {
    return {
      ok: true,
      unchanged: true,
      revision: runGit(basePath, ["rev-parse", integrationBranch]),
    };
  }
  if (!hasBranch(basePath, integrationBranch)) {
    runGit(basePath, ["branch", integrationBranch, "HEAD"]);
  }

  if (runGit(basePath, ["branch", "--show-current"]) === integrationBranch) {
    runGit(basePath, ["add", "-A", "--", domainDir]);
    if (!gitSucceeds(basePath, ["diff", "--cached", "--quiet"])) {
      runGit(basePath, ["commit", "-m", message]);
    }
    return {
      ok: true,
      revision: runGit(basePath, ["rev-parse", integrationBranch]),
    };
  }

  const worktreePath = mkdtempSync(join(tmpdir(), "hive-commit-"));
  runGit(basePath, ["worktree", "add", worktreePath, integrationBranch]);
  try {
    const targetDir = join(worktreePath, domainDir);
    mkdirSync(targetDir, { recursive: true });
    cpSync(sourceDir, targetDir, { recursive: true });
    runGit(worktreePath, ["add", "-A", "--", domainDir]);
    if (!gitSucceeds(worktreePath, ["diff", "--cached", "--quiet"])) {
      runGit(worktreePath, ["commit", "-m", message]);
    }
    return {
      ok: true,
      revision: runGit(basePath, ["rev-parse", integrationBranch]),
    };
  } finally {
    runGit(basePath, ["worktree", "remove", worktreePath, "--force"]);
  }
}

// Generic repo validation the engine can run on any bound repo: the base path
// must exist, be a git repository, and have at least one commit. Throws when
// the repo is not usable so the task errors.
export function validateRepo(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
): Record<string, unknown> {
  const configuredBase = readFlowSettings(ctx.flowConfig()).basePath;
  const rawBasePath =
    (typeof params.basePath === "string" ? params.basePath : undefined) ??
    configuredBase;
  if (!rawBasePath) throw new Error("No basePath to validate");

  // basePath is absolute by construction (creation normalization); a relative
  // value is a bug in the caller, never a reason to re-anchor on the cwd.
  if (!rawBasePath.startsWith("/")) {
    throw new Error(
      `basePath must be absolute (got "${rawBasePath}") — the engine never resolves against the daemon's cwd`
    );
  }
  const basePath = rawBasePath;
  if (!existsSync(basePath)) {
    throw new Error(`Path does not exist: ${basePath}`);
  }
  runGit(basePath, ["rev-parse", "--is-inside-work-tree"]);
  runGit(basePath, ["rev-parse", "HEAD"]);
  return { ok: true, basePath };
}

// Merges a card's feature branch into the config-driven integration branch
// with a no-ff merge (so the merge commit is visible), then discards the card's
// worktree (from workflowInstanceState.worktreePath, when present) and deletes
// the feature branch. The branch is derived from the instance as
// `${branchPrefix}${instanceId}/attempt-${attempt}` (consistent with
// validate_completion) or taken from params.branchName. Safe no-op when no repo
// is bound; requires integrationBranch + branchPrefix for a git-bound flow.
export function mergeBranch(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
): Record<string, unknown> {
  const { basePath, integrationBranch, branchPrefix } = readFlowSettings(
    ctx.flowConfig()
  );
  if (!basePath) return { ok: true, skipped: true };
  if (!integrationBranch || !branchPrefix) {
    throw new Error(
      "Flow config integrationBranch and branchPrefix are required"
    );
  }
  const attempt = readWorkflowAttempt(ctx.workflowInstanceState());
  const branchName =
    typeof params.branchName === "string" && params.branchName !== ""
      ? params.branchName
      : `${branchPrefix}${ctx.instanceId}/attempt-${attempt}`;

  if (!hasBranch(basePath, integrationBranch)) {
    runGit(basePath, ["branch", integrationBranch, "HEAD"]);
  }
  if (!hasBranch(basePath, branchName)) {
    throw new Error(`No work branch ${branchName} found`);
  }

  const worktreePath = mkdtempSync(join(tmpdir(), "hive-merge-"));
  runGit(basePath, ["worktree", "add", worktreePath, integrationBranch]);
  try {
    runGit(worktreePath, [
      "merge",
      "--no-ff",
      "-m",
      `Merge ${branchName}`,
      branchName,
    ]);
  } finally {
    runGit(basePath, ["worktree", "remove", worktreePath, "--force"]);
  }

  discardCardWorktree(ctx, basePath);
  runGit(basePath, ["branch", "-D", branchName]);

  return {
    ok: true,
    revision: runGit(basePath, ["rev-parse", integrationBranch]),
    merged: branchName,
  };
}

// ─── private helpers ────────────────────────────────────────────────────

function readIntegrationBranch(
  ctx: OperationContext | undefined
): string | undefined {
  if (!ctx) return undefined;
  return readFlowSettings(ctx.flowConfig()).integrationBranch;
}

// Removes the flow's own domain-state artifacts from a target-branch checkout
// before a fast-forward: untracked files under flowConfig.domainDir whose
// content is byte-identical to the integration branch's committed version are
// safe to drop (the merge restores them). Files that differ — or that the
// integration branch does not have — stay, and git's merge safety refuses to
// overwrite them, surfacing as the task error.
function clearFlowDomainState(
  checkedOutPath: string,
  ctx: OperationContext | undefined
): void {
  const domainDir = ctx
    ? readFlowSettings(ctx.flowConfig()).domainDir
    : undefined;
  const integrationBranch = readIntegrationBranch(ctx);
  if (!domainDir || !integrationBranch) return;

  const untracked = runGit(checkedOutPath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    domainDir,
  ])
    .split("\n")
    .filter(Boolean);

  for (const rel of untracked) {
    const identical = gitSucceeds(checkedOutPath, [
      "diff",
      "--quiet",
      `${integrationBranch}:${rel}`,
      rel,
    ]);
    if (identical) {
      rmSync(join(checkedOutPath, rel), { force: true });
    }
  }
}

function hasBranch(basePath: string, branch: string): boolean {
  try {
    runGit(basePath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

function branchWorktreePath(basePath: string, branch: string): string | null {
  const recs = runGit(basePath, ["worktree", "list", "--porcelain"]).split(
    "\n\n"
  );
  const ref = `branch refs/heads/${branch}`;
  for (const rec of recs) {
    if (!rec.includes(ref)) continue;
    const line = rec.split("\n").find((l) => l.startsWith("worktree "));
    if (line) return line.slice("worktree ".length);
  }
  return null;
}

// The card's worktree was recorded as an absolute path by prepare_worktree;
// discard it best-effort so a stale or already-removed path cannot fail the
// merge. The feature branch is only deleted after this succeeds.
function discardCardWorktree(ctx: OperationContext, basePath: string): void {
  const raw = ctx.workflowInstanceState().worktreePath;
  if (typeof raw !== "string" || raw === "") return;
  gitSucceeds(basePath, ["worktree", "remove", raw, "--force"]);
}
