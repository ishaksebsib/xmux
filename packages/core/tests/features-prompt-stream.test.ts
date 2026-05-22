import type { ChatTextStreamChunk } from "@xmux/chat-core";
import type { HarnessPromptEvent } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { renderPromptEvents } from "../src/features/prompt";

const ref = { harnessId: "pi", sessionId: "session-1" } as const;

describe("prompt stream renderer", () => {
  test("preserves assistant text deltas", async () => {
    const text = await collectRendered([
      { type: "content", phase: "delta", kind: "text", ref, delta: "**Hi" },
      { type: "content", phase: "delta", kind: "text", ref, delta: " there**" },
    ]);

    expect(text).toBe("**Hi there**");
  });

  test("renders reasoning as quoted markdown", async () => {
    const text = await collectRendered([
      { type: "content", phase: "started", kind: "reasoning", ref, partId: "r1" },
      { type: "content", phase: "delta", kind: "reasoning", ref, partId: "r1", delta: "thinking" },
      {
        type: "content",
        phase: "completed",
        kind: "reasoning",
        ref,
        partId: "r1",
        text: "thinking",
      },
    ]);

    expect(text).toBe("> **Reasoning**\n>\n> thinking");
  });

  test("renders compact tool calls with useful output", async () => {
    const text = await collectRendered([
      { type: "tool", phase: "input_started", ref, callId: "call-1", name: "shell" },
      { type: "tool", phase: "input_delta", ref, callId: "call-1", delta: '{"command":"npm' },
      { type: "tool", phase: "input_delta", ref, callId: "call-1", delta: ' test"}' },
      {
        type: "tool",
        phase: "input_completed",
        ref,
        callId: "call-1",
        input: { command: "npm test" },
      },
      {
        type: "tool",
        phase: "completed",
        ref,
        callId: "call-1",
        output: [{ type: "text", text: "ok" }],
      },
    ]);

    expect(text).toContain("> **Tool calls**");
    expect(text).toContain("> ✓ $ npm test");
    expect(text).toContain("> ```text\n> ok\n> ```");
  });

  test("renders run failures and aborts before or after prior output", async () => {
    const failedWithoutOutput = await collectRendered([
      { type: "run", phase: "failed", ref, reason: "error", error: new Error("boom") },
    ]);
    const abortedAfterOutput = await collectRendered([
      { type: "content", phase: "delta", kind: "text", ref, delta: "hello" },
      { type: "run", phase: "aborted", ref, reason: "aborted" },
    ]);

    expect(failedWithoutOutput).toBe("**Prompt failed**\n\nboom");
    expect(abortedAfterOutput).toBe("hello\n\n**Prompt aborted**");
  });
});

async function collectRendered(events: readonly HarnessPromptEvent[]): Promise<string> {
  let text = "";

  for await (const chunk of renderPromptEvents(toAsync(events))) {
    text = chunkText(chunk, text);
  }

  return text;
}

function chunkText(chunk: ChatTextStreamChunk, previous: string): string {
  if (chunk.type === "delta") return previous + chunk.delta;
  return chunk.text ?? previous;
}

async function* toAsync<T>(values: readonly T[]): AsyncIterable<T> {
  yield* values;
}
