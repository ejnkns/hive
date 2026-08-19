import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  deps: {
    alwaysBundle: [/^(shared|telemetry|workflow-engine)(\/|$)/],
    // The schema-consistency check and per-definition typechecker import
    // typescript at runtime; it must stay a bare import (Node resolves it
    // from node_modules as CJS) — bundling it into the ESM output breaks its
    // `__filename`-using sys code.
    neverBundle: ["typescript"],
  },
  dts: true,
  sourcemap: true,
  clean: true,
  banner: "#!/usr/bin/env node",
  // Agent-written paths (workspaces base, worktrees, persisted outputs,
  // materialized module sets) must never restart the dev server mid-run. The
  // workspaces base defaults to ~/.hive/workspaces (outside the repo); the
  // regex also covers an in-repo .hive / .hive-workspaces layout and the
  // server's own materialized definition copies (server/.runtime). RegExp,
  // not glob: rolldown's watch exclude matches hidden segments only via regex.
  ignoreWatch: [
    /(^|[/\\])(\.hive|\.hive-workspaces|\.workspaces|\.runtime)([/\\]|$)/,
  ],
});
