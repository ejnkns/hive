import assert from "node:assert";
import { describe, it } from "node:test";
import { parseWorkerHandover } from "./parse-worker-handover";

describe("parseWorkerHandover", () => {
  it("parses a fenced terminal handover with multiple attempted and blocking items", () => {
    const handover = parseWorkerHandover(
      `I cannot safely proceed.\n\n\`\`\`\nHANDOVER\nPROBLEM: The required package is not available.\nATTEMPTED: Checked the lockfile\n- Retried installation\nBLOCKED_BY: Registry access is unavailable\n- No vendored package exists\n\`\`\``
    );

    assert.deepStrictEqual(handover, {
      problem: "The required package is not available.",
      attempted: ["Checked the lockfile", "Retried installation"],
      blockedBy: [
        "Registry access is unavailable",
        "No vendored package exists",
      ],
    });
  });

  it("returns null for ordinary completion text", () => {
    assert.strictEqual(parseWorkerHandover("Implemented the feature."), null);
  });
});
