// The session read-grant end to end: a user message that is itself a path
// lets read_file / list_directory reach files outside the workspace.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { ToolContext } from "../tool-types.ts";
import { execute as listDirectory } from "./list-directory.ts";
import { execute as readFile } from "./read-file.ts";

describe("read tools with granted extra roots", () => {
  const dirs: string[] = [];
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "hive-read-grant-"));
    dirs.push(dir);
    return dir;
  }
  after(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("read_file reaches a file under a granted extra root", async () => {
    const ws = tempDir();
    const ext = tempDir();
    writeFileSync(join(ext, "lib.ts"), "export const x = 1;\n");
    const ctx: ToolContext = { workspacePath: ws, extraReadRoots: [ext] };

    const result = await readFile(
      {
        id: "c1",
        name: "read_file",
        arguments: JSON.stringify({ path: join(ext, "lib.ts") }),
      },
      ctx
    );
    assert.equal(result.isError, false);
    assert.ok(result.content.includes("export const x = 1;"));

    // Outside every root stays denied.
    const denied = await readFile(
      {
        id: "c2",
        name: "read_file",
        arguments: JSON.stringify({ path: "../../etc/passwd" }),
      },
      ctx
    );
    assert.equal(denied.isError, true);
  });

  it("list_directory lists a granted extra root and stays contained", async () => {
    const ws = tempDir();
    const ext = tempDir();
    writeFileSync(join(ext, "a.ts"), "// a");
    writeFileSync(join(ext, "b.ts"), "// b");
    const ctx: ToolContext = { workspacePath: ws, extraReadRoots: [ext] };

    const result = await listDirectory(
      {
        id: "c1",
        name: "list_directory",
        arguments: JSON.stringify({ path: ext }),
      },
      ctx
    );
    assert.equal(result.isError, false);
    assert.ok(result.content.includes("a.ts"), result.content);
    assert.ok(result.content.includes("b.ts"), result.content);
  });
});
