// The no-session files editor's shared tab/save semantics: the refs ∪
// persisted merge, and the persisted + non-empty-edits save payload.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFilesPayload, mergeFileTabs } from "./definition-files.ts";

describe("mergeFileTabs", () => {
  it("gives every declared ref a tab, unwritten ones empty", () => {
    const tabs = mergeFileTabs(["./tools/search.ts", "./gates/ok.ts"], {
      "./gates/ok.ts": "export const ok = true;",
    });
    assert.deepEqual(tabs, {
      "./tools/search.ts": "",
      "./gates/ok.ts": "export const ok = true;",
    });
  });

  it("keeps persisted files the source no longer references", () => {
    const tabs = mergeFileTabs([], { "./tools/stale.ts": "old" });
    assert.deepEqual(tabs, { "./tools/stale.ts": "old" });
  });

  it("dedupes: a persisted file that is also declared appears once", () => {
    const tabs = mergeFileTabs(["./gates/ok.ts"], {
      "./gates/ok.ts": "export const ok = true;",
    });
    assert.deepEqual(tabs, { "./gates/ok.ts": "export const ok = true;" });
  });
});

describe("buildFilesPayload", () => {
  it("overlays non-empty edits on the persisted files", () => {
    const files = buildFilesPayload(
      { "./gates/ok.ts": "old" },
      { "./gates/ok.ts": "new", "./tools/new.ts": "fresh" }
    );
    assert.deepEqual(files, {
      "./gates/ok.ts": "new",
      "./tools/new.ts": "fresh",
    });
  });

  it("skips the definition key and empty edits", () => {
    const files = buildFilesPayload(
      {},
      {
        definition: "export const flow = {};",
        "./tools/empty.ts": "",
        "./tools/written.ts": "content",
      }
    );
    assert.deepEqual(files, { "./tools/written.ts": "content" });
  });

  it("an emptied persisted file keeps its last content", () => {
    const files = buildFilesPayload(
      { "./gates/ok.ts": "export const ok = true;" },
      { "./gates/ok.ts": "" }
    );
    assert.deepEqual(files, { "./gates/ok.ts": "export const ok = true;" });
  });

  it("allowed restricts edits to the declared refs (no stale leftovers)", () => {
    const files = buildFilesPayload(
      {},
      { "./tools/declared.ts": "content", "./tools/stale.ts": "leftover" },
      new Set(["./tools/declared.ts"])
    );
    assert.deepEqual(files, { "./tools/declared.ts": "content" });
  });
});
