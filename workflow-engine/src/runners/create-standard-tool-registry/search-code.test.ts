import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ToolContext } from "../tool-types";
import { execute } from "./search-code";

// Agents must be able to see the flow's domain state: it lives in a hidden
// directory (.queen-bee/requirements.md is the authoritative spec), and
// ripgrep skips hidden files by default. search_code passes --hidden so a
// worker/coordinator can discover it instead of concluding "no spec exists".
let workspace: string;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "hive-search-code-"));
  writeFileSync(join(workspace, "main.py"), "# FR-3 click cycling\n");
  mkdirSync(join(workspace, ".queen-bee"));
  writeFileSync(
    join(workspace, ".queen-bee", "requirements.md"),
    "# FR-3 the requirements\n"
  );
  // The flow's domain state is meant to be git-tracked (VISION: persisted
  // outputs live in version history), so it is not ignored — the bug was pure
  // hidden-file blindness, not ignore rules.
  execSync("git init -q", { cwd: workspace });
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("search_code", () => {
  it("finds matches in hidden files (the flow's domain state)", async () => {
    const ctx: ToolContext = { workspacePath: workspace };
    const result = await execute(
      {
        id: "s1",
        name: "search_code",
        arguments: JSON.stringify({ pattern: "FR-3" }),
      },
      ctx
    );
    assert.equal(result.isError, false);
    assert.match(result.content, /requirements\.md/);
  });
});
