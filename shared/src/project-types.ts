/** @public */

export type ProjectListItem = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  systemPrompt: string;
  codingGuidelines: string;
  targetBranch: string;
  maxConcurrentWorkers: number;
};

export type ProjectIntegrationStatus = {
  branchName: "hive-main";
  revision: string;
  targetBranch: string;
  targetRevision: string;
  state: "integrated" | "ready" | "diverged";
  ahead: number;
  behind: number;
  canIntegrate: boolean;
};

export type CreateProjectRequest = {
  path: string;
  name?: string;
};

export const DEFAULT_MAX_CONCURRENT_WORKERS = 3;
export const MIN_MAX_CONCURRENT_WORKERS = 1;
export const MAX_MAX_CONCURRENT_WORKERS = 16;

export function isMaxConcurrentWorkers(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_MAX_CONCURRENT_WORKERS &&
    value <= MAX_MAX_CONCURRENT_WORKERS
  );
}
