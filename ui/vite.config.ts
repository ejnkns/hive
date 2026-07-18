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
