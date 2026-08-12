// The generation loop with a stubbed model caller: happy path (valid blueprint
// passes on the first attempt), fixup path (a rejected blueprint's errors are fed
// back and a revised blueprint passes), and exhaust paths (no usable blueprint → error).
// No real model calls; the deterministic renderer/gate do the real work.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowBlueprint } from "./flow-blueprint.ts";
import {
  type ModelCaller,
  runGenerationLoop,
} from "./generate-flow-definition.ts";

const VALID_SPEC: FlowBlueprint = {
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
              systemPrompt: "Review the item and complete the task when done.",
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
const BAD_SPEC: FlowBlueprint = {
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

function specJson(blueprint: FlowBlueprint): string {
  return `\`\`\`json\n${JSON.stringify(blueprint)}\n\`\`\``;
}

describe("generation loop", () => {
  it("passes on the first attempt when the model returns a valid blueprint", async () => {
    const model: ModelCaller = async () => specJson(VALID_SPEC);
    const result = await runGenerationLoop("Build a review flow", model);
    assert.equal(result.report.passed, true);
    assert.equal(result.report.attempts, 1);
    assert.deepEqual(result.report.errors, []);
    assert.deepEqual(result.report.warnings, []);
    assert.ok(result.source.includes("defineWorkflow"));
  });

  it("feeds the rejection back and passes on a revised blueprint", async () => {
    const calls: { role: string; content: string }[][] = [];
    const model: ModelCaller = async (messages) => {
      calls.push(messages.map((m) => ({ ...m })));
      // Call 1 is the design stage; calls 2+ are blueprint attempts.
      return calls.length === 1
        ? "Design: one review workflow with a run task."
        : calls.length === 2
          ? specJson(BAD_SPEC)
          : specJson(VALID_SPEC);
    };
    const result = await runGenerationLoop("Build a review flow", model);
    assert.equal(result.report.passed, true);
    assert.equal(result.report.attempts, 2);

    // The third model call carried a user message with the rejection
    // feedback referencing the offending task id.
    const feedbackCall = calls[2];
    const lastUser = [...feedbackCall].reverse().find((m) => m.role === "user");
    assert.ok(
      lastUser?.content.includes("nonexistent"),
      `feedback should mention the bad task, got: ${lastUser?.content.slice(0, 200)}`
    );
  });

  it("feeds advisory warnings back for a blueprint that validates but has findings", async () => {
    const calls: { role: string; content: string }[][] = [];
    // A blueprint with a prompt-less ai-task validates and renders, but the
    // flow-authoring analysis flags it — the loop feeds that back instead of
    // silently passing.
    const WARNING_SPEC: FlowBlueprint = {
      ...VALID_SPEC,
      workflows: [
        {
          ...VALID_SPEC.workflows[0],
          states: VALID_SPEC.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      completionTool: "complete_task",
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const model: ModelCaller = async (messages) => {
      calls.push(messages.map((m) => ({ ...m })));
      return calls.length === 1
        ? "Design: one review workflow."
        : calls.length === 2
          ? specJson(WARNING_SPEC)
          : specJson(VALID_SPEC);
    };
    const result = await runGenerationLoop("Build a review flow", model);
    assert.equal(result.report.passed, true);
    assert.equal(result.report.attempts, 2);
    const feedbackCall = calls[2];
    const lastUser = [...feedbackCall].reverse().find((m) => m.role === "user");
    assert.ok(
      lastUser?.content.includes("no systemPrompt"),
      `feedback should mention the missing systemPrompt, got: ${lastUser?.content.slice(0, 200)}`
    );
  });

  it("emits live progress events through the loop", async () => {
    const events: string[] = [];
    let call = 0;
    const combined: ModelCaller = async (_messages, callbacks) => {
      call++;
      // Stream two deltas on every model call (design and each blueprint attempt),
      // then return the right shape per stage.
      callbacks?.onDelta?.("chunk-");
      callbacks?.onDelta?.("chunk");
      return call === 1 ? "design" : specJson(VALID_SPEC);
    };

    const result = await runGenerationLoop(
      "Build a review flow",
      combined,
      4,
      (event) => events.push(event.type)
    );
    assert.equal(result.report.passed, true);
    assert.equal(call, 2, "design stage plus one blueprint attempt");

    // The design and blueprint stages stream deltas, then the deterministic gate
    // stages run, and a clean blueprint ends without failure events.
    assert.deepEqual(events, [
      "stage",
      "delta",
      "delta",
      "stage",
      "delta",
      "delta",
      "stage",
      "stage",
      "stage",
    ]);
  });

  it("throws after exhausting attempts when the model never emits a blueprint", async () => {
    const model: ModelCaller = async () =>
      "I cannot produce a flow definition for that.";
    await assert.rejects(
      () => runGenerationLoop("Build a review flow", model, 3),
      /JSON flow blueprint/
    );
  });

  it("throws after exhausting attempts when the blueprint never validates", async () => {
    const model: ModelCaller = async () => specJson(BAD_SPEC);
    await assert.rejects(
      () => runGenerationLoop("Build a review flow", model, 3),
      /nonexistent/
    );
  });
});
