/** @private — only imported by create-project-store.ts */

import { execFileSync, execSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MAX_CONCURRENT_WORKERS } from "shared/project-types";
import type { Project, ProjectRegistry } from "../create-project-store";
import { ensureIntegrationBranch } from "../integration-manager";

export function createProject(
  repoPath: string,
  name?: string,
  registry?: ProjectRegistry
): Project {
  const resolved = resolveRepoPath(repoPath);
  validateGitRepo(resolved);
  ensureRepoInitialized(resolved);
  ensureIntegrationBranch(resolved);

  const projectName = name ?? repoPath.split("/").pop() ?? repoPath;
  const slug = slugify(projectName);
  const id = makeUnique(slug, registry);
  const createdAt = new Date().toISOString();
  const targetBranch = inferTargetBranch(resolved);
  const maxConcurrentWorkers = DEFAULT_MAX_CONCURRENT_WORKERS;

  return {
    id,
    name: projectName,
    repoPath: resolved,
    createdAt,
    systemPrompt: "",
    codingGuidelines: "",
    targetBranch,
    maxConcurrentWorkers,
  };
}

export function inferTargetBranch(repoPath: string): string {
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
      (branch) =>
        branch &&
        branch !== "hive-main" &&
        !branch.startsWith("hive/") &&
        !branch.startsWith("qb/")
    );
  const preferred =
    branches.find((branch) => branch === "main") ??
    branches.find((branch) => branch === "master") ??
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

function makeUnique(slug: string, registry?: ProjectRegistry): string {
  if (!registry) return slug;
  if (!(slug in registry.projects)) return slug;

  let n = 2;
  while (`${slug}-${n}` in registry.projects) {
    n++;
  }
  return `${slug}-${n}`;
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
    // no commits yet — create initial commit
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
    // allow-empty if nothing to add
    try {
      execSync('git commit --allow-empty -m "Initial commit"', {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5_000,
      });
    } catch {
      // ignore — will fail downstream if repo can't be initialized
    }
  }
}
