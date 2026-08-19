import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definitionModuleVersion } from "./flow-definitions.ts";

// The stateless served-module version: a content hash of the entry source
// plus its referenced module-set files. Determinism is the whole contract —
// the version rides in served-module URLs as `?v=…`, so an unchanged
// definition must load with the same version (browser module cache hits)
// while a definition save (any content change) must yield a new one.
describe("definitionModuleVersion", () => {
  it("is deterministic for the same source and files", () => {
    const source = "export const flow = {};";
    const files = { "ui/helper.ts": "export const x = 1;" };
    const first = definitionModuleVersion(source, files);
    const second = definitionModuleVersion(source, files);
    assert.equal(second, first);
  });

  it("changes when the entry source changes", () => {
    const files = { "ui/helper.ts": "export const x = 1;" };
    const before = definitionModuleVersion("export const flow = {};", files);
    const after = definitionModuleVersion(
      'export const flow = { label: "X" };',
      files
    );
    assert.notEqual(after, before);
  });

  it("changes when a referenced file changes", () => {
    const source = "export const flow = {};";
    const before = definitionModuleVersion(source, {
      "ui/helper.ts": "export const x = 1;",
    });
    const after = definitionModuleVersion(source, {
      "ui/helper.ts": "export const x = 2;",
    });
    assert.notEqual(after, before);
  });

  it("handles an absent file map", () => {
    const source = "export const flow = {};";
    assert.equal(
      definitionModuleVersion(source, undefined),
      definitionModuleVersion(source, undefined)
    );
    assert.notEqual(
      definitionModuleVersion(source, undefined),
      definitionModuleVersion(`${source}\n`, undefined)
    );
  });
});
