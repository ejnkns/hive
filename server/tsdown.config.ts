import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  banner: "#!/usr/bin/env node",
});
