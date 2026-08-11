// The flow-authoring knowledge core: the prompt must carry every rung the
// generation model needs (decisions → patterns → rules → vocabulary →
// capabilities), the markdown export must carry the same core, and the
// reference exemplar the model copies must stay valid.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTHORING_RULES,
  buildFlowAuthoringPrompt,
  DESIGN_DECISIONS,
  FLOW_PATTERNS,
  FLOW_SPEC_SHAPE,
  flowAuthoringMarkdown,
  STRUCTURED_INTAKE_EXEMPLAR,
} from "./flow-authoring.ts";
import { validateFlowSpec } from "./flow-spec.ts";

describe("flow-authoring knowledge", () => {
  it("the generation prompt carries every knowledge rung in order", () => {
    const prompt = buildFlowAuthoringPrompt();
    const decisionIndex = prompt.indexOf(DESIGN_DECISIONS);
    const patternsIndex = prompt.indexOf("## Patterns");
    const rulesIndex = prompt.indexOf(AUTHORING_RULES);
    const vocabularyIndex = prompt.indexOf(FLOW_SPEC_SHAPE);
    const capabilitiesIndex = prompt.indexOf("## Capabilities");
    const processIndex = prompt.indexOf("## Process");

    for (const [name, index] of [
      ["decisions", decisionIndex],
      ["patterns", patternsIndex],
      ["rules", rulesIndex],
      ["vocabulary", vocabularyIndex],
      ["capabilities", capabilitiesIndex],
      ["process", processIndex],
    ] as const) {
      assert.ok(index >= 0, `prompt missing ${name}`);
    }
    assert.ok(
      decisionIndex < patternsIndex &&
        patternsIndex < rulesIndex &&
        rulesIndex < vocabularyIndex &&
        vocabularyIndex < capabilitiesIndex &&
        capabilitiesIndex < processIndex,
      "knowledge rungs must appear in the most-actionable-first order"
    );

    // Every pattern is named so the model can pick one.
    for (const pattern of FLOW_PATTERNS) {
      assert.ok(
        prompt.includes(pattern.name),
        `prompt missing pattern ${pattern.name}`
      );
    }
    // The full exemplar is embedded, not just named.
    assert.ok(
      prompt.includes("Item Intake"),
      "the structured-intake exemplar must be embedded"
    );
  });

  it("the markdown export carries the same core for humans and agents", () => {
    const markdown = flowAuthoringMarkdown();
    assert.ok(markdown.includes(DESIGN_DECISIONS));
    assert.ok(markdown.includes(AUTHORING_RULES));
    assert.ok(markdown.includes(FLOW_SPEC_SHAPE));
    assert.ok(markdown.includes("## Patterns"));
    assert.ok(markdown.includes("Item Intake"));
  });

  it("the structured-intake exemplar validates as a spec", () => {
    assert.deepEqual(
      validateFlowSpec(STRUCTURED_INTAKE_EXEMPLAR),
      [],
      "the reference exemplar must be a valid spec"
    );
  });
});
