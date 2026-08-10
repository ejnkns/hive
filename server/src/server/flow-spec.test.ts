// Spec validation: the spec-level gate the model iterates against. Every
// error must be precise and model-actionable (path + message referencing the
// offending id), and the read↔write invariants must be reported against the
// spec, before anything is rendered.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowSpec } from "./flow-spec";
import { analyzeFlowSpec, validateFlowSpec } from "./flow-spec";

// A small valid spec: one workflow, one ai-task, gates on its output, a
// createInstance action writing the only instance-state field.
const VALID: FlowSpec = {
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

function errorsFor(spec: FlowSpec): { path: string; message: string }[] {
  return validateFlowSpec(spec);
}

function messageFor(spec: FlowSpec, needle: string): string | undefined {
  return errorsFor(spec).find((e) => e.message.includes(needle))?.message;
}

describe("validateFlowSpec", () => {
  it("accepts a well-formed spec", () => {
    assert.deepEqual(errorsFor(VALID), []);
  });

  it("accepts configSchema fields with the richer types", () => {
    const spec: FlowSpec = {
      ...VALID,
      configSchema: [
        { key: "note", label: "Note", type: "textarea" },
        { key: "due", label: "Due", type: "date", required: true },
        { key: "deadline", label: "Deadline", type: "datetime" },
        {
          key: "tags",
          label: "Tags",
          type: "string[]",
          options: ["a", "b"],
          placeholder: "Pick tags",
          defaultValue: ["a"],
        },
      ],
    };
    assert.deepEqual(errorsFor(spec), []);
  });

  it("rejects a configSchema field with a malformed options list", () => {
    const spec: FlowSpec = {
      ...VALID,
      configSchema: [
        {
          key: "kind",
          label: "Kind",
          type: "string",
          options: ["a", 2],
        } as unknown as FlowSpec["configSchema"][number],
      ],
    };
    const errors = errorsFor(spec);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, "configSchema[0]");
  });

  it("accepts editFields whose keys are declared in instanceState", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          instanceState: [
            { field: "title", type: "string" },
            { field: "due", type: "string" },
          ],
          editFields: [
            { key: "title", label: "Title", type: "string", required: true },
            { key: "due", label: "Due", type: "date" },
          ],
        },
      ],
    };
    assert.deepEqual(errorsFor(spec), []);
  });

  it("rejects an editFields key not declared in instanceState", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          editFields: [{ key: "bogus", label: "Bogus", type: "string" }],
        },
      ],
    };
    const errors = errorsFor(spec);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, "workflows[0].editFields[0].key");
    assert.match(errors[0].message, /not declared in instanceState/);
  });

  it("rejects an empty editFields declaration", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [{ ...VALID.workflows[0], editFields: [] }],
    };
    const errors = errorsFor(spec);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, "workflows[0].editFields");
  });

  it("rejects a gate referencing an unknown task", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  autoTransitions: [
                    {
                      to: "approved",
                      gate: { kind: "taskSuccess", task: "nope" },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "nope");
    assert.ok(
      message,
      `expected a mention of the unknown task, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects an unknown engine operation and lists the valid ones", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "prep",
                      label: "Prep",
                      role: "operation",
                      operations: ["frobnicate"],
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "frobnicate");
    assert.ok(
      message?.includes("prepare_worktree"),
      `expected the valid ops listed, got: ${message}`
    );
  });

  it("rejects an unknown tool", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      tools: ["definitely_not_a_tool"],
                      completionTool: "complete_task",
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    assert.ok(messageFor(bad, "definitely_not_a_tool"));
  });

  it("rejects a completionTool other than complete_task", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      completionTool: "read_file",
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "complete_task");
    assert.ok(
      message,
      `expected the completionTool rule, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("reports a read with no writer at the spec level", () => {
    // A gate reading instance state that only createInstance writes a
    // different field for.
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  autoTransitions: [
                    {
                      to: "approved",
                      gate: { kind: "taskSuccess", task: "run" },
                    },
                    {
                      to: "ready",
                      gate: {
                        kind: "instanceStateEquals",
                        field: "verdict",
                        value: "approved",
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "nothing writes it");
    assert.ok(
      message,
      `expected a spec-level missing-writer error, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects a patch key not declared in instanceState", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    ...(s.tasks ?? []),
                    {
                      id: "record",
                      label: "Record",
                      role: "operation",
                      patch: {
                        verdict: { kind: "literal", value: "approved" },
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "not declared in instanceState");
    assert.ok(
      message,
      `expected an undeclared-patch-write error, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects a patch on a non-operation task", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      patch: { title: { kind: "literal", value: "x" } },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "operation task");
    assert.ok(
      message,
      `expected the patch-requires-operation rule, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects an instanceStateEquals comparison with the wrong value type", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  autoTransitions: [
                    {
                      to: "approved",
                      gate: { kind: "taskSuccess", task: "run" },
                    },
                    {
                      to: "ready",
                      gate: {
                        kind: "instanceStateEquals",
                        field: "title",
                        value: 42,
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    assert.ok(messageFor(bad, "string"), "expected a type-mismatch error");
  });

  it("rejects a taskOutputEquals path that does not start with output", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  autoTransitions: [
                    {
                      to: "approved",
                      gate: {
                        kind: "taskOutputEquals",
                        task: "run",
                        path: "completion.verdict",
                        value: "ok",
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    assert.ok(messageFor(bad, "output"), "expected the path-prefix rule");
  });

  it("rejects a literal value whose type mismatches the declared field type", () => {
    const bad: FlowSpec = {
      ...VALID,
      edges: [
        {
          fromWorkflow: "review",
          fromStates: ["approved"],
          toWorkflow: "review",
          fields: { title: { kind: "literal", value: 7 } },
        },
      ],
    };
    const message = messageFor(bad, "does not match field type");
    assert.ok(
      message,
      `expected a literal type-match error, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects conflicting taskOutputEquals paths on the same task", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  autoTransitions: [
                    {
                      to: "approved",
                      gate: {
                        kind: "taskOutputEquals",
                        task: "run",
                        path: "output",
                        value: "x",
                      },
                    },
                    {
                      to: "ready",
                      gate: {
                        kind: "taskOutputEquals",
                        task: "run",
                        path: "output.completion",
                        value: "y",
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    assert.ok(
      messageFor(bad, "conflicting taskOutputEquals paths"),
      `expected a path-conflict error, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects a dependsOnState use without a declared and written dependsOn field", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "ready"
              ? {
                  ...s,
                  actions: [
                    {
                      id: "start",
                      label: "Start",
                      variant: "primary",
                      transitionTo: "running",
                      dependsOnState: "approved",
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "dependsOn");
    assert.ok(
      message,
      `expected the dependsOn contract rule, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("accepts a structured completion contract (completionOutput on an ai-task)", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          instanceState: [
            { field: "title", type: "string" },
            { field: "category", type: "string" },
            { field: "tags", type: "string[]" },
          ],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      completionOutput: [
                        { field: "category", type: "string" },
                        { field: "tags", type: "string[]" },
                      ],
                    },
                    {
                      id: "record",
                      label: "Record",
                      role: "operation",
                      patch: {
                        category: {
                          kind: "taskOutput",
                          task: "run",
                          path: "output.category",
                        },
                        tags: {
                          kind: "taskOutput",
                          task: "run",
                          path: "output.tags",
                        },
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    assert.deepEqual(errorsFor(spec), []);
  });

  it("rejects completionOutput on a non-ai-task role", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "operation",
                      completionOutput: [{ field: "category", type: "string" }],
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "requires an ai-task role");
    assert.ok(
      message,
      `expected a role error, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects completionOutput combined with an explicit completionTool", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      completionTool: "complete_task",
                      completionOutput: [{ field: "category", type: "string" }],
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "do not also set completionTool");
    assert.ok(
      message,
      `expected a mutual-exclusion error, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects a taskOutput read of a field the source task does not declare", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          instanceState: [
            { field: "title", type: "string" },
            { field: "category", type: "string" },
          ],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      completionOutput: [{ field: "category", type: "string" }],
                    },
                    {
                      id: "record",
                      label: "Record",
                      role: "operation",
                      patch: {
                        category: {
                          kind: "taskOutput",
                          task: "run",
                          path: "output.nonexistent",
                        },
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "does not declare in completionOutput");
    assert.ok(
      message,
      `expected a field-resolution error, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("rejects a taskOutputEquals gate on an undeclared completionOutput field", () => {
    const bad: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      completionOutput: [{ field: "category", type: "string" }],
                    },
                  ],
                  autoTransitions: [
                    {
                      to: "approved",
                      gate: {
                        kind: "taskOutputEquals",
                        task: "run",
                        path: "output.verdict",
                        value: "approved",
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(bad, "does not declare in completionOutput");
    assert.ok(
      message,
      `expected a field-resolution error, got: ${errorsFor(bad)
        .map((e) => e.message)
        .join("; ")}`
    );
  });
});

describe("analyzeFlowSpec", () => {
  it("flags an ai-task with no systemPrompt", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
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
    const findings = analyzeFlowSpec(spec);
    assert.ok(
      findings.some((f) => f.includes("no systemPrompt")),
      `expected a prompt finding, got: ${findings.join("; ")}`
    );
  });

  it("flags completionOutput that nothing reads", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          instanceState: [
            { field: "title", type: "string" },
            { field: "category", type: "string" },
          ],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      systemPrompt: "Return a category.",
                      completionOutput: [{ field: "category", type: "string" }],
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const findings = analyzeFlowSpec(spec);
    assert.ok(
      findings.some((f) => f.includes("nothing reads its output")),
      `expected an unconsumed-output finding, got: ${findings.join("; ")}`
    );
  });

  it("does not flag completionOutput that a patch reads", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          instanceState: [
            { field: "title", type: "string" },
            { field: "category", type: "string" },
          ],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "running"
              ? {
                  ...s,
                  tasks: [
                    {
                      id: "run",
                      label: "Run",
                      role: "ai-task",
                      systemPrompt: "Return a category.",
                      completionOutput: [{ field: "category", type: "string" }],
                    },
                    {
                      id: "record",
                      label: "Record",
                      role: "operation",
                      patch: {
                        category: {
                          kind: "taskOutput",
                          task: "run",
                          path: "output.category",
                        },
                      },
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const findings = analyzeFlowSpec(spec);
    assert.ok(
      !findings.some((f) => f.includes("nothing reads its output")),
      `unexpected unconsumed-output finding: ${findings.join("; ")}`
    );
  });

  it("flags a flow with no creation path", () => {
    const spec: FlowSpec = {
      ...VALID,
      actions: [],
      edges: [],
    };
    const findings = analyzeFlowSpec(spec);
    assert.ok(
      findings.some((f) => f.includes("nothing ever creates an instance")),
      `expected a creation-path finding, got: ${findings.join("; ")}`
    );
  });
});

describe("manual-action fields", () => {
  it("accepts an action whose input fields are declared in instanceState", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          instanceState: [
            { field: "title", type: "string" },
            { field: "note", type: "string" },
          ],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "ready"
              ? {
                  ...s,
                  actions: [
                    ...(s.actions ?? []),
                    {
                      id: "request_correction",
                      label: "Request correction",
                      variant: "primary",
                      transitionTo: "approved",
                      fields: [
                        {
                          key: "note",
                          label: "What to fix",
                          type: "string",
                          required: true,
                        },
                      ],
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    assert.deepEqual(validateFlowSpec(spec), []);
  });

  it("rejects an action field not declared in instanceState", () => {
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "ready"
              ? {
                  ...s,
                  actions: [
                    ...(s.actions ?? []),
                    {
                      id: "request_correction",
                      label: "Request correction",
                      transitionTo: "approved",
                      fields: [
                        {
                          key: "note",
                          label: "What to fix",
                          type: "string",
                        },
                      ],
                    },
                  ],
                }
              : s
          ),
        },
      ],
    };
    const message = messageFor(spec, "not declared in instanceState");
    assert.ok(
      message,
      `expected a declared-field error, got: ${errorsFor(spec)
        .map((e) => e.message)
        .join("; ")}`
    );
  });

  it("counts manual-action fields as writers of instance state", () => {
    // A field that is only written by an action payload (never by a patch,
    // edge, or createInstance) must not be flagged as "read with no writer".
    const spec: FlowSpec = {
      ...VALID,
      workflows: [
        {
          ...VALID.workflows[0],
          instance: { title: "note" },
          instanceState: [{ field: "note", type: "string" }],
          states: VALID.workflows[0].states.map((s) =>
            s.id === "ready"
              ? {
                  ...s,
                  actions: [
                    {
                      id: "note_it",
                      label: "Note it",
                      transitionTo: "approved",
                      fields: [{ key: "note", label: "Note", type: "string" }],
                    },
                  ],
                }
              : s
          ),
        },
      ],
      actions: [],
    };
    assert.deepEqual(validateFlowSpec(spec), []);
  });
});
