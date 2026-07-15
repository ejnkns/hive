import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/telemetry.ts"],
  format: "esm",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
});
