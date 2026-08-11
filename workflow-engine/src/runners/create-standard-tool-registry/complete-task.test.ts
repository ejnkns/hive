import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStandardToolDefinitions } from "../create-standard-tool-registry.ts";
import type { ToolContext } from "../tool-types.ts";
import { definition, execute } from "./complete-task.ts";

// The generic completion tool: a flow's ai task can declare it as its
// completionTool with no domain tool code; the parsed arguments become the
// task output (surfaced as output.completion by the ai-chat runner), so gates
// branch on outcome fields declaratively.
describe("complete_task", () => {
  it("is registered in the standard tool registry", () => {
    const defs = createStandardToolDefinitions();
    assert.ok(defs.complete_task);
    assert.equal(defs.complete_task.function.name, "complete_task");
  });

  it("acknowledges a completion call", async () => {
    const ctx: ToolContext = { workspacePath: "/workspace" };
    const result = await execute(
      {
        id: "c1",
        name: "complete_task",
        arguments: JSON.stringify({
          outcome: "already_satisfied",
          rationale: "behavior present",
        }),
      },
      ctx
    );
    assert.equal(result.isError, false);
    assert.equal(definition.function.name, "complete_task");
  });
});
