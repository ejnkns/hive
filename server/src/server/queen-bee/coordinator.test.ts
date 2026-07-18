import assert from "node:assert";
import { describe, it } from "node:test";
import type { Card } from "./board-store";
import { createCoordinator } from "./coordinator";
import type { DeviseModelCaller } from "./devise-engine/create-devise-model-caller";

describe("Coordinator", () => {
  it("returns structured remediation suggestions from a model response", async () => {
    const coordinator = createCoordinator({
      call: async () => ({
        content: `\`\`\`json
{
  "summary": "The package is unavailable from the configured registry.",
  "suggestions": [
    {
      "id": "use-vendored-package",
      "action": "retry_with_patch",
      "rationale": "Use the already-vendored equivalent.",
      "cardPatch": { "description": "Use the vendored package." },
      "requirementsContent": "# Requirements\\n\\n## Functional requirements\\n- [FR-1] Use the vendored package."
    }
  ]
}
\`\`\``,
        toolCalls: [],
        finishReason: "stop",
      }),
    } as DeviseModelCaller);

    const result = await coordinator.analyze(
      card(),
      "# Requirements\n\n- [FR-1] Use a package."
    );

    assert.strictEqual(
      result.summary,
      "The package is unavailable from the configured registry."
    );
    assert.strictEqual(result.suggestions[0]?.action, "retry_with_patch");
    assert.strictEqual(
      result.suggestions[0]?.cardPatch?.description,
      "Use the vendored package."
    );
  });
});

function card(): Card {
  return {
    id: "card-1",
    title: "Use package",
    description: "Use a package.",
    acceptanceCriteria: ["Package works"],
    relevantFiles: ["package.json"],
    dependencies: [],
    column: "unfulfillable",
    createdAt: "2026-07-18T00:00:00.000Z",
    handover: {
      problem: "Package unavailable",
      attempted: ["Installed it"],
      blockedBy: ["Registry unavailable"],
      occurredAt: "2026-07-18T00:00:00.000Z",
    },
  };
}
