/** @private — only imported by create-standard-tool-registry.ts */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFlowSettings } from "../../read-flow-settings";
import type { TaskDefinition } from "../../task-runner";
import type { OperationContext } from "../create-operation-runner";

// Branch names and the domain root come from flow config, never hardcoded.
// integrationBranch/branchPrefix/domainDir have no engine defaults — a flow
// must declare them (queen-bee wires them in a later phase). Ops return
// { ok: ... } results; gates inspect them directly.

// ─── public operation exports ──────────────────────────────────────────

export function ensureIntegrationBranch(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx?: OperationContext
): Record<string, unknown> {
  try {
    const basePath = params.basePath as string;
    const integrationBranch = readIntegrationBranch(ctx);
    if (!integrationBranch) {
      return { ok: false, error: "Flow config integrationBranch is not set" };
    }
    if (!hasBranch(basePath, integrationBranch)) {
      git(basePath, ["branch", integrationBranch, "HEAD"]);
    }
    return {
      ok: true,
      branchName: integrationBranch,
      revision: git(basePath, ["rev-parse", integrationBranch]),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function checkIntegrationReadiness(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx?: OperationContext
): Record<string, unknown> {
  try {
    const basePath = params.basePath as string;
    const targetBranch = params.targetBranch as string;
    const integrationBranch = readIntegrationBranch(ctx);
    if (!integrationBranch) {
      return { ok: false, error: "Flow config integrationBranch is not set" };
    }
    const integration = git(basePath, ["rev-parse", integrationBranch]);
    const targetRev = git(basePath, ["rev-parse", targetBranch]);
    const ahead = Number(
      git(basePath, [
        "rev-list",
        "--count",
        `${targetBranch}..${integrationBranch}`,
      ])
    );
    const behind = Number(
      git(basePath, [
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
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function fastForwardTargetBranch(
  task: TaskDefinition,
  params: Record<string, unknown>,
  ctx?: OperationContext
): Record<string, unknown> {
  try {
    const basePath = params.basePath as string;
    const targetBranch = params.targetBranch as string;
    const integrationBranch = readIntegrationBranch(ctx);
    if (!integrationBranch) {
      return { ok: false, error: "Flow config integrationBranch is not set" };
    }
    const result = checkIntegrationReadiness(task, params, ctx);
    if (!result.ok) return result;
    if (result.state === "integrated")
      return { ok: true, alreadyIntegrated: true };
    if (result.state === "diverged")
      return {
        ok: false,
        error: `${targetBranch} and ${integrationBranch} have diverged`,
      };

    const checkedOutPath = branchWorktreePath(basePath, targetBranch);
    if (checkedOutPath) {
      if (git(checkedOutPath, ["status", "--porcelain"])) {
        return { ok: false, error: `${targetBranch} has uncommitted changes` };
      }
      git(checkedOutPath, ["merge", "--ff-only", integrationBranch]);
    } else {
      git(basePath, [
        "update-ref",
        `refs/heads/${targetBranch}`,
        result.integrationRevision as string,
        result.targetRevision as string,
      ]);
    }
    return { ok: true, revision: git(basePath, ["rev-parse", targetBranch]) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function writeFlowArtifacts(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    const basePath = params.basePath as string;
    const files = params.files as Record<string, string> | undefined;
    if (!files) return { ok: false, error: "files is required" };

    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(basePath, relativePath);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content, "utf-8");
    }
    git(basePath, ["add", ...Object.keys(files)]);
    git(basePath, [
      "commit",
      "-m",
      (params.message as string) ?? "hive: update flow artifacts",
    ]);
    return { ok: true, revision: git(basePath, ["rev-parse", "HEAD"]) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
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
  try {
    const { basePath, domainDir, integrationBranch } = readFlowSettings(
      ctx.flowConfig()
    );
    if (!basePath) return { ok: true, skipped: true };
    if (!domainDir)
      return { ok: false, error: "Flow config domainDir is not set" };
    if (!integrationBranch) {
      return { ok: false, error: "Flow config integrationBranch is not set" };
    }

    const message =
      typeof params.message === "string" ? params.message : "commit flow state";
    const sourceDir = join(basePath, domainDir);
    if (!existsSync(sourceDir)) {
      return {
        ok: true,
        unchanged: true,
        revision: git(basePath, ["rev-parse", integrationBranch]),
      };
    }
    if (!hasBranch(basePath, integrationBranch)) {
      git(basePath, ["branch", integrationBranch, "HEAD"]);
    }

    if (git(basePath, ["branch", "--show-current"]) === integrationBranch) {
      git(basePath, ["add", "-A", "--", domainDir]);
      if (!gitSucceeds(basePath, ["diff", "--cached", "--quiet"])) {
        git(basePath, ["commit", "-m", message]);
      }
      return {
        ok: true,
        revision: git(basePath, ["rev-parse", integrationBranch]),
      };
    }

    const worktreePath = mkdtempSync(join(tmpdir(), "hive-commit-"));
    git(basePath, ["worktree", "add", worktreePath, integrationBranch]);
    try {
      const targetDir = join(worktreePath, domainDir);
      mkdirSync(targetDir, { recursive: true });
      cpSync(sourceDir, targetDir, { recursive: true });
      git(worktreePath, ["add", "-A", "--", domainDir]);
      if (!gitSucceeds(worktreePath, ["diff", "--cached", "--quiet"])) {
        git(worktreePath, ["commit", "-m", message]);
      }
      return {
        ok: true,
        revision: git(basePath, ["rev-parse", integrationBranch]),
      };
    } finally {
      git(basePath, ["worktree", "remove", worktreePath, "--force"]);
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// Generic repo validation the engine can run on any bound repo: the base path
// must exist, be a git repository, and have at least one commit.
export function validateRepo(
  _task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
): Record<string, unknown> {
  try {
    const configuredBase = readFlowSettings(ctx.flowConfig()).basePath;
    const rawBasePath =
      (typeof params.basePath === "string" ? params.basePath : undefined) ??
      configuredBase;
    if (!rawBasePath) return { ok: false, error: "No basePath to validate" };

    const basePath = rawBasePath.startsWith("/")
      ? rawBasePath
      : join(process.cwd(), rawBasePath);
    if (!existsSync(basePath)) {
      return { ok: false, error: `Path does not exist: ${basePath}` };
    }
    git(basePath, ["rev-parse", "--is-inside-work-tree"]);
    git(basePath, ["rev-parse", "HEAD"]);
    return { ok: true, basePath };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ─── private helpers ────────────────────────────────────────────────────

function readIntegrationBranch(
  ctx: OperationContext | undefined
): string | undefined {
  if (!ctx) return undefined;
  return readFlowSettings(ctx.flowConfig()).integrationBranch;
}

function hasBranch(basePath: string, branch: string): boolean {
  try {
    git(basePath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function branchWorktreePath(basePath: string, branch: string): string | null {
  const recs = git(basePath, ["worktree", "list", "--porcelain"]).split("\n\n");
  const ref = `branch refs/heads/${branch}`;
  for (const rec of recs) {
    if (!rec.includes(ref)) continue;
    const line = rec.split("\n").find((l) => l.startsWith("worktree "));
    if (line) return line.slice("worktree ".length);
  }
  return null;
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
