import { describe, expect, test, vi } from "vitest";
import {
  applyDiscordStreamChunk,
  ensureDiscordStreamLength,
  streamDiscordTextByEditing,
} from "../../src/conversions/streaming";
import { DiscordStreamMessageError } from "../../src/errors";

const adapterOptions = {};

describe("Discord streaming conversion", () => {
  test("delta chunks collect append-only text", () => {
    expect(applyDiscordStreamChunk("hello", { type: "delta", delta: " world" })).toBe(
      "hello world",
    );
  });

  test("snapshot chunks replace text", () => {
    expect(applyDiscordStreamChunk("old", { type: "snapshot", text: "new" })).toBe("new");
  });

  test("completed chunk finalizes text", () => {
    expect(applyDiscordStreamChunk("draft", { type: "completed", text: "final" })).toBe("final");
    expect(applyDiscordStreamChunk("draft", { type: "completed" })).toBe("draft");
  });

  test("2000-char limit fails predictably", () => {
    expect(ensureDiscordStreamLength("x".repeat(2_000)).isOk()).toBe(true);
    expect(ensureDiscordStreamLength("x".repeat(2_001)).isErr()).toBe(true);
  });

  test("throttle helper flushes final update", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];

    try {
      const resultPromise = streamDiscordTextByEditing({
        chunks: delayedChunks(),
        adapterOptions,
        initialFlushedText: "…",
        editIntervalMs: 1_000,
        edit: async (content) => {
          edits.push(content);
        },
        createError: ({ reason, cause }) => new DiscordStreamMessageError({ reason, cause }),
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(edits).toEqual(["hello"]);

      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.text).toBe("hello world");
      expect(edits).toEqual(["hello", "hello world"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function* delayedChunks() {
  yield { type: "delta" as const, delta: "hello" };
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  yield { type: "delta" as const, delta: " world" };
}
