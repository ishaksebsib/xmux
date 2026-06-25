import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", { "bin/xmux": "./bin/xmux.ts" }],
  format: ["esm", "cjs"],
  dts: {
    tsgo: true,
  },
  sourcemap: true,
  clean: true,
});
