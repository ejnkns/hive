// The authoring guide is the manifest serialized for model prompts. It is
// derived from the manifest itself, so it can only drift if someone edits the
// guide's derivation — this guard asserts the guide covers the full surface:
// every engine operation, every engine state field, every infrastructure
// tool, every role, every completion contract.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authoringGuide, engineCapabilities } from "./capabilities-manifest.ts";

describe("authoring guide", () => {
  it("covers every engine operation name", () => {
    const guide = authoringGuide();
    for (const op of engineCapabilities.engineOperations) {
      assert.ok(
        guide.includes(op.name),
        `guide missing engine operation ${op.name}`
      );
      assert.ok(
        guide.includes(op.description),
        `guide missing description for engine operation ${op.name}`
      );
    }
  });

  it("covers every engine state field", () => {
    const guide = authoringGuide();
    for (const name of Object.keys(
      engineCapabilities.stateFields.engineProvided
    )) {
      assert.ok(
        guide.includes(name),
        `guide missing engine-provided field ${name}`
      );
    }
    for (const name of Object.keys(engineCapabilities.stateFields.engineRead)) {
      assert.ok(
        guide.includes(name),
        `guide missing engine-read field ${name}`
      );
    }
  });

  it("covers every infrastructure tool name", () => {
    const guide = authoringGuide();
    for (const tool of engineCapabilities.infrastructureTools) {
      assert.ok(guide.includes(tool.name), `guide missing tool ${tool.name}`);
    }
  });

  it("covers roles and completion contracts", () => {
    const guide = authoringGuide();
    for (const role of engineCapabilities.taskRoles) {
      assert.ok(guide.includes(role), `guide missing role ${role}`);
    }
    for (const contract of engineCapabilities.completionContracts) {
      assert.ok(
        guide.includes(contract.name),
        `guide missing completion contract ${contract.name}`
      );
    }
  });
});
