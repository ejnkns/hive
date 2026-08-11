import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWorkspacePath } from "./resolve-workspace-path.ts";

describe("resolveWorkspacePath", () => {
  it("returns a declared literal path", () => {
    assert.equal(
      resolveWorkspacePath("/repo/a", undefined, "/base"),
      "/repo/a"
    );
  });

  it("resolves an @instance ref from instance state", () => {
    const state = { worktreePath: "/worktrees/card-1" };
    assert.equal(
      resolveWorkspacePath("@instance:worktreePath", state, "/base"),
      "/worktrees/card-1"
    );
  });

  it("defaults to the flow basePath when no workspace is declared", () => {
    assert.equal(resolveWorkspacePath(undefined, undefined, "/base"), "/base");
  });

  it("falls back to the process cwd with no declared workspace and no basePath", () => {
    assert.equal(resolveWorkspacePath(undefined, undefined), process.cwd());
  });

  it("falls back to the basePath when an @instance ref does not resolve", () => {
    assert.equal(
      resolveWorkspacePath("@instance:missing", {}, "/base"),
      "/base"
    );
  });
});
