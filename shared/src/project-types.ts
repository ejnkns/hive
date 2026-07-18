/** @public */

export type ProjectListItem = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  systemPrompt: string;
  codingGuidelines: string;
  targetBranch: string;
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
