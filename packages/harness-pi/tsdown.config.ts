import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm"],
  dts: {
    tsgo: true,
  },
  sourcemap: true,
  clean: true,
});
