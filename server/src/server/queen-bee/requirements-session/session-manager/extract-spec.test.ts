import assert from "node:assert";
import { describe, it } from "node:test";
import { extractSpec } from "./extract-spec";

describe("extractSpec", () => {
  it("strips REQUIREMENTS_COMPLETE signal and trims", () => {
    const content = "before\nREQUIREMENTS_COMPLETE\n# Spec\n\n## Hello";
    const result = extractSpec(content);
    assert.strictEqual(result, "before\n\n# Spec\n\n## Hello");
  });

  it("strips multiple occurrences of the signal", () => {
    const content = "REQUIREMENTS_COMPLETE\n\n# Spec\n\nREQUIREMENTS_COMPLETE";
    assert.strictEqual(extractSpec(content), "# Spec");
  });

  it("returns trimmed content when no signal present", () => {
    assert.strictEqual(extractSpec("  # Just text  "), "# Just text");
  });
});
