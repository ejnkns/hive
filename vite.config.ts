import { defineConfig } from "vite";

export default defineConfig({
  root: "src/",
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
  server: {
    hmr: {
      server: undefined,
      port: 5173,
      clientPort: 5173,
    },
    port: 5173,
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
