import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolContext } from "../tool-types.ts";
import { execute } from "./create-instance.ts";

describe("create_instance", () => {
  it("creates a workflow instance via the tool context capability", async () => {
    const created: Array<{
      workflowId: string;
      instanceState: Record<string, unknown>;
    }> = [];
    const ctx: ToolContext = {
      workspacePath: "/workspace",
      createWorkflowInstance: (workflowId, instanceState) => {
        created.push({ workflowId, instanceState: instanceState ?? {} });
        return { id: "ticket-123" };
      },
    };

    const result = await execute(
      {
        id: "c1",
        name: "create_instance",
        arguments: JSON.stringify({
          workflowId: "ticket",
          instanceState: { title: "Graduated ticket" },
        }),
      },
      ctx
    );

    assert.equal(result.isError, false);
    assert.equal(result.content, "Created ticket instance ticket-123");
    assert.deepEqual(created, [
      { workflowId: "ticket", instanceState: { title: "Graduated ticket" } },
    ]);
  });

  it("passes a stateId through so the instance starts in a declared state", async () => {
    const created: Array<{
      workflowId: string;
      instanceState: Record<string, unknown>;
      stateId?: string;
    }> = [];
    const ctx: ToolContext = {
      workspacePath: "/workspace",
      createWorkflowInstance: (workflowId, instanceState, stateId) => {
        created.push({
          workflowId,
          instanceState: instanceState ?? {},
          stateId,
        });
        return { id: "ticket-123" };
      },
    };

    const result = await execute(
      {
        id: "c1",
        name: "create_instance",
        arguments: JSON.stringify({
          workflowId: "ticket",
          instanceState: { title: "Ready ticket" },
          stateId: "ready",
        }),
      },
      ctx
    );

    assert.equal(result.isError, false);
    assert.deepEqual(created, [
      {
        workflowId: "ticket",
        instanceState: { title: "Ready ticket" },
        stateId: "ready",
      },
    ]);
  });

  it("errors when the capability is unavailable", async () => {
    const ctx: ToolContext = { workspacePath: "/workspace" };
    const result = await execute(
      {
        id: "c1",
        name: "create_instance",
        arguments: JSON.stringify({ workflowId: "ticket" }),
      },
      ctx
    );
    assert.equal(result.isError, true);
    assert.ok(result.content.includes("not available"));
  });

  it("requires workflowId", async () => {
    const ctx: ToolContext = {
      workspacePath: "/workspace",
      createWorkflowInstance: () => ({ id: "x" }),
    };
    const result = await execute(
      { id: "c1", name: "create_instance", arguments: "{}" },
      ctx
    );
    assert.equal(result.isError, true);
    assert.ok(result.content.includes("workflowId"));
  });
});
