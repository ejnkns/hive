/** @private — only imported by create-standard-tool-registry.ts */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import type { TaskDefinition } from "../../task-runner";

// ─── public operation exports ──────────────────────────────────────────

export function ensureIntegrationBranch(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  const repoPath = params.repoPath as string;
  try {
    if (!hasBranch(repoPath, "hive-main")) {
      git(repoPath, ["branch", "hive-main", "HEAD"]);
    }
    return {
      ok: true,
      branchName: "hive-main",
      revision: git(repoPath, ["rev-parse", "hive-main"]),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function checkIntegrationReadiness(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    const repoPath = params.repoPath as string;
    const targetBranch = params.targetBranch as string;
    const integration = git(repoPath, ["rev-parse", "hive-main"]);
    const targetRev = git(repoPath, ["rev-parse", targetBranch]);
    const ahead = Number(
      git(repoPath, ["rev-list", "--count", `${targetBranch}..hive-main`])
    );
    const behind = Number(
      git(repoPath, ["rev-list", "--count", `hive-main..${targetBranch}`])
    );
    const integrated = gitSucceeds(repoPath, [
      "merge-base",
      "--is-ancestor",
      "hive-main",
      targetBranch,
    ]);
    const ready = gitSucceeds(repoPath, [
      "merge-base",
      "--is-ancestor",
      targetBranch,
      "hive-main",
    ]);
    const state = integrated ? "integrated" : ready ? "ready" : "diverged";
    return {
      ok: true,
      integrationBranch: "hive-main",
      integrationRevision: integration,
      targetBranch,
      targetRevision: targetRev,
      state,
      ahead,
      behind,
      canIntegrate: state === "ready" && ahead > 0,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function fastForwardTargetBranch(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    const repoPath = params.repoPath as string;
    const targetBranch = params.targetBranch as string;
    const result = checkIntegrationReadiness(_task, params);
    if (!result.ok) return result;
    if (result.state === "integrated")
      return { ok: true, alreadyIntegrated: true };
    if (result.state === "diverged")
      return {
        ok: false,
        error: `${targetBranch} and hive-main have diverged`,
      };

    const checkedOutPath = branchWorktreePath(repoPath, targetBranch);
    if (checkedOutPath) {
      if (git(checkedOutPath, ["status", "--porcelain"])) {
        return { ok: false, error: `${targetBranch} has uncommitted changes` };
      }
      git(checkedOutPath, ["merge", "--ff-only", "hive-main"]);
    } else {
      git(repoPath, [
        "update-ref",
        `refs/heads/${targetBranch}`,
        result.integrationRevision as string,
        result.targetRevision as string,
      ]);
    }
    return { ok: true, revision: git(repoPath, ["rev-parse", targetBranch]) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function compareIntegrationCommits(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    const repoPath = params.repoPath as string;
    const branchName = params.branchName as string;
    const reviewedHead = params.reviewedHead as string;
    const reviewedIntegrationRevision =
      params.reviewedIntegrationRevision as string;
    const worktreePath = params.worktreePath as string;
    const integrationRevision = git(repoPath, ["rev-parse", "hive-main"]);
    const branchHead = git(repoPath, ["rev-parse", branchName]);

    if (branchHead !== reviewedHead) {
      return {
        state: "branch_changed",
        canAccept: false,
        canRefresh: false,
        message: "Branch changed since review",
      };
    }
    if (
      worktreePath &&
      existsSync(worktreePath) &&
      git(worktreePath, ["status", "--porcelain"])
    ) {
      return {
        state: "dirty",
        canAccept: false,
        canRefresh: false,
        message: "Worktree has uncommitted changes",
      };
    }
    if (integrationRevision === reviewedIntegrationRevision) {
      return {
        state: "current",
        canAccept: true,
        canRefresh: false,
        message: "Work is current",
      };
    }

    const mergeResult = analyzeMerge(repoPath, branchName);
    if (mergeResult.state === "mergeable") {
      return {
        state: "stale",
        canAccept: false,
        canRefresh: true,
        message: "Review is stale; refresh",
      };
    }
    return {
      state: "conflicted",
      canAccept: false,
      canRefresh: false,
      conflictingFiles: mergeResult.files ?? [],
      message: "Conflicts with integration branch",
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function discardWorktree(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  const worktreePath = params.worktreePath as string;
  const repoPath = params.repoPath as string;
  if (!worktreePath) return { ok: false, error: "worktreePath is required" };

  const workspaceProjectDir = resolve(
    (params.workspacesBasePath as string) ?? "",
    "workspaces",
    (params.projectId as string) ?? ""
  );
  if (workspaceProjectDir) {
    const rel = relative(workspaceProjectDir, resolve(worktreePath));
    if (!rel || rel.startsWith("..") || rel.includes("/../")) {
      return { ok: false, error: "Unsafe worktree path" };
    }
  }

  if (!existsSync(worktreePath))
    return { ok: true, message: "Worktree does not exist" };
  try {
    git(repoPath, ["worktree", "remove", worktreePath, "--force"]);
    return { ok: true, message: "Worktree removed" };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function writeFlowSnapshot(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    const repoPath = params.repoPath as string;
    const proposalId = params.proposalId as string;
    const projectId = params.projectId as string;
    const workspacesBasePath = params.workspacesBasePath as string;
    const basePath = (params.basePath as string) || repoPath;

    ensureIntegrationBranch(_task, { repoPath });
    const worktree = acquireWorktree(repoPath, projectId, workspacesBasePath);
    try {
      if (worktree.temporary) {
        copyFileSafe(basePath, worktree.path, ".hive/requirements.md");
        copyFileSafe(basePath, worktree.path, ".hive/board.json");
        copyFileSafe(basePath, worktree.path, ".hive/project.json");
        const sourceCards = join(basePath, ".hive", "cards");
        if (existsSync(sourceCards)) {
          cpSync(sourceCards, join(worktree.path, ".hive", "cards"), {
            recursive: true,
          });
        }
      }
      git(worktree.path, ["add", "-A", "--", ".hive"]);
      git(worktree.path, ["add", "-f", "--", ".hive/requirements.md"]);
      if (!gitSucceeds(worktree.path, ["diff", "--cached", "--quiet"])) {
        git(worktree.path, [
          "commit",
          "-m",
          `hive: apply planning proposal ${proposalId}`,
        ]);
      }
      return { ok: true, revision: git(repoPath, ["rev-parse", "hive-main"]) };
    } finally {
      if (worktree.temporary) {
        git(repoPath, ["worktree", "remove", worktree.path, "--force"]);
      }
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function writeFlowArtifacts(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    const repoPath = params.repoPath as string;
    const files = params.files as Record<string, string> | undefined;
    if (!files) return { ok: false, error: "files is required" };

    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(repoPath, relativePath);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content, "utf-8");
    }
    git(repoPath, ["add", ...Object.keys(files)]);
    git(repoPath, [
      "commit",
      "-m",
      (params.message as string) ?? "hive: update flow artifacts",
    ]);
    return { ok: true, revision: git(repoPath, ["rev-parse", "HEAD"]) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function mergeToIntegrationBranch(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    const repoPath = params.repoPath as string;
    const branchName = params.branchName as string;
    const message = (params.commitMessage as string) ?? `hive: accept work`;
    const requirementRefs = params.requirementRefs as string[] | undefined;
    const worktreePath = params.worktreePath as string;
    const projectId = params.projectId as string;
    const workspacesBasePath = params.workspacesBasePath as string;

    const readResult = compareIntegrationCommits(_task, params);
    if (!readResult.ok) return readResult;

    const worktree = acquireWorktree(repoPath, projectId, workspacesBasePath);
    try {
      git(worktree.path, [
        "merge",
        "--no-ff",
        "--no-edit",
        "-m",
        message,
        branchName,
      ]);
      if (requirementRefs?.length) {
        markRequirementsDone(
          worktree.path,
          requirementRefs,
          params.cardId as string
        );
      }
    } catch (err) {
      abortMerge(worktree.path);
      return { ok: false, error: `Could not merge: ${errorMessage(err)}` };
    } finally {
      if (worktree.temporary) {
        git(repoPath, ["worktree", "remove", worktree.path, "--force"]);
      }
    }

    if (worktreePath) {
      discardWorktree(_task, {
        repoPath,
        worktreePath,
        workspacesBasePath,
        projectId,
      });
    }
    try {
      git(repoPath, ["branch", "-D", branchName]);
    } catch {
      /* already deleted */
    }
    return { ok: true, revision: git(repoPath, ["rev-parse", "hive-main"]) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ─── private helpers ────────────────────────────────────────────────────

function acquireWorktree(
  repoPath: string,
  projectId: string,
  workspacesBasePath: string
): { path: string; temporary: boolean } {
  if (git(repoPath, ["branch", "--show-current"]) === "hive-main") {
    if (git(repoPath, ["status", "--porcelain", "--untracked-files=no"])) {
      throw new Error("hive-main is checked out with uncommitted changes");
    }
    return { path: repoPath, temporary: false };
  }
  const dir = join(workspacesBasePath, "workspaces", projectId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `.hive-integration-${randomUUID()}`);
  git(repoPath, ["worktree", "add", path, "hive-main"]);
  return { path, temporary: true };
}

function hasBranch(repoPath: string, branch: string): boolean {
  try {
    git(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function branchWorktreePath(repoPath: string, branch: string): string | null {
  const recs = git(repoPath, ["worktree", "list", "--porcelain"]).split("\n\n");
  const ref = `branch refs/heads/${branch}`;
  for (const rec of recs) {
    if (!rec.includes(ref)) continue;
    const line = rec.split("\n").find((l) => l.startsWith("worktree "));
    if (line) return line.slice("worktree ".length);
  }
  return null;
}

function copyFileSafe(
  sourceDir: string,
  targetDir: string,
  relPath: string
): void {
  const src = join(sourceDir, relPath);
  if (!existsSync(src)) return;
  const dest = join(targetDir, relPath);
  mkdirSync(join(dest, ".."), { recursive: true });
  cpSync(src, dest);
}

function markRequirementsDone(
  worktreePath: string,
  refs: string[],
  cardId: string
): void {
  const path = join(worktreePath, ".hive", "requirements.md");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  const refSet = new Set(refs);
  const updated = content
    .split("\n")
    .map((line) => {
      const m = line.match(/^(-\s*\[([^\]]+)\])(.*)/);
      if (m && refSet.has(m[2]) && !m[3].trimStart().startsWith("(done)")) {
        return `${m[1]} (done)${m[3]}`;
      }
      return line;
    })
    .join("\n");
  if (updated === content) return;
  writeFileSync(path, updated, "utf-8");
  git(worktreePath, ["add", ".hive/requirements.md"]);
  git(worktreePath, ["commit", "-m", `hive: mark done ${cardId}`]);
}

function analyzeMerge(
  repoPath: string,
  branchName: string
): { state: string; files?: string[] } {
  const result = spawnSync(
    "git",
    ["merge-tree", "--write-tree", "--name-only", "hive-main", branchName],
    {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }
  );
  if (result.status === 0) return { state: "mergeable" };
  if (result.signal) return { state: "error", files: [] };
  const files = (result.stdout || "").split("\n").filter(Boolean);
  return { state: "conflicted", files };
}

function abortMerge(worktreePath: string): void {
  try {
    git(worktreePath, ["merge", "--abort"]);
  } catch {
    /* ok */
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function gitSucceeds(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
