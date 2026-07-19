import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AGENT_TOOLS, executeAgentTool } from "./devise-tools";

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

describe("AGENT_TOOLS", () => {
  it("registers three tools", () => {
    assert.strictEqual(AGENT_TOOLS.length, 4);
    const names = AGENT_TOOLS.map((t) => t.function.name);
    assert.deepStrictEqual(names.sort(), [
      "list_directory",
      "read_file",
      "search_code",
      "update_requirements_draft",
    ]);
  });

  it("all tools have required parameters", () => {
    for (const tool of AGENT_TOOLS) {
      assert.ok(tool.function.parameters.required.length > 0);
    }
  });
});

describe("executeAgentTool", () => {
  describe("list_directory", () => {
    it("lists directory contents", () => {
      const workspace = createTempWorkspace();
      const result = executeAgentTool(
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

      const result = executeAgentTool(
        { id: "tc1", name: "list_directory", arguments: '{"path":"."}' },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.ok(result.content.includes(".hive/"));
    });

    it("rejects path escape", () => {
      const workspace = createTempWorkspace();
      const result = executeAgentTool(
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
      const result = executeAgentTool(
        { id: "tc1", name: "read_file", arguments: '{"path":"package.json"}' },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.ok(result.content.includes("test-app"));
    });

    it("rejects missing path argument", () => {
      const result = executeAgentTool(
        { id: "tc1", name: "read_file", arguments: "{}" },
        "/tmp"
      );

      assert.strictEqual(result.isError, true);
    });

    it("rejects path escape", () => {
      const workspace = createTempWorkspace();
      const result = executeAgentTool(
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
      const result = executeAgentTool(
        { id: "tc1", name: "read_file", arguments: '{"path":"src"}' },
        workspace
      );

      assert.strictEqual(result.isError, true);
      assert.ok(result.content.includes("directory"));
    });

    it("reads the pinned project revision instead of uncommitted changes", () => {
      const workspace = createTempWorkspace();
      execFileSync("git", ["init"], { cwd: workspace });
      execFileSync("git", ["config", "user.email", "tests@hive.local"], {
        cwd: workspace,
      });
      execFileSync("git", ["config", "user.name", "Hive Tests"], {
        cwd: workspace,
      });
      execFileSync("git", ["add", "."], { cwd: workspace });
      execFileSync("git", ["commit", "-m", "test: create fixture"], {
        cwd: workspace,
      });
      const revision = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspace,
        encoding: "utf-8",
      }).trim();
      writeFileSync(join(workspace, "package.json"), '{"name":"changed"}');

      const result = executeAgentTool(
        {
          id: "tc1",
          name: "read_file",
          arguments: '{"path":"package.json"}',
        },
        workspace,
        revision
      );

      assert.strictEqual(result.isError, false);
      assert.ok(result.content.includes("test-app"));
      assert.ok(!result.content.includes("changed"));
    });
  });

  describe("search_code", () => {
    it("finds matches using rg", () => {
      const workspace = createTempWorkspace();
      const result = executeAgentTool(
        { id: "tc1", name: "search_code", arguments: '{"pattern":"hello"}' },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.ok(result.content.includes("README.md"));
    });

    it("returns no matches for unknown pattern", () => {
      const workspace = createTempWorkspace();
      const result = executeAgentTool(
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
      const result = executeAgentTool(
        { id: "tc1", name: "search_code", arguments: "{}" },
        "/tmp"
      );

      assert.strictEqual(result.isError, true);
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool name", () => {
      const result = executeAgentTool(
        { id: "tc1", name: "unknown_tool", arguments: "{}" },
        "/tmp"
      );

      assert.strictEqual(result.isError, true);
      assert.ok(result.content.includes("Unknown tool"));
    });
  });

  describe("update_requirements_draft", () => {
    it("returns a live draft without mutating canonical requirements", () => {
      const workspace = createTempWorkspace();
      mkdirSync(join(workspace, ".hive"), { recursive: true });
      writeFileSync(
        join(workspace, ".hive", "requirements.md"),
        "# Canonical requirements"
      );
      const content = "# Proposed requirements\n\n## Overview\nTest spec";

      const result = executeAgentTool(
        {
          id: "tc1",
          name: "update_requirements_draft",
          arguments: JSON.stringify({ content }),
        },
        workspace
      );

      assert.strictEqual(result.isError, false);
      assert.strictEqual(
        result.content,
        "Requirements draft updated for explicit user approval"
      );

      const canonical = readFileSync(
        join(workspace, ".hive", "requirements.md"),
        "utf-8"
      );
      assert.strictEqual(canonical, "# Canonical requirements");
    });

    it("rejects missing content argument", () => {
      const result = executeAgentTool(
        {
          id: "tc1",
          name: "update_requirements_draft",
          arguments: "{}",
        },
        "/tmp"
      );

      assert.strictEqual(result.isError, true);
    });
  });
});
