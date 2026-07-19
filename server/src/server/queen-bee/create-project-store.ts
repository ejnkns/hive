/** @public */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_MAX_CONCURRENT_WORKERS,
  isMaxConcurrentWorkers,
  type ProjectListItem,
} from "shared/project-types";
import {
  createProject,
  inferTargetBranch,
} from "./create-project-store/create-project";
import { loadProjectRegistry } from "./create-project-store/load-project-registry";
import { unlinkProject } from "./create-project-store/unlink-project";
import { writeProjectRegistry } from "./create-project-store/write-project-registry";

export type Project = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  systemPrompt: string;
  codingGuidelines: string;
  targetBranch: string;
  maxConcurrentWorkers: number;
};

export type ProjectRegistry = {
  projects: Record<string, { path: string }>;
};

export type ProjectStore = {
  getAll(): ProjectListItem[];
  create(repoPath: string, name?: string): Project;
  updateMaxConcurrentWorkers(id: string, value: number): ProjectListItem;
  unlink(id: string): void;
};

export function createProjectStore(
  onProjectsChanged: () => void
): ProjectStore {
  const registry = loadProjectRegistry();

  function save(): void {
    writeProjectRegistry(registry);
    onProjectsChanged();
  }

  function readProjectMeta(repoPath: string): {
    name: string;
    systemPrompt: string;
    codingGuidelines: string;
    createdAt: string;
    targetBranch: string;
    maxConcurrentWorkers: number;
  } {
    try {
      const raw = readFileSync(
        join(repoPath, ".hive", "project.json"),
        "utf-8"
      );
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        name:
          typeof parsed.name === "string" && parsed.name.length > 0
            ? parsed.name
            : (repoPath.split("/").pop() ?? repoPath),
        systemPrompt:
          typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : "",
        codingGuidelines:
          typeof parsed.codingGuidelines === "string"
            ? parsed.codingGuidelines
            : "",
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
        targetBranch:
          typeof parsed.targetBranch === "string" && parsed.targetBranch
            ? parsed.targetBranch
            : inferTargetBranch(repoPath),
        maxConcurrentWorkers: parseMaxConcurrentWorkers(
          parsed.maxConcurrentWorkers
        ),
      };
    } catch {
      return {
        name: repoPath.split("/").pop() ?? repoPath,
        systemPrompt: "",
        codingGuidelines: "",
        createdAt: "",
        targetBranch: inferTargetBranch(repoPath),
        maxConcurrentWorkers: DEFAULT_MAX_CONCURRENT_WORKERS,
      };
    }
  }

  function listProjects(): ProjectListItem[] {
    return Object.entries(registry.projects).map(([id, entry]) => {
      const meta = readProjectMeta(entry.path);
      return {
        id,
        name: meta.name,
        repoPath: entry.path,
        createdAt: meta.createdAt,
        systemPrompt: meta.systemPrompt,
        codingGuidelines: meta.codingGuidelines,
        targetBranch: meta.targetBranch,
        maxConcurrentWorkers: meta.maxConcurrentWorkers,
      };
    });
  }

  return {
    getAll(): ProjectListItem[] {
      return listProjects();
    },

    create(repoPath: string, name?: string): Project {
      const project = createProject(repoPath, name, registry);
      registry.projects[project.id] = { path: project.repoPath };
      save();
      return project;
    },

    updateMaxConcurrentWorkers(id: string, value: number): ProjectListItem {
      if (!isMaxConcurrentWorkers(value)) {
        throw new Error("Parallel workers must be an integer from 1 to 16");
      }
      const entry = registry.projects[id];
      if (!entry) throw new Error("Project not found");
      const projectFile = join(entry.path, ".hive", "project.json");
      const parsed: unknown = JSON.parse(readFileSync(projectFile, "utf-8"));
      if (!isRecord(parsed))
        throw new Error("Project configuration is invalid");
      const temporaryFile = `${projectFile}.tmp`;
      writeFileSync(
        temporaryFile,
        `${JSON.stringify({ ...parsed, maxConcurrentWorkers: value }, null, 2)}\n`
      );
      renameSync(temporaryFile, projectFile);
      onProjectsChanged();
      const project = listProjects().find((candidate) => candidate.id === id);
      if (!project) throw new Error("Project not found");
      return project;
    },

    unlink(id: string): void {
      unlinkProject(id, registry);
      save();
    },
  };
}

function parseMaxConcurrentWorkers(value: unknown): number {
  return isMaxConcurrentWorkers(value) ? value : DEFAULT_MAX_CONCURRENT_WORKERS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
