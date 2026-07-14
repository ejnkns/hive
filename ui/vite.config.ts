import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "src/",
  resolve: {
    alias: [
      {
        find: /^hive-shared\/(.+)$/,
        replacement: path.resolve(__dirname, "../src/shared/$1"),
      },
      {
        find: /^hive-telemetry$/,
        replacement: path.resolve(__dirname, "../src/telemetry.ts"),
      },
      {
        find: /^hive-telemetry\/(.+)$/,
        replacement: path.resolve(__dirname, "../src/telemetry/$1"),
      },
      {
        find: /^hive-orchestrator$/,
        replacement: path.resolve(__dirname, "../src/orchestrator.ts"),
      },
      {
        find: /^hive-orchestrator\/(.+)$/,
        replacement: path.resolve(__dirname, "../src/orchestrator/$1"),
      },
    ],
  },
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
    hmr: {
      server: undefined,
      port: 8153,
      clientPort: 8153,
    },
    port: 8153,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:8153",
        changeOrigin: true,
        ws: true,
      },
      "/api": "http://localhost:8153",
      "/v1": "http://localhost:8153",
      "/health": "http://localhost:8153",
    },
  },
});
