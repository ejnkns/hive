// The generation loop with a stubbed model caller: happy path (valid spec
// passes on the first attempt), fixup path (a rejected spec's errors are fed
// back and a revised spec passes), and exhaust paths (no usable spec → error).
// No real model calls; the deterministic renderer/gate do the real work.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowSpec } from "./flow-spec";
import {
  type ModelCaller,
  runGenerationLoop,
} from "./generate-flow-definition";

const VALID_SPEC: FlowSpec = {
  id: "reviewFlow",
  label: "Review Flow",
  configSchema: [],
  workflows: [
    {
      id: "review",
      label: "Review",
      instance: { title: "title" },
      instanceState: [{ field: "title", type: "string" }],
      initialState: "ready",
      terminalStates: ["approved"],
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [
            {
              id: "start",
              label: "Start",
              variant: "primary",
              transitionTo: "running",
            },
          ],
        },
        {
          id: "running",
          label: "Running",
          category: "active",
          tasks: [
            {
              id: "run",
              label: "Run",
              role: "ai-task",
              tools: ["read_file"],
              completionTool: "complete_task",
            },
          ],
          autoTransitions: [
            { to: "approved", gate: { kind: "taskSuccess", task: "run" } },
            { to: "ready", gate: { kind: "taskError", task: "run" } },
          ],
        },
        { id: "approved", label: "Approved", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add",
      label: "Add review",
      variant: "primary",
      createInstance: {
        workflowId: "review",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
        ],
      },
    },
  ],
  edges: [],
};

// Same shape, but the autoTransition gate references a task that doesn't
// exist — validation must reject it.
const BAD_SPEC: FlowSpec = {
  ...VALID_SPEC,
  workflows: [
    {
      ...VALID_SPEC.workflows[0],
      states: VALID_SPEC.workflows[0].states.map((s) =>
        s.id === "running"
          ? {
              ...s,
              autoTransitions: [
                {
                  to: "approved",
                  gate: { kind: "taskSuccess", task: "nonexistent" },
                },
                { to: "ready", gate: { kind: "taskError", task: "run" } },
              ],
            }
          : s
      ),
    },
  ],
};

function specJson(spec: FlowSpec): string {
  return `\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``;
}

describe("generation loop", () => {
  it("passes on the first attempt when the model returns a valid spec", async () => {
    const model: ModelCaller = async () => specJson(VALID_SPEC);
    const result = await runGenerationLoop("Build a review flow", model);
    assert.equal(result.report.passed, true);
    assert.equal(result.report.attempts, 1);
    assert.deepEqual(result.report.errors, []);
    assert.deepEqual(result.report.warnings, []);
    assert.ok(result.source.includes("defineWorkflow"));
  });

  it("feeds the rejection back and passes on a revised spec", async () => {
    const calls: { role: string; content: string }[][] = [];
    const model: ModelCaller = async (messages) => {
      calls.push(messages.map((m) => ({ ...m })));
      return calls.length === 1 ? specJson(BAD_SPEC) : specJson(VALID_SPEC);
    };
    const result = await runGenerationLoop("Build a review flow", model);
    assert.equal(result.report.passed, true);
    assert.equal(result.report.attempts, 2);

    // The second model call carried a user message with the rejection
    // feedback referencing the offending task id.
    const secondCall = calls[1];
    const lastUser = [...secondCall].reverse().find((m) => m.role === "user");
    assert.ok(
      lastUser?.content.includes("nonexistent"),
      `feedback should mention the bad task, got: ${lastUser?.content.slice(0, 200)}`
    );
  });

  it("throws after exhausting attempts when the model never emits a spec", async () => {
    const model: ModelCaller = async () =>
      "I cannot produce a flow definition for that.";
    await assert.rejects(
      () => runGenerationLoop("Build a review flow", model, 3),
      /JSON flow spec/
    );
  });

  it("throws after exhausting attempts when the spec never validates", async () => {
    const model: ModelCaller = async () => specJson(BAD_SPEC);
    await assert.rejects(
      () => runGenerationLoop("Build a review flow", model, 3),
      /nonexistent/
    );
  });
});
