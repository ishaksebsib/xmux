import { describe, expect, it } from "vitest";
import { formatJson } from "../src/output/format";

describe("CLI output formatting", () => {
  it("formats undefined as valid JSON null", () => {
    expect(formatJson(undefined)).toBe("null\n");
  });
});
