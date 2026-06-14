import { describe, expect, test, vi } from "vitest";
import {
  applyDiscordStreamChunk,
  encodeDiscordStreamSegments,
  ensureDiscordStreamLength,
  splitDiscordStreamText,
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

  test("2000-char limit remains available for direct edit streams", () => {
    expect(ensureDiscordStreamLength("x".repeat(2_000)).isOk()).toBe(true);
    expect(ensureDiscordStreamLength("x".repeat(2_001)).isErr()).toBe(true);
  });

  test("long stream text is split into Discord-sized segments", () => {
    const text = `${"a".repeat(1_500)}\n\n${"b".repeat(800)}`;
    const segments = splitDiscordStreamText(text);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.endsWith("\n\n")).toBe(true);
    expect(segments.every((segment) => segment.length <= 2_000)).toBe(true);
    expect(segments.join("")).toBe(text);
  });

  test("plain stream splitting keeps markdown escape pairs together", () => {
    const segments = encodeDiscordStreamSegments({
      text: `${"a".repeat(1_999)}*tail`,
      adapterOptions,
    });

    expect(segments.isOk()).toBe(true);
    if (segments.isOk()) {
      expect(segments.value.every((segment) => segment.length <= 2_000)).toBe(true);
      expect(segments.value.join("")).toBe(`${"a".repeat(1_999)}\\*tail`);
      expect(segments.value[0]?.endsWith("\\")).toBe(false);
    }
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
