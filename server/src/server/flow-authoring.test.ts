// The flow-authoring knowledge, read at runtime from the self-contained skill
// (`skills/flow-authoring/*.md`): every rung the authoring flow needs must be
// present and substantive, and the skill must carry no retired vocabulary
// (the patterns rung was removed — the decisions/rules/vocabulary rungs guide
// generation on their own).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readKnowledge } from "./flow-authoring/knowledge.ts";

describe("flow-authoring knowledge", () => {
  it("reads every knowledge rung from the skill directory", () => {
    for (const topic of ["decisions", "rules", "vocabulary"] as const) {
      const content = readKnowledge(topic);
      assert.ok(content.length > 200, `${topic} knowledge must be substantive`);
    }
  });

  it("the decisions rung carries the design sequence, not the retired patterns", () => {
    const decisions = readKnowledge("decisions");
    assert.match(decisions, /## How to design a flow \(decisions, in order\)/);
    assert.match(decisions, /1\. \*\*Entities\.\*\*/);
    assert.match(
      decisions,
      /9\. \*\*Custom logic beyond the structured vocabulary/
    );
    assert.ok(
      !decisions.includes("Pick the pattern"),
      "the retired patterns rung must not leak into the decisions"
    );
  });

  it("the rules rung carries the failure-mode guardrails", () => {
    const rules = readKnowledge("rules");
    assert.match(rules, /## Rules that make generated flows actually work/);
    assert.match(rules, /declares a `systemPrompt`/);
    assert.match(
      rules,
      /Implement a referenced file by keeping the export name and contract/
    );
    assert.ok(
      !rules.includes("Choose the pattern"),
      "the retired pattern-matching rule must not leak into the rules"
    );
  });

  it("the vocabulary rung carries the pure-data shape", () => {
    const vocabulary = readKnowledge("vocabulary");
    assert.match(vocabulary, /## FlowDefinition vocabulary/);
    assert.match(vocabulary, /WORKFLOW: \{/);
    assert.match(vocabulary, /CONSTRAINTS/);
    assert.match(vocabulary, /REFERENCED FILES/);
  });
});
