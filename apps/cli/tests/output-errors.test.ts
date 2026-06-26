import { describe, expect, it } from "vitest";
import { Cause } from "effect";
import { CliSpawnError } from "../src/domain/errors";
import { renderCliCause, shouldRenderDebugErrors } from "../src/output/errors";

describe("CLI error rendering", () => {
  it("renders concise messages by default", () => {
    const cause = Cause.fail(
      new CliSpawnError({
        message: "Failed to start xmux server process.",
        command: "xmux",
        cause: new Error("secret low-level detail"),
      }),
    );

    const rendered = renderCliCause(cause, false);

    expect(rendered).toBe("Failed to start xmux server process.");
    expect(rendered).not.toContain("secret low-level detail");
  });

  it("renders full causes in debug mode", () => {
    const cause = Cause.fail(
      new CliSpawnError({
        message: "Failed to start xmux server process.",
        command: "xmux",
        cause: new Error("debug detail"),
      }),
    );

    expect(renderCliCause(cause, true)).toContain("CliSpawnError");
  });

  it("detects debug flags", () => {
    expect(shouldRenderDebugErrors(["xmux", "--debug"])).toBe(true);
    expect(shouldRenderDebugErrors(["xmux", "--log-level", "debug"])).toBe(true);
    expect(shouldRenderDebugErrors(["xmux", "--log-level=trace"])).toBe(true);
    expect(shouldRenderDebugErrors(["xmux", "status"])).toBe(false);
  });
});
