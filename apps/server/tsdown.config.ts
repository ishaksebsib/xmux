import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", { "platform/node": "./src/platform/node/index.ts" }],
  format: ["esm", "cjs"],
  dts: {
    tsgo: true,
  },
  sourcemap: true,
  clean: true,
});
