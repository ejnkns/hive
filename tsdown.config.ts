import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  sourcemap: true,
});
