/** @private — only imported by create-project-store.ts */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, ProjectRegistry } from "../create-project-store";

export function createProject(
  repoPath: string,
  name?: string,
  registry?: ProjectRegistry
): Project {
  const resolved = resolveRepoPath(repoPath);
  validateGitRepo(resolved);
  ensureRepoInitialized(resolved);

  const projectName = name ?? repoPath.split("/").pop() ?? repoPath;
  const slug = slugify(projectName);
  const id = makeUnique(slug, registry);
  const createdAt = new Date().toISOString();

  const hiveDir = join(resolved, ".hive");
  if (!existsSync(hiveDir)) {
    mkdirSync(hiveDir, { recursive: true });
  }

  const projectJson = {
    name: projectName,
    repoPath: resolved,
    createdAt,
    systemPrompt: "",
    codingGuidelines: "",
  };

  writeFileSync(
    join(hiveDir, "project.json"),
    JSON.stringify(projectJson, null, 2),
    "utf-8"
  );

  writeFileSync(
    join(hiveDir, "requirements.md"),
    REQUIREMENTS_TEMPLATE,
    "utf-8"
  );

  return {
    id,
    name: projectName,
    repoPath: resolved,
    createdAt,
    systemPrompt: "",
    codingGuidelines: "",
  };
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

const REQUIREMENTS_TEMPLATE = `# Requirements

## Overview

## Functional requirements

## Non-functional requirements

## Acceptance criteria

## Out of scope

## For later
`;

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
