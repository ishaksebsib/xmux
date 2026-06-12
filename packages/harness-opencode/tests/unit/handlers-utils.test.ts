import { describe, expect, test } from "vitest";
import { OpenCodeSessionResponseError } from "../../src/errors";
import { expectTrueResponse, toResponseResult } from "../../src/handlers/utils";

function toError(args: {
  readonly status: number;
  readonly detail?: unknown;
  readonly reason: string;
}) {
  return new OpenCodeSessionResponseError({
    status: args.status,
    detail: args.detail === undefined ? undefined : JSON.stringify(args.detail),
    reason: args.reason,
  });
}

describe("OpenCode handler response utilities", () => {
  test("turns SDK { error } responses into response errors", () => {
    const result = toResponseResult({
      response: { error: { message: "boom" }, response: { status: 500 } },
      toError,
      failureReason: "failed",
      missingReason: "missing",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBeInstanceOf(OpenCodeSessionResponseError);
  });

  test("turns missing data into response errors", () => {
    const result = toResponseResult({
      response: { response: { status: 200 } },
      toError,
      failureReason: "failed",
      missingReason: "missing",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain("missing");
  });

  test("turns false boolean endpoint confirmations into response errors", () => {
    const result = expectTrueResponse({
      value: false,
      status: 200,
      reason: "expected true",
      toError: ({ status, reason }) => toError({ status, reason }),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain("expected true");
  });
});
