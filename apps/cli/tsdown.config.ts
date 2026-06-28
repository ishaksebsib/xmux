import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", { "bin/xmux": "./bin/xmux.ts" }],
  format: ["esm"],
  dts: {
    tsgo: true,
  },
  sourcemap: true,
  clean: true,
});
