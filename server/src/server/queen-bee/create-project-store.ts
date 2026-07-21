/** @public */

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
  projects: Record<
    string,
    {
      path: string;
      name?: string;
      createdAt?: string;
      systemPrompt?: string;
      codingGuidelines?: string;
      targetBranch?: string;
      maxConcurrentWorkers?: number;
    }
  >;
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

  function readProjectMeta(
    repoPath: string,
    entry: ProjectRegistry["projects"][string]
  ): {
    name: string;
    systemPrompt: string;
    codingGuidelines: string;
    createdAt: string;
    targetBranch: string;
    maxConcurrentWorkers: number;
  } {
    return {
      name: entry.name ?? repoPath.split("/").pop() ?? repoPath,
      systemPrompt: entry.systemPrompt ?? "",
      codingGuidelines: entry.codingGuidelines ?? "",
      createdAt: entry.createdAt ?? "",
      targetBranch: entry.targetBranch ?? inferTargetBranch(repoPath),
      maxConcurrentWorkers:
        entry.maxConcurrentWorkers ?? DEFAULT_MAX_CONCURRENT_WORKERS,
    };
  }

  function listProjects(): ProjectListItem[] {
    return Object.entries(registry.projects).map(([id, entry]) => {
      const meta = readProjectMeta(entry.path, entry);
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
      registry.projects[project.id] = {
        path: project.repoPath,
        name: project.name,
        createdAt: project.createdAt,
        systemPrompt: project.systemPrompt,
        codingGuidelines: project.codingGuidelines,
        targetBranch: project.targetBranch,
        maxConcurrentWorkers: project.maxConcurrentWorkers,
      };
      save();
      return project;
    },

    updateMaxConcurrentWorkers(id: string, value: number): ProjectListItem {
      if (!isMaxConcurrentWorkers(value)) {
        throw new Error("Parallel workers must be an integer from 1 to 16");
      }
      const entry = registry.projects[id];
      if (!entry) throw new Error("Project not found");
      entry.maxConcurrentWorkers = value;
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
