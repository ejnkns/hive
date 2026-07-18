/** @public */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HIVE_DIR } from "shared/hive-dir";

export type ProjectContext = {
  projectId: string;
  revision: string;
  files: string[];
  manifests: Record<string, string>;
};

const MANIFEST_NAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "Gemfile",
]);

export function loadProjectContext(
  projectId: string,
  repoPath: string,
  cacheRoot = join(HIVE_DIR, "project-context")
): ProjectContext {
  if (!existsSync(join(repoPath, ".git"))) {
    throw new Error(`Project context requires a Git worktree: ${repoPath}`);
  }
  const revision = contextRevision(repoPath);
  const path = join(
    cacheRoot,
    encodeURIComponent(projectId),
    `${revision}.json`
  );
  const cached = readContext(path);
  if (cached) return cached;

  const files = gitLines(repoPath, [
    "ls-tree",
    "-r",
    "--name-only",
    revision,
  ]).slice(0, 2_000);
  const manifests: Record<string, string> = {};
  for (const file of files.filter(isManifest).slice(0, 20)) {
    manifests[file] = git(repoPath, ["show", `${revision}:${file}`]).slice(
      0,
      20_000
    );
  }
  const context: ProjectContext = {
    projectId,
    revision,
    files,
    manifests,
  };
  writeContext(path, context);
  return context;
}

function contextRevision(repoPath: string): string {
  return hasBranch(repoPath, "hive-main")
    ? git(repoPath, ["rev-parse", "hive-main"])
    : git(repoPath, ["rev-parse", "HEAD"]);
}

function isManifest(path: string): boolean {
  const name = path.split("/").at(-1) ?? path;
  return MANIFEST_NAMES.has(name);
}

function hasBranch(repoPath: string, branchName: string): boolean {
  try {
    git(repoPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf-8",
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function gitLines(repoPath: string, args: string[]): string[] {
  return git(repoPath, args).split("\n").filter(Boolean);
}

function readContext(path: string): ProjectContext | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ProjectContext;
  } catch {
    return null;
  }
}

function writeContext(path: string, context: ProjectContext): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(context, null, 2), "utf-8");
  renameSync(temporaryPath, path);
}
