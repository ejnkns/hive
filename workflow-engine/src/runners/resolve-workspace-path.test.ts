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

  it("throws with no declared workspace and no basePath — never the daemon's cwd", () => {
    assert.throws(
      () => resolveWorkspacePath(undefined, undefined),
      /No workspace to operate in.*never the daemon's cwd/
    );
  });

  it("throws when an @instance ref does not resolve and there is no basePath", () => {
    assert.throws(
      () => resolveWorkspacePath("@instance:missing", {}),
      /No workspace to operate in/
    );
  });
});
