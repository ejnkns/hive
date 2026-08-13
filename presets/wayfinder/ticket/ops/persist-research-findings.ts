// The ticket workflow's persist_research_findings operation, referenced by the wayfinder blueprint.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { readString } from "../../shared/read.ts";
import type { TicketState } from "../types.ts";

// Research findings persist as their own cited file so the build phase can cite
// the report independently of the decision record.
function persistResearchFindingsOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<TicketState>
): string {
  const output = ctx.taskOutputs().research as
    | {
        status?: string;
        output?: { question?: unknown; findings?: unknown; sources?: unknown };
      }
    | undefined;
  const question = readString(output?.output?.question) ?? "";
  const findings = readString(output?.output?.findings);
  if (output?.status !== "success" || findings === undefined) {
    throw new Error("No research findings to persist");
  }
  const sources = readStringArray(output.output?.sources);
  return [
    `# Research — ${question}`,
    "",
    findings,
    "",
    "## Sources",
    ...(sources.length > 0
      ? sources.map((source) => `- ${source}`)
      : ["(none recorded)"]),
    "",
  ].join("\n");
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export const persist_research_findingsOperations =
  defineOperations<TicketState>({
    persist_research_findings: persistResearchFindingsOp,
  });
