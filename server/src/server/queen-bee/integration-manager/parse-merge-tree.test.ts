import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMergeTreeResult } from "./parse-merge-tree";

describe("parseMergeTreeResult", () => {
  it("distinguishes an operational Git failure from a content conflict", () => {
    assert.deepEqual(
      parseMergeTreeResult({
        status: 129,
        stdout: "",
        stderr: "error: unknown option `write-tree'",
      }),
      {
        state: "error",
        message: "error: unknown option `write-tree'",
      }
    );
  });

  it("extracts conflict paths", () => {
    assert.deepEqual(
      parseMergeTreeResult({
        status: 1,
        stdout: "CONFLICT (content): Merge conflict in source.ts",
        stderr: "",
      }),
      { state: "conflicted", files: ["source.ts"] }
    );
  });
});
