import assert from "node:assert";
import { describe, it } from "node:test";
import { REQUIREMENTS_AGENT_SYSTEM_PROMPT } from "./agent-prompt";

describe("REQUIREMENTS_AGENT_SYSTEM_PROMPT", () => {
  it("is non-empty", () => {
    assert.ok(REQUIREMENTS_AGENT_SYSTEM_PROMPT.length > 100);
  });

  it("contains key instructions", () => {
    assert.ok(REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("ONE question"));
    assert.ok(REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("RECOMMENDED ANSWER"));
    assert.ok(REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("BREADTH-FIRST"));
    assert.ok(
      REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("Codebase exploration")
    );
    assert.ok(
      REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("REQUIREMENTS_COMPLETE")
    );
    assert.ok(
      REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes(
        "requirements analyst, not an implementer"
      )
    );
  });
});
