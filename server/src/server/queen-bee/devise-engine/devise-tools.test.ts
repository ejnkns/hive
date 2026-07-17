import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEVISE_TOOLS, executeDeviseTool } from "./devise-tools";

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-tool-test-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"name":"test-app"}');
  writeFileSync(
    join(dir, "src", "index.ts"),
    "export function hello() { return 'hi'; }"
  );
  writeFileSync(
    join(dir, "src", "utils.ts"),
    "export function add(a: number, b: number) { return a + b; }"
  );
  writeFileSync(join(dir, "README.md"), "# Test App\n\nhello world");
  return dir;
}

describe("DEVISE_TOOLS", () => {
  it("registers three tools", () => {
    assert.strictEqual(DEVISE_TOOLS.length, 4);
    const names = DEVISE_TOOLS.map((t) => t.function.name);
    assert.deepStrictEqual(names.sort(), [
      "list_directory",
      "read_file",
      "search_code",
      "update_requirements",
    ]);
  });

  it("all tools have required parameters", () => {
    for (const tool of DEVISE_TOOLS) {
      assert.ok(tool.function.parameters.required.length > 0);
    }
  });
});

describe("executeDeviseTool", () => {
  describe("list_directory", () => {
    it("lists directory contents", () => {
      const workspace = createTempWorkspace();
      const result = executeDeviseTool(
        { id: "tc1", name: "list_directory", arguments: '{"path":"."}' },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.ok(result.content.includes("package.json"));
      assert.ok(result.content.includes("src/"));
    });

    it("filters dotfiles except .hive", () => {
      const workspace = createTempWorkspace();
      mkdirSync(join(workspace, ".hive"), { recursive: true });
      writeFileSync(join(workspace, ".hive", "project.json"), "{}");

      const result = executeDeviseTool(
        { id: "tc1", name: "list_directory", arguments: '{"path":"."}' },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.ok(result.content.includes(".hive/"));
    });

    it("rejects path escape", () => {
      const workspace = createTempWorkspace();
      const result = executeDeviseTool(
        {
          id: "tc1",
          name: "list_directory",
          arguments: '{"path":"../../etc"}',
        },
        workspace
      );

      assert.strictEqual(result.isError, true);
      assert.ok(result.content.includes("escapes"));
    });
  });

  describe("read_file", () => {
    it("reads file contents", () => {
      const workspace = createTempWorkspace();
      const result = executeDeviseTool(
        { id: "tc1", name: "read_file", arguments: '{"path":"package.json"}' },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.ok(result.content.includes("test-app"));
    });

    it("rejects missing path argument", () => {
      const result = executeDeviseTool(
        { id: "tc1", name: "read_file", arguments: "{}" },
        "/tmp"
      );

      assert.strictEqual(result.isError, true);
    });

    it("rejects path escape", () => {
      const workspace = createTempWorkspace();
      const result = executeDeviseTool(
        {
          id: "tc1",
          name: "read_file",
          arguments: '{"path":"../../../etc/passwd"}',
        },
        workspace
      );

      assert.strictEqual(result.isError, true);
      assert.ok(result.content.includes("escapes"));
    });

    it("rejects directories", () => {
      const workspace = createTempWorkspace();
      const result = executeDeviseTool(
        { id: "tc1", name: "read_file", arguments: '{"path":"src"}' },
        workspace
      );

      assert.strictEqual(result.isError, true);
      assert.ok(result.content.includes("directory"));
    });
  });

  describe("search_code", () => {
    it("finds matches using rg", () => {
      const workspace = createTempWorkspace();
      const result = executeDeviseTool(
        { id: "tc1", name: "search_code", arguments: '{"pattern":"hello"}' },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.ok(result.content.includes("README.md"));
    });

    it("returns no matches for unknown pattern", () => {
      const workspace = createTempWorkspace();
      const result = executeDeviseTool(
        {
          id: "tc1",
          name: "search_code",
          arguments: '{"pattern":"xyznonexistent123"}',
        },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.strictEqual(result.content, "No matches found");
    });

    it("rejects missing pattern argument", () => {
      const result = executeDeviseTool(
        { id: "tc1", name: "search_code", arguments: "{}" },
        "/tmp"
      );

      assert.strictEqual(result.isError, true);
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool name", () => {
      const result = executeDeviseTool(
        { id: "tc1", name: "unknown_tool", arguments: "{}" },
        "/tmp"
      );

      assert.strictEqual(result.isError, true);
      assert.ok(result.content.includes("Unknown tool"));
    });
  });

  describe("update_requirements", () => {
    it("writes content to .hive/requirements.md", () => {
      const workspace = createTempWorkspace();
      const content = "# Requirements\n\n## Overview\nTest spec";

      const result = executeDeviseTool(
        {
          id: "tc1",
          name: "update_requirements",
          arguments: JSON.stringify({ content }),
        },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.strictEqual(result.content, "Requirements document updated");

      const written = readFileSync(
        join(workspace, ".hive", "requirements.md"),
        "utf-8"
      );
      assert.strictEqual(written, content);
    });

    it("creates .hive directory if it does not exist", () => {
      const workspace = mkdtempSync(join(tmpdir(), "hive-tool-test-"));
      writeFileSync(join(workspace, "package.json"), "{}");

      const content = "# Requirements\n\n## Overview\nProject spec";

      const result = executeDeviseTool(
        {
          id: "tc1",
          name: "update_requirements",
          arguments: JSON.stringify({ content }),
        },
        workspace
      );

      assert.strictEqual(result.isError, false);

      const written = readFileSync(
        join(workspace, ".hive", "requirements.md"),
        "utf-8"
      );
      assert.strictEqual(written, content);
    });

    it("overwrites existing file content", () => {
      const workspace = createTempWorkspace();
      const initial = "# Requirements\n\n## Overview\nOld content";
      const updated =
        "# Requirements\n\n## Overview\nNew content\n\n## Functional requirements\n- FR-1: Something";

      executeDeviseTool(
        {
          id: "tc1",
          name: "update_requirements",
          arguments: JSON.stringify({ content: initial }),
        },
        workspace
      );

      const result = executeDeviseTool(
        {
          id: "tc2",
          name: "update_requirements",
          arguments: JSON.stringify({ content: updated }),
        },
        workspace
      );

      assert.strictEqual(result.isError, false);

      const written = readFileSync(
        join(workspace, ".hive", "requirements.md"),
        "utf-8"
      );
      assert.strictEqual(written, updated);
    });

    it("rejects missing content argument", () => {
      const result = executeDeviseTool(
        { id: "tc1", name: "update_requirements", arguments: "{}" },
        "/tmp"
      );

      assert.strictEqual(result.isError, true);
    });
  });
});
