import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CustomRenderKind,
  RuntimeRenderHint,
} from "workflow-engine/workflow-types";
import { type ResolvedRender, resolveRender } from "./contract-resolution.ts";

type PlanProposal = {
  kind: "proposal";
  cards: Array<{
    title: string;
    description: string;
    acceptanceCriteria: string[];
  }>;
};

const planOutput: PlanProposal = {
  kind: "proposal",
  cards: [
    {
      title: "Add ideas",
      description: "Let users propose ideas",
      acceptanceCriteria: ["ideas list", "submit form"],
    },
    {
      title: "Plan cards",
      description: "Turn ideas into cards",
      acceptanceCriteria: ["planner agent"],
    },
  ],
};

function resolve(
  hint: RuntimeRenderHint,
  output: unknown = planOutput,
  customKinds: readonly CustomRenderKind[] = []
): ResolvedRender {
  return resolveRender({ output, hint, customKinds });
}

describe("resolveRender", () => {
  it("resolves output-scoped props against the task output", () => {
    const result = resolve(
      {
        kind: "markdown",
        props: { content: "content" },
      },
      { content: "# Title", revision: "r1" }
    );
    assert.equal(result.kind, "markdown");
    assert.equal(result.props.content, "# Title");
  });

  it("auto-binds the single output prop to the root when props are omitted", () => {
    const result = resolve({ kind: "markdown" }, "plain string");
    assert.equal(result.kind, "markdown");
    assert.equal(result.props.content, "plain string");
  });

  it("maps element-scoped props against each item of the array prop", () => {
    const result = resolve({
      kind: "cards",
      props: {
        items: "cards",
        title: "title",
        description: "description",
        bullets: "acceptanceCriteria",
      },
    });
    assert.equal(result.kind, "cards");
    assert.deepEqual(result.props.items, [
      {
        title: "Add ideas",
        description: "Let users propose ideas",
        bullets: ["ideas list", "submit form"],
      },
      {
        title: "Plan cards",
        description: "Turn ideas into cards",
        bullets: ["planner agent"],
      },
    ]);
  });

  it("keeps a missing per-item element path as undefined, not a mismatch", () => {
    const result = resolve(
      {
        kind: "cards",
        props: {
          items: "cards",
          title: "title",
          bullets: "acceptanceCriteria",
        },
      },
      {
        kind: "proposal",
        cards: [{ title: "A", acceptanceCriteria: ["x"] }],
      }
    );
    assert.equal(result.kind, "cards");
    assert.deepEqual(result.props.items, [{ title: "A", bullets: ["x"] }]);
  });

  it("falls back to json for an unknown kind", () => {
    const result = resolve({ kind: "not-a-kind", props: {} });
    assert.equal(result.kind, "json");
    assert.equal(result.props.value, planOutput);
  });

  it("falls back to json when a bound output prop mismatches its contract", () => {
    const result = resolve(
      { kind: "markdown", props: { content: "content" } },
      { content: 42 }
    );
    assert.equal(result.kind, "json");
    assert.deepEqual(result.props.value, { content: 42 });
  });

  it("falls back to json when the array prop is not an array", () => {
    const result = resolve(
      {
        kind: "cards",
        props: { items: "cards", title: "title" },
      },
      { cards: "not-an-array" }
    );
    assert.equal(result.kind, "json");
  });

  it("falls back to json when element props are bound but no array prop is", () => {
    const result = resolve({
      kind: "cards",
      props: { title: "title" },
    });
    assert.equal(result.kind, "json");
  });

  it("falls back to json when an output path does not resolve", () => {
    const result = resolve(
      { kind: "markdown", props: { content: "missing.path" } },
      { content: "present" }
    );
    assert.equal(result.kind, "json");
  });

  it("falls back to json when a hint resolves to no props at all", () => {
    const result = resolve({ kind: "card" }, planOutput);
    assert.equal(result.kind, "json");
    assert.equal(result.props.value, planOutput);
  });

  it("renders the json kind as the raw output", () => {
    const result = resolve({ kind: "json" }, { anything: [1, 2] });
    assert.equal(result.kind, "json");
    assert.deepEqual(result.props.value, { anything: [1, 2] });
  });

  it("validates a flow-declared custom kind against its contract", () => {
    const customKinds: CustomRenderKind[] = [
      {
        kind: "mycards",
        contract: {
          props: [
            { name: "items", type: "array", scope: "output" },
            { name: "title", type: "string", scope: "element" },
          ],
        },
      },
    ];
    const result = resolve(
      { kind: "mycards", props: { items: "cards", title: "title" } },
      planOutput,
      customKinds
    );
    assert.equal(result.kind, "mycards");
    assert.deepEqual(result.props.items, [
      { title: "Add ideas" },
      { title: "Plan cards" },
    ]);
  });

  it("falls back to json when a custom kind contract mismatches", () => {
    const customKinds: CustomRenderKind[] = [
      {
        kind: "mycards",
        contract: {
          props: [
            { name: "items", type: "array", scope: "output" },
            { name: "title", type: "string", scope: "element" },
          ],
        },
      },
    ];
    const result = resolve(
      { kind: "mycards", props: { items: "cards", title: "title" } },
      { cards: "not-an-array" },
      customKinds
    );
    assert.equal(result.kind, "json");
  });
});
