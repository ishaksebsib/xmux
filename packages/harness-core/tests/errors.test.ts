import { describe, expect, test } from "vitest";
import {
  HarnessAdapterModelUnsupportedError,
  HarnessAdapterOpenError,
  HarnessAdapterPromptError,
  HarnessCloseError,
  UnknownHarnessError,
} from "../src";

describe("harness-core errors", () => {
  test("unknown harness errors include requested and available harness ids", () => {
    const error = new UnknownHarnessError({ harnessId: "missing", availableHarnessIds: ["pi"] });

    expect(error.harnessId).toBe("missing");
    expect(error.availableHarnessIds).toEqual(["pi"]);
    expect(error.message).toContain('Unknown harness "missing"');
    expect(error.message).toContain("pi");
  });

  test("unsupported method errors include harness id and method name", () => {
    const error = new HarnessAdapterModelUnsupportedError({
      harnessId: "pi",
      operation: "setModel",
    });

    expect(error.harnessId).toBe("pi");
    expect(error.operation).toBe("setModel");
    expect(error.message).toContain("setModel");
  });

  test("operation-specific wrapper errors preserve causes", () => {
    const cause = new Error("adapter failed");
    const open = new HarnessAdapterOpenError({ harnessId: "pi", cause });
    const prompt = new HarnessAdapterPromptError({ harnessId: "pi", cause });

    expect(open.cause).toBe(cause);
    expect(prompt.cause).toBe(cause);
    expect(open.message).toContain("adapter failed");
    expect(prompt.message).toContain("adapter failed");
  });

  test("non-Error thrown values are described safely", () => {
    const open = new HarnessAdapterOpenError({ harnessId: "pi", cause: "boom" });

    expect(open.cause).toBe("boom");
    expect(open.message).toContain("boom");
  });

  test("close errors preserve all failed adapters", () => {
    const first = new Error("first");
    const second = new Error("second");
    const error = new HarnessCloseError({
      failures: [
        { harnessId: "pi", cause: first },
        { harnessId: "opencode", cause: second },
      ],
    });

    expect(error.failures).toEqual([
      { harnessId: "pi", cause: first },
      { harnessId: "opencode", cause: second },
    ]);
    expect(error.message).toContain("pi, opencode");
  });
});
