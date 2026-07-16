/** @public */

export type ProjectListItem = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  systemPrompt: string;
  codingGuidelines: string;
};

export type CreateProjectRequest = {
  path: string;
  name?: string;
};
