import type { ChatTextStreamChunk } from "@xmux/chat-core";
import type { HarnessPromptEvent } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import type { NormalizedPromptResponseConfig } from "../src/config";
import { normalizeConfig } from "../src/config";
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

  test("uses configured prompt response limits for reasoning and tool previews", async () => {
    const config = promptResponseConfig({
      maxReasoningChars: 5,
      maxToolTextOutputChars: 4,
      maxToolJsonOutputChars: 8,
      maxToolInputStringChars: 3,
      maxToolInputObjectEntries: 1,
    });
    const text = await collectRendered(
      [
        {
          type: "content",
          phase: "completed",
          kind: "reasoning",
          ref,
          partId: "r1",
          text: "reasoning text",
        },
        {
          type: "tool",
          phase: "called",
          ref,
          callId: "call-1",
          name: "unknown",
          input: { query: "abcdef", extra: "hidden" },
        },
        {
          type: "tool",
          phase: "completed",
          ref,
          callId: "call-1",
          output: [
            { type: "text", text: "tool output" },
            { type: "json", value: { result: "json output" } },
          ],
        },
      ],
      config,
    );

    expect(text).toContain("> reaso\n> … truncated 9 chars");
    expect(text).toContain('> ✓ `unknown` \\{ query: "abc\\\\n… truncated 3 chars", … \\}');
    expect(text).toContain("> ```text\n> tool\n> … truncated 7 chars\n> ```");
    expect(text).toContain('> ```json\n> {\n>   "res\n> … truncated 21 chars\n> ```');
  });

  test("can hide tool output while keeping the tool summary", async () => {
    const text = await collectRendered(
      [
        {
          type: "tool",
          phase: "called",
          ref,
          callId: "call-1",
          name: "shell",
          input: { command: "npm test" },
        },
        {
          type: "tool",
          phase: "completed",
          ref,
          callId: "call-1",
          output: [{ type: "text", text: "ok" }],
        },
      ],
      promptResponseConfig({ showToolOutput: false }),
    );

    expect(text).toContain("> ✓ $ npm test");
    expect(text).not.toContain("```text");
    expect(text).not.toContain("ok");
  });

  test("can split large stream deltas without truncating content", async () => {
    const chunks = await collectRenderedChunks(
      [{ type: "content", phase: "delta", kind: "text", ref, delta: "abcdefghi" }],
      promptResponseConfig({ maxStreamDeltaChars: 4 }),
    );

    expect(chunks).toEqual([
      { type: "delta", delta: "abcd" },
      { type: "delta", delta: "efgh" },
      { type: "delta", delta: "i" },
      { type: "completed" },
    ]);
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
        "",
        "`external_directory`",
        "",
        "**Scope**",
        "",
        "- `/home/pro/dev/forks/pi/*`",
        "",
        "**Respond**",
        "",
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
        "**Session Stats**",
        "",
        "- _Model: `openai/gpt-5`_",
        "- _Thinking Level: `high`_",
        "- _Harness: `pi`_",
        "- _Tokens: 1,250_",
        "- _Cost: $0.01_",
      ].join("\n"),
    );
  });

  test("prefers completed run session usage over turn usage", async () => {
    const text = await collectRendered([
      {
        type: "turn",
        phase: "completed",
        ref,
        usage: { input: 100, output: 25, total: 125 },
        cost: 0.01,
      },
      {
        type: "run",
        phase: "completed",
        ref,
        reason: "stop",
        session: {
          usage: { input: 1_000, output: 500, total: 1_500 },
          cost: 0.25,
          context: { state: "known", used: 12_174, limit: 200_000 },
        },
      },
    ]);

    expect(text).toContain("- _Tokens: 1,500_");
    expect(text).toContain("- _Context: 12,174 used (6%)_");
    expect(text).toContain("- _Cost: $0.25_");
    expect(text).not.toContain("Tokens: 125");
  });

  test("renders explicit unknown context snapshots", async () => {
    const text = await collectRendered([
      {
        type: "run",
        phase: "completed",
        ref,
        reason: "stop",
        session: { context: { state: "unknown", limit: 200_000 } },
      },
    ]);

    expect(text).toContain("- _Context: unknown / 200,000_");
  });
});

async function collectRendered(
  events: readonly HarnessPromptEvent[],
  config?: NormalizedPromptResponseConfig,
): Promise<string> {
  let text = "";

  for await (const chunk of renderPromptEvents(toAsync(events), { response: config })) {
    text = chunkText(chunk, text);
  }

  return text;
}

async function collectRenderedChunks(
  events: readonly HarnessPromptEvent[],
  config?: NormalizedPromptResponseConfig,
): Promise<ChatTextStreamChunk[]> {
  const chunks: ChatTextStreamChunk[] = [];

  for await (const chunk of renderPromptEvents(toAsync(events), { response: config })) {
    chunks.push(chunk);
  }

  return chunks;
}

function chunkText(chunk: ChatTextStreamChunk, previous: string): string {
  if (chunk.type === "delta") return previous + chunk.delta;
  return chunk.text ?? previous;
}

async function* toAsync<T>(values: readonly T[]): AsyncIterable<T> {
  yield* values;
}

function promptResponseConfig(
  config: Partial<NormalizedPromptResponseConfig>,
): NormalizedPromptResponseConfig {
  return {
    ...normalizeConfig({
      defaultWorkingDirectory: ".",
      deliveryMode: "requester_only",
    }).prompt.response,
    ...config,
  };
}
