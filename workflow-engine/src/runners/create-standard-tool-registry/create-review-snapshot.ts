/** @private — only imported by create-standard-tool-registry.ts */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TaskDefinition } from "../../task-runner";

const IDENTITY = {
  GIT_AUTHOR_NAME: "Hive Supervisor",
  GIT_AUTHOR_EMAIL: "supervisor@hive.local",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Hive Supervisor",
  GIT_COMMITTER_EMAIL: "supervisor@hive.local",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

export type ReviewSnapshotParams = {
  basePath: string;
  workspacePath: string;
  baseCommit: string;
  integrationCommit?: string;
};

export function createReviewSnapshot(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  const { basePath, workspacePath, baseCommit, integrationCommit } =
    params as unknown as ReviewSnapshotParams;

  if (!basePath || !workspacePath || !baseCommit) {
    return {
      ok: false,
      error: "Missing required params: basePath, workspacePath, baseCommit",
    };
  }

  try {
    const headCommit = git(workspacePath, ["rev-parse", "HEAD"]);
    const integCommit =
      integrationCommit ?? git(basePath, ["rev-parse", "hive-main"]);
    const diff = git(workspacePath, [
      "diff",
      "--no-ext-diff",
      `${baseCommit}...${headCommit}`,
    ]);
    const changedFiles = gitLines(workspacePath, [
      "diff",
      "--name-only",
      `${baseCommit}...${headCommit}`,
    ]);
    const diffStat = git(workspacePath, [
      "diff",
      "--stat",
      `${baseCommit}...${headCommit}`,
    ]);
    const commits = commitList(basePath, baseCommit, headCommit);
    const mergedTree = computeMergedTree(basePath, integCommit, headCommit);

    return {
      ok: true,
      headCommit,
      baseCommit,
      integrationCommit: integCommit,
      reviewCommit: mergedTree.commit,
      reviewReference: mergedTree.reference,
      diff,
      changedFiles,
      diffStat,
      commits,
      digest: createHash("sha256")
        .update(diff + changedFiles.join(","))
        .digest("hex"),
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Review snapshot failed",
    };
  }
}

export function createReviewWorkspace(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  const { basePath, commit, workspacesBasePath, projectId } = params as Record<
    string,
    string
  >;
  const worktreesDir = join(workspacesBasePath, "workspaces", projectId);
  mkdirSync(worktreesDir, { recursive: true });
  const path = join(worktreesDir, `.hive-review-${randomUUID()}`);
  git(basePath, ["worktree", "add", "--detach", path, commit]);
  return { path };
}

function computeMergedTree(
  basePath: string,
  integrationCommit: string,
  headCommit: string
): { commit: string; reference: string } {
  const tree = execFileSync(
    "git",
    ["merge-tree", "--write-tree", integrationCommit, headCommit],
    {
      cwd: basePath,
      encoding: "utf-8",
      timeout: 30_000,
    }
  ).split("\n")[0];
  if (!tree) throw new Error("Git did not produce a merged review tree");

  const commit = execFileSync(
    "git",
    [
      "commit-tree",
      tree,
      "-p",
      integrationCommit,
      "-p",
      headCommit,
      "-m",
      `hive: review combined state`,
    ],
    {
      cwd: basePath,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, ...IDENTITY },
    }
  ).trim();
  const reference = `refs/hive/reviews/${commit}`;
  git(basePath, ["update-ref", reference, commit]);
  return { commit, reference };
}

function commitList(
  basePath: string,
  baseCommit: string,
  headCommit: string
): Array<{ sha: string; subject: string }> {
  return gitLines(basePath, [
    "log",
    "--format=%H%x09%s",
    `${baseCommit}..${headCommit}`,
  ]).map((line) => {
    const sep = line.indexOf("\t");
    return { sha: line.slice(0, sep), subject: line.slice(sep + 1) };
  });
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function gitLines(cwd: string, args: string[]): string[] {
  return git(cwd, args).split("\n").filter(Boolean);
}
