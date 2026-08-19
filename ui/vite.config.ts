import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const uiPort = readPort("HIVE_UI_PORT", 8153);
  const backendPort = readPort("HIVE_DEV_SERVER_PORT", 8154);
  const backendHttpUrl = `http://127.0.0.1:${String(backendPort)}`;
  const backendWebSocketUrl = `ws://127.0.0.1:${String(backendPort)}`;

  return {
    root: "src/",
    plugins: [
      svelte({
        configFile: "../svelte.config.ts",
      }),
    ],
    build: {
      outDir: "../dist/ui",
      emptyOutDir: true,
    },
    server: {
      // Agent-written paths (workspaces base, worktrees, persisted outputs,
      // materialized module sets) must never trigger HMR or a full reload: an
      // agent writing while a long task runs must not churn the dev server
      // mid-run. The workspaces base defaults to ~/.hive/workspaces (outside
      // the repo); these exclusions keep an in-repo .hive / .hive-workspaces
      // layout safe too. RegExp, not globs: chokidar 4 does not match hidden
      // segments via glob.
      watch: {
        ignored: [
          /(^|[/\\])(\.hive|\.hive-workspaces|\.workspaces|\.runtime)([/\\]|$)/,
        ],
      },
      hmr: {
        server: undefined,
        port: uiPort,
        clientPort: uiPort,
      },
      port: uiPort,
      proxy: {
        "/ws": {
          target: backendWebSocketUrl,
          changeOrigin: true,
          ws: true,
        },
        "/api": {
          target: backendHttpUrl,
          changeOrigin: true,
          ws: true,
        },
        "/v1": {
          target: backendHttpUrl,
          changeOrigin: true,
        },
        "/health": {
          target: backendHttpUrl,
          changeOrigin: true,
        },
      },
    },
  };
});

function readPort(
  name: "HIVE_UI_PORT" | "HIVE_DEV_SERVER_PORT",
  fallback: number
) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
