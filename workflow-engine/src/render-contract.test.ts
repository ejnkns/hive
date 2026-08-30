import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { builtinRenderContracts, type RenderHint } from "./workflow-types.ts";

describe("builtin render contracts", () => {
  it("ships all six builtin kinds", () => {
    assert.deepEqual(Object.keys(builtinRenderContracts).sort(), [
      "card",
      "cards",
      "chips",
      "json",
      "markdown",
      "text",
    ]);
  });

  it("markdown and text take one output-scoped content string", () => {
    assert.deepEqual(builtinRenderContracts.markdown.props, [
      { name: "content", type: "string", scope: "output" },
    ]);
    assert.deepEqual(builtinRenderContracts.text.props, [
      { name: "content", type: "string", scope: "output" },
    ]);
  });

  it("card takes output-scoped title/description/bullets", () => {
    assert.deepEqual(builtinRenderContracts.card.props, [
      { name: "title", type: "string", scope: "output" },
      { name: "description", type: "string", scope: "output" },
      { name: "bullets", type: "string[]", scope: "output" },
    ]);
  });

  it("cards takes an output-scoped items array plus element-scoped fields", () => {
    assert.deepEqual(builtinRenderContracts.cards.props, [
      { name: "items", type: "array", scope: "output" },
      { name: "title", type: "string", scope: "element" },
      { name: "description", type: "string", scope: "element" },
      { name: "bullets", type: "string[]", scope: "element" },
    ]);
  });

  it("chips takes one output-scoped array prop (items)", () => {
    assert.deepEqual(builtinRenderContracts.chips.props, [
      { name: "items", type: "array", scope: "output" },
    ]);
  });

  it("json accepts anything", () => {
    assert.deepEqual(builtinRenderContracts.json.props, []);
  });
});

// ── Type assertion tests ──
//
// These verify the render hint type system catches expected errors at compile
// time (Level B: builtin kinds check prop names and output paths). Each
// "ts-expect-error" comment suppresses an intentional compile error; if that
// line would NOT produce an error, the directive itself fails to compile.

type PlanProposal =
  | {
      kind: "proposal";
      cards: Array<{
        title: string;
        description: string;
        acceptanceCriteria: string[];
      }>;
    }
  | { kind: "feedback"; guidance: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _validSeed: RenderHint<PlanProposal> = {
  kind: "cards",
  props: {
    items: "cards",
    title: "title",
    description: "description",
    bullets: "acceptanceCriteria",
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _validMarkdownFromContent: RenderHint<{
  content: string;
  revision: string;
}> = { kind: "markdown", props: { content: "content" } };

// The chips kind's single array prop binds to the root when props are omitted,
// so a display field can declare it with no props at all.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _validChips: RenderHint<{ tags: string[] }> = { kind: "chips" };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _validChipsFromProp: RenderHint<{ tags: string[] }> = {
  kind: "chips",
  props: { items: "tags" },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _chipsUnknownProp: RenderHint<{ tags: string[] }> = {
  kind: "chips",
  // @ts-expect-error: "bogus" is not a prop of the chips contract
  props: { bogus: "tags" },
};

const _unknownProp: RenderHint<PlanProposal> = {
  kind: "cards",
  // @ts-expect-error: "bogus" is not a prop of the cards contract
  props: { bogus: "cards" },
};

const _invalidOutputPath: RenderHint<PlanProposal> = {
  kind: "cards",
  // @ts-expect-error: "nonsense" is not a path into PlanProposal
  props: { items: "nonsense" },
};

const _wrongKindForProps: RenderHint<PlanProposal> = {
  kind: "markdown",
  // @ts-expect-error: the markdown contract has no "cards" prop
  props: { cards: "cards" },
};
