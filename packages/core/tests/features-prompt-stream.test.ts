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

  test("renders permission requests with commands and without request ids", async () => {
    const text = await collectRendered([
      {
        type: "interaction",
        kind: "permission",
        phase: "requested",
        ref,
        requestId: "per_e887ace980010IuUtH2q4T0iKJ",
        prompt: "external_directory: /home/pro/dev/forks/pi/*",
        permission: {
          name: "external_directory",
          patterns: ["/home/pro/dev/forks/pi/*"],
          allowAlways: true,
        },
      },
    ]);

    expect(text).toBe(
      [
        "⚠️ **Permission requested**",
        "",
        "**Request**",
        "`external_directory`",
        "",
        "**Scope**",
        "- `/home/pro/dev/forks/pi/*`",
        "",
        "**Respond**",
        "- `/allow` — allow this request once",
        "- `/allow always` — always allow matching future requests",
        "- `/reject` — reject this request",
      ].join("\n"),
    );
    expect(text).not.toContain("per_e887ace980010IuUtH2q4T0iKJ");
  });

  test("renders question requests with reject instructions and without request ids", async () => {
    const text = await collectRendered([
      {
        type: "interaction",
        kind: "question",
        phase: "requested",
        ref,
        requestId: "question-1",
        prompt: "Pick a mode",
        question: {
          questions: [
            {
              header: "Mode",
              question: "Pick a mode",
              options: [{ label: "Fast", description: "Skip extra checks" }],
            },
          ],
        },
      },
    ]);

    expect(text).toContain("⚠️ **Question requested**");
    expect(text).toContain("`/reject` — dismiss this question");
    expect(text).toContain("`Fast` — Skip extra checks");
    expect(text).not.toContain("question-1");
  });

  test("suppresses resolved interactions", async () => {
    const text = await collectRendered([
      {
        type: "interaction",
        kind: "permission",
        phase: "answered",
        ref,
        requestId: "permission-1",
      },
      {
        type: "interaction",
        kind: "question",
        phase: "rejected",
        ref,
        requestId: "question-1",
      },
    ]);

    expect(text).toBe("");
  });

  test("renders run failures and aborts before or after prior output", async () => {
    const failedWithoutOutput = await collectRendered([
      { type: "run", phase: "failed", ref, reason: "error", error: new Error("boom") },
    ]);
    const abortedAfterOutput = await collectRendered([
      { type: "content", phase: "delta", kind: "text", ref, delta: "hello" },
      { type: "run", phase: "aborted", ref, reason: "aborted" },
    ]);
    const locallyCancelled = await collectRendered([
      { type: "run", phase: "aborted", ref, reason: "aborted", error: "Generation cancelled" },
    ]);

    expect(failedWithoutOutput).toBe("**Prompt failed**\n\nboom");
    expect(abortedAfterOutput).toBe("hello\n\n**Prompt aborted**");
    expect(locallyCancelled).toBe("");
  });

  test("appends response details after a completed run with usage metadata", async () => {
    const text = await collectRendered([
      {
        type: "turn",
        phase: "started",
        ref,
        messageId: "message-1",
        agent: "coder",
        thinking: "high",
        model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      },
      { type: "content", phase: "delta", kind: "text", ref, delta: "done" },
      {
        type: "turn",
        phase: "completed",
        ref,
        messageId: "message-1",
        usage: { input: 1_000, output: 200, reasoning: 50, cacheRead: 25, total: 1_250 },
        cost: 0.0123,
      },
      { type: "run", phase: "completed", ref, reason: "stop" },
    ]);

    expect(text).toBe(
      [
        "done",
        "",
        "**Stats**",
        "_Model: `openai/gpt-5@high`_",
        "_Harness: `pi`_",
        "_Thinking: `high`_",
        "_Tokens: 1,250_",
        "_Context: 1,025 used_",
        "_Cost: $0.01_",
      ].join("\n"),
    );
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
