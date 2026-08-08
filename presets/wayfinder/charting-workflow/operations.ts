// Charting workflow internals; import via charting-workflow.ts.

import type { OperationContext } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { ChartingItemState } from "../charting-workflow";

// flow.ts binds the state type and merges this into the preset's registry.
export const chartingOperations = {
  settle_chart: settleChartOp,
};

// Writes the settled destination/notes into flow config (so the effort's
// standing facts are flow-level, not session-level) and returns the map.md body
// the task persists under the domain root. The session's submit_map recording
// is authoritative; the creation-time config values are the fallback.
function settleChartOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<ChartingItemState>
): string {
  const config = ctx.flowConfig();
  const state = ctx.workflowInstanceState();
  const destination =
    readString(state.destination) ?? readString(config.destination) ?? "";
  const notes = readString(state.notes) ?? readString(config.notes) ?? "";
  ctx.patchFlowConfig({ destination, notes });
  return buildMapBody(destination, notes);
}

function buildMapBody(destination: string, notes: string): string {
  return [
    "# Wayfinder Map",
    "",
    "## Destination",
    destination !== ""
      ? destination
      : "Unspecified — sharpen it in the charting session.",
    "",
    "## Notes",
    notes !== "" ? notes : "(none)",
    "",
    "## How to read this map",
    "This file is the charting index, not the store. Decision tickets render as",
    "live instances: closed tickets are Decisions so far, fog tickets are Not yet",
    "specified, out-of-scope tickets are closed without graduating, and the",
    "frontier is the set of claimable ready tickets. The build phase reads this",
    "index and the persisted decision records under decisions/.",
    "",
  ].join("\n");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
