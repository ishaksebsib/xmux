import { describe, expect, test } from "vitest";
import { ChatAdapterOpenError, ChatLifecycleError } from "../src";
import { ensureCanStart } from "../src/lifecycle";

describe("chat-core errors", () => {
  test("wrapped adapter errors preserve the original cause", () => {
    const cause = new Error("sdk failed");
    const error = new ChatAdapterOpenError({ chatId: "discord", cause });

    expect(error.cause).toBe(cause);
    expect(error.message).toContain("sdk failed");
  });

  test("starting twice returns a deterministic lifecycle error", () => {
    const result = ensureCanStart({ status: "started" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ChatLifecycleError);
      expect(result.error.operation).toBe("start");
      expect(result.error.currentState).toBe("started");
    }
  });
});
