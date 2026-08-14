// The flow-authoring knowledge core: the reference document must carry every
// rung the authoring flow needs (decisions → patterns → rules → vocabulary →
// capabilities), and the reference exemplar the agent copies must stay valid
// as a pure-data definition.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTHORING_RULES,
  DESIGN_DECISIONS,
  FLOW_DEFINITION_SHAPE,
  FLOW_PATTERNS,
  flowAuthoringMarkdown,
  STRUCTURED_INTAKE_EXEMPLAR,
} from "./flow-authoring.ts";
import {
  analyzeFlowDefinition,
  validateFlowDefinition,
} from "./flow-definition.ts";

describe("flow-authoring knowledge", () => {
  it("the reference document carries every knowledge rung in order", () => {
    const markdown = flowAuthoringMarkdown();
    const decisionIndex = markdown.indexOf(DESIGN_DECISIONS);
    const patternsIndex = markdown.indexOf("## Patterns");
    const rulesIndex = markdown.indexOf(AUTHORING_RULES);
    const vocabularyIndex = markdown.indexOf(FLOW_DEFINITION_SHAPE);
    const capabilitiesIndex = markdown.indexOf("## Engine capabilities");

    for (const [name, index] of [
      ["decisions", decisionIndex],
      ["patterns", patternsIndex],
      ["rules", rulesIndex],
      ["vocabulary", vocabularyIndex],
      ["capabilities", capabilitiesIndex],
    ] as const) {
      assert.ok(index >= 0, `reference missing ${name}`);
    }

    // Every pattern is named so the agent can pick one.
    for (const pattern of FLOW_PATTERNS) {
      assert.ok(
        markdown.includes(pattern.name),
        `reference missing pattern ${pattern.name}`
      );
    }
    // The full exemplar is embedded, not just named.
    assert.ok(
      markdown.includes("Item Intake"),
      "the structured-intake exemplar must be embedded"
    );
  });

  it("the structured-intake exemplar validates as a pure-data definition", () => {
    assert.deepEqual(
      validateFlowDefinition(STRUCTURED_INTAKE_EXEMPLAR),
      [],
      "the reference exemplar must be a valid definition"
    );
    assert.deepEqual(
      analyzeFlowDefinition(STRUCTURED_INTAKE_EXEMPLAR),
      [],
      "the reference exemplar must analyze clean (zero warnings)"
    );
  });
});
