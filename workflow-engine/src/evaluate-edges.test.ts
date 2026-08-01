import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateEdges } from "./evaluate-edges";
import type { FlowEdge } from "./workflow-types";

const testEdges: FlowEdge[] = [
  {
    fromWorkflow: "source",
    fromStates: ["done"],
    toWorkflow: "target",
    transform: (source) => ({
      merged: source.doWork?.output,
      triggeredAt: new Date().toISOString(),
    }),
  },
  {
    fromWorkflow: "source",
    fromStates: ["errored"],
    toWorkflow: "target",
  },
];

describe("evaluateEdges", () => {
  it("activates edge when state matches fromStates", () => {
    const effects = evaluateEdges(testEdges, "source", "done", {
      doWork: { status: "success", output: { result: "ok" } },
    });

    assert.equal(effects.length, 1);
    assert.equal(effects[0]!.fromWorkflow, "source");
    assert.equal(effects[0]!.toWorkflow, "target");
    assert.equal(effects[0]!.fromState, "done");
  });

  it("passes task outputs to transform function", () => {
    const effects = evaluateEdges(testEdges, "source", "done", {
      doWork: { status: "success", output: { result: "ok" } },
    });

    assert.equal(effects.length, 1);
    assert.deepEqual(readMerged(effects[0]!.transformedData), {
      result: "ok",
    });
  });

  it("does not activate edge for non-matching state", () => {
    const effects = evaluateEdges(testEdges, "source", "started", {
      doWork: { status: "success", output: {} },
    });

    assert.equal(effects.length, 0);
  });

  it("does not activate edge for different workflow", () => {
    const effects = evaluateEdges(testEdges, "other", "done", {});

    assert.equal(effects.length, 0);
  });

  it("handles transform-less edges", () => {
    const effects = evaluateEdges(testEdges, "source", "errored", {});

    assert.equal(effects.length, 1);
    assert.deepEqual(effects[0]!.transformedData, {});
  });

  it("returns multiple effects when multiple edges match", () => {
    const edges = [
      {
        fromWorkflow: "source",
        fromStates: ["done", "errored"],
        toWorkflow: "target-a",
      },
      {
        fromWorkflow: "source",
        fromStates: ["done"],
        toWorkflow: "target-b",
      },
    ];

    const effects = evaluateEdges(edges, "source", "done", {});
    assert.equal(effects.length, 2);
    assert.equal(effects[0]!.toWorkflow, "target-a");
    assert.equal(effects[1]!.toWorkflow, "target-b");
  });

  it("activates toFlowState edge when state matches", () => {
    const edges: FlowEdge[] = [
      {
        fromWorkflow: "source",
        fromStates: ["done"],
        toFlowState: true,
      },
    ];
    const effects = evaluateEdges(edges, "source", "done", { result: "ok" });
    assert.equal(effects.length, 1);
    assert.equal(effects[0]!.toFlowState, true);
    assert.equal(effects[0]!.toWorkflow, undefined);
  });

  it("fans out one effect per element of an array transform", () => {
    const edges: FlowEdge[] = [
      {
        fromWorkflow: "source",
        fromStates: ["done"],
        toWorkflow: "cards",
        transform: (source) => {
          // The source output map is erased to Record; the plan shape is
          // established by the workflow authoring the transform.
          const planOutput = source.plan?.output as
            | { cards?: Array<{ title: string }> }
            | undefined;
          return (planOutput?.cards ?? []).map((card) => ({
            cardSpec: card,
          }));
        },
      },
    ];

    const effects = evaluateEdges(edges, "source", "done", {
      plan: {
        status: "success",
        output: {
          kind: "proposal",
          cards: [{ title: "A" }, { title: "B" }],
        },
      },
    });

    assert.equal(effects.length, 2);
    assert.equal(effects[0]!.toWorkflow, "cards");
    assert.deepEqual(effects[0]!.transformedData, { cardSpec: { title: "A" } });
    assert.deepEqual(effects[1]!.transformedData, { cardSpec: { title: "B" } });
  });
});

function readMerged(data: Record<string, unknown>): unknown {
  return data["merged"];
}
