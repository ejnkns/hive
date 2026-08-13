// The build workflow's persist_build_plan operation, referenced by the wayfinder blueprint.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { BuildState } from "../types.ts";

type BuildTicket = {
  title?: unknown;
  description?: unknown;
  acceptanceCriteria?: unknown;
  dependsOn?: unknown;
};

// The accepted plan persists as a readable markdown document under the domain
// root, recording the tickets the build-item fan-out creates.
function persistBuildPlanOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<BuildState>
): string {
  const output = ctx.taskOutputs().plan as
    | { status?: string; output?: { tickets?: unknown } }
    | undefined;
  const tickets = output?.output?.tickets;
  if (output?.status !== "success" || !Array.isArray(tickets)) {
    throw new Error("No build plan to persist");
  }
  const sections = tickets.flatMap((ticket) =>
    buildTicketSection(ticket as BuildTicket)
  );
  return ["# Build Plan", "", ...sections, ""].join("\n");
}

function buildTicketSection(ticket: BuildTicket): string[] {
  const title = typeof ticket.title === "string" ? ticket.title : "Untitled";
  const description =
    typeof ticket.description === "string" ? ticket.description : "";
  const acceptanceCriteria = readStringArray(ticket.acceptanceCriteria);
  const dependsOn = readStringArray(ticket.dependsOn);
  return [
    `## ${title}`,
    "",
    description,
    "",
    "Acceptance criteria:",
    ...(acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((criterion) => `- ${criterion}`)
      : ["- (none)"]),
    ...(dependsOn.length > 0 ? ["", `Blocks on: ${dependsOn.join(", ")}`] : []),
    "",
  ];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export const persist_build_planOperations = defineOperations<BuildState>({
  persist_build_plan: persistBuildPlanOp,
});
