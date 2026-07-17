/** @public */

export type Column =
  | "idea"
  | "ready"
  | "in_progress"
  | "reviewing"
  | "done"
  | "unfulfillable";

export type WorkerLog = {
  startedAt: string;
  finishedAt: string;
  iterations: number;
  toolCalls: { name: string; args: string }[];
  error?: string;
  content: string;
};

export type ReviewerLog = {
  verdict: "pass" | "fail";
  feedback: string;
  reviewedAt: string;
};

export type Card = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  relevantFiles: string[];
  dependencies: string[];
  column: Column;
  createdAt: string;
  workerLog?: WorkerLog;
  reviewerLog?: ReviewerLog;
};
