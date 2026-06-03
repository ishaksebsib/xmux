import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/node.ts"],
  format: ["esm", "cjs"],
  dts: {
    tsgo: true,
  },
  sourcemap: true,
  clean: true,
});
