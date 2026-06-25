import { defineConfig } from "vite";

export default defineConfig({
  root: "src/hive",
  build: {
    outDir: "../../dist/hive",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:19280",
      "/v1": "http://localhost:19280",
      "/health": "http://localhost:19280",
    },
  },
});
