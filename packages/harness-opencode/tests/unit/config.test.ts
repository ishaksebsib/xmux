import { describe, expect, test } from "vitest";
import { normalizeOpenCodeAdapterConfig } from "../../src/config";

describe("OpenCode adapter config", () => {
  test("defaults to embedded mode", () => {
    expect(normalizeOpenCodeAdapterConfig(undefined)).toEqual({ mode: "embedded" });
  });

  test("preserves explicit external config", () => {
    expect(normalizeOpenCodeAdapterConfig({ mode: "external", baseUrl: "http://127.0.0.1:4096" })).toEqual({
      mode: "external",
      baseUrl: "http://127.0.0.1:4096",
    });
  });
});
