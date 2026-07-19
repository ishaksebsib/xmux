import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/migrations.ts"],
  format: ["esm", "cjs"],
  dts: { tsgo: true },
  sourcemap: true,
  clean: true,
});
