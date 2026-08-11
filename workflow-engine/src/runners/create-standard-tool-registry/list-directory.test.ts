import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ToolContext } from "../tool-types.ts";
import { execute } from "./list-directory.ts";

// The flow's domain state lives in a hidden directory (.queen-bee/); a
// directory listing that hides dot-entries blinds agents to the authoritative
// spec. list_directory includes hidden entries.
let workspace: string;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "hive-list-dir-"));
  writeFileSync(join(workspace, "main.py"), "");
  mkdirSync(join(workspace, ".queen-bee"));
  writeFileSync(join(workspace, ".queen-bee", "requirements.md"), "");
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("list_directory", () => {
  it("lists hidden entries (the flow's domain state) alongside visible files", async () => {
    const ctx: ToolContext = { workspacePath: workspace };
    const result = await execute(
      {
        id: "l1",
        name: "list_directory",
        arguments: JSON.stringify({ path: "." }),
      },
      ctx
    );
    assert.equal(result.isError, false);
    assert.match(result.content, /main\.py/);
    assert.match(result.content, /\.queen-bee\//);
  });
});
