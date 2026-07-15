import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ToolExecutionContext } from "./create-local-tool-registry";
import { createLocalToolRegistry } from "./create-local-tool-registry";

function tmpDir(): string {
  return path.join(
    os.tmpdir(),
    `hive-tools-test-${String(Date.now())}-${String(Math.random().toString(36).slice(2))}`
  );
}

function toolCall(
  id: string,
  name: string,
  args: Record<string, unknown>
): { id: string; name: string; arguments: string } {
  return { id, name, arguments: JSON.stringify(args) };
}

await describe("createLocalToolRegistry", async () => {
  let workspacePath: string;
  let context: ToolExecutionContext;

  before(async () => {
    workspacePath = tmpDir();
    await fs.mkdir(workspacePath, { recursive: true });
    context = { sessionId: "test-session", workspacePath };
  });

  after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  await it("returns three built-in tool definitions", async () => {
    const registry = createLocalToolRegistry({ workspacePath });
    const defs = registry.getDefinitions();

    assert.strictEqual(defs.length, 3);
    const names = defs.map((d) => d.function.name);
    assert.ok(names.includes("read_file"));
    assert.ok(names.includes("write_file"));
    assert.ok(names.includes("run_command"));
  });

  await it("returns error for unknown tool", async () => {
    const registry = createLocalToolRegistry({ workspacePath });
    const result = await registry.execute(
      toolCall("c1", "nonexistent_tool", {}),
      context
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content.includes("unknown tool"));
  });

  await it("read_file returns error for missing file", async () => {
    const registry = createLocalToolRegistry({ workspacePath });
    const result = await registry.execute(
      toolCall("c1", "read_file", { path: "does-not-exist.txt" }),
      context
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content.includes("ENOENT"));
  });

  await it("read_file reads file content", async () => {
    const filePath = path.join(workspacePath, "hello.txt");
    await fs.writeFile(filePath, "hello world", "utf-8");

    const registry = createLocalToolRegistry({ workspacePath });
    const result = await registry.execute(
      toolCall("c1", "read_file", { path: "hello.txt" }),
      context
    );

    assert.strictEqual(result.isError, false);
    assert.strictEqual(result.content, "hello world");
    assert.strictEqual(result.toolCallId, "c1");
  });

  await it("read_file rejects paths escaping workspace", async () => {
    const registry = createLocalToolRegistry({ workspacePath });
    const result = await registry.execute(
      toolCall("c1", "read_file", { path: "../etc/passwd" }),
      context
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content.includes("escapes workspace"));
  });

  await it("write_file creates file and parent directories", async () => {
    const registry = createLocalToolRegistry({ workspacePath });
    const result = await registry.execute(
      toolCall("c1", "write_file", {
        path: "sub/dir/file.txt",
        content: "new content",
      }),
      context
    );

    assert.strictEqual(result.isError, false);
    assert.ok(result.content.includes("wrote"));

    const written = await fs.readFile(
      path.join(workspacePath, "sub/dir/file.txt"),
      "utf-8"
    );
    assert.strictEqual(written, "new content");
  });

  await it("write_file rejects paths escaping workspace", async () => {
    const registry = createLocalToolRegistry({ workspacePath });
    const result = await registry.execute(
      toolCall("c1", "write_file", { path: "../escape.txt", content: "bad" }),
      context
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content.includes("escapes workspace"));
  });

  await it("run_command executes a command", async () => {
    const registry = createLocalToolRegistry({ workspacePath });
    const result = await registry.execute(
      toolCall("c1", "run_command", { command: "echo", args: ["hello"] }),
      context
    );

    assert.strictEqual(result.isError, false);
    assert.ok(result.content.includes("hello"));
  });

  await it("run_command returns error for failing command", async () => {
    const registry = createLocalToolRegistry({ workspacePath });
    const result = await registry.execute(
      toolCall("c1", "run_command", { command: "false" }),
      context
    );

    assert.strictEqual(result.isError, true);
  });
});
