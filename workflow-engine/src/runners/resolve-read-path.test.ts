// The read-path resolver: a requested path resolves within the task's
// workspace first, then within each session-granted extra read root — so a
// path the human handed over in chat is reachable even outside the workspace.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveReadPath } from "../runners/resolve-read-path.ts";

describe("resolveReadPath", () => {
  it("resolves within the workspace as before", () => {
    assert.equal(
      resolveReadPath("docs/a.md", "/ws", undefined),
      join("/ws", "docs/a.md")
    );
    assert.equal(resolveReadPath(".", "/ws", undefined), "/ws");
  });

  it("rejects escapes with no extra roots", () => {
    assert.equal(resolveReadPath("../outside", "/ws", undefined), undefined);
    assert.equal(resolveReadPath("/abs/path", "/ws", undefined), undefined);
  });

  it("resolves within an extra root when the workspace is escaped", () => {
    const roots = ["/ext/effect"];
    assert.equal(
      resolveReadPath("/ext/effect/src/index.ts", "/ws", roots),
      "/ext/effect/src/index.ts"
    );
    assert.equal(resolveReadPath("/ext/other/x.ts", "/ws", roots), undefined);
    assert.equal(resolveReadPath("../../x", "/ws", roots), undefined);
  });
});

// The tools' containment against a root (moved here so read tools share it).
describe("resolveReadPath real fs", () => {
  it("reaches a real file under an extra root", () => {
    const ws = mkdtempSync(join(tmpdir(), "hive-rs-ws-"));
    const ext = mkdtempSync(join(tmpdir(), "hive-rs-ext-"));
    writeFileSync(join(ext, "lib.txt"), "content");
    try {
      assert.equal(
        resolveReadPath(join(ext, "lib.txt"), ws, [ext]),
        join(ext, "lib.txt")
      );
      // A path that escapes both the workspace and the extra root is denied.
      assert.equal(
        resolveReadPath("../../../etc/passwd", ws, [ext]),
        undefined
      );
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(ext, { recursive: true, force: true });
    }
  });
});
