// Discovers the pure-function test files (src/**/*.test.ts, excluding the
// component-level *.component.test.ts files that run under vitest) and runs
// them with node --test — mirroring the previous glob behavior without the
// glob matching the DOM test suite.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full);
    } else if (
      entry.endsWith(".test.ts") &&
      !entry.endsWith(".component.test.ts")
    ) {
      files.push(relative(root, full));
    }
  }
}

walk(join(root, "src"));

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit", cwd: root }
);
process.exit(result.status ?? 1);
