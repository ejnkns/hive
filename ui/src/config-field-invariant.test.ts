// The ConfigField boundary invariant: every remaining form surface renders
// through the Lit <config-field-control> (the one field renderer) — no
// .svelte file may render a ConfigField again. The rendering surface is
// Lit + Web Components; the app shell is Svelte, and the two meet at
// LitFlowHost. A Svelte file that references ConfigField means a form
// surface escaped back into the shell (the ConfigFieldInput duplication the
// consolidation removed). This node test scans every .svelte file in the ui
// package and fails on any reference.
//
// The match is ConfigField not followed by Form: ConfigFieldForm is the
// sanctioned Lit form-component type (the shell binds the dialog body's
// element), while the standalone type, ConfigFieldValue, and the deleted
// ConfigFieldInput renderer all mean a field surface lives in Svelte.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const uiSrc = dirname(fileURLToPath(import.meta.url));

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      files.push(...walk(full));
    } else if (entry.endsWith(".svelte")) {
      files.push(full);
    }
  }
  return files;
}

describe("ConfigField boundary invariant", () => {
  it("no .svelte file references ConfigField", () => {
    const offenders = walk(uiSrc).filter((file) =>
      /ConfigField(?!Form)/.test(readFileSync(file, "utf8"))
    );
    assert.deepEqual(
      offenders.map((file) => relative(uiSrc, file)),
      [],
      "every form surface must render through <config-field-control> (Lit), never ConfigField in Svelte"
    );
  });
});
