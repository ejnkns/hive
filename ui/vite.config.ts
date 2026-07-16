import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
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
      "/api": "http://127.0.0.1:8153",
      "/v1": "http://127.0.0.1:8153",
      "/health": "http://127.0.0.1:8153",
    },
  },
});
