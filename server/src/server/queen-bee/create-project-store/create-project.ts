/** @private — only imported by create-project-store.ts */

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
