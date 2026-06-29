import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    { "platform/node": "./src/platform/node/index.ts", status: "./src/status.ts" },
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
});
