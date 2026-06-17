import { ChatStreamMessageError, ChatStreamReplyError, createChat } from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createSlackAdapter } from "../../src";
import type { CreateSlackBotClient, SlackNativeStreamChunk } from "../../src/client";
import { SlackStreamMessageError, SlackStreamReplyError } from "../../src/errors";
import type { CreateSlackAdapterOptions } from "../../src/types";
import { createFakeSlackClient } from "../fixtures/fake-slack-client";

describe("Slack native streams contract", () => {
  test("streamReply uses chat.startStream, chat.appendStream, and chat.stopStream", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake, { stream: { bufferSize: 5 } });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamReply({
        chatId: "slack",
        conversationId: "C123",
        messageId: "171.000100",
        content: { chunks: twoDeltas("hello", " world"), format: "markdown" },
        fallback: "error",
        adapterOptions: {
          metadata: { event_type: "xmux_stream", event_payload: { ok: true } },
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "done" } }],
          stream: { recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });

      expect(result.isOk()).toBe(true);
      expect(fake.startStreamCalls).toHaveLength(1);
      expect(fake.appendStreamCalls).toHaveLength(1);
      expect(fake.stopStreamCalls).toHaveLength(1);
      expect(fake.startStreamCalls[0]).toMatchObject({
        channel: "C123",
        thread_ts: "171.000100",
        recipient_team_id: "T123",
        recipient_user_id: "U123",
        chunks: [{ type: "markdown_text", text: "hello" }],
      });
      expect(fake.appendStreamCalls[0]).toMatchObject({
        channel: "C123",
        ts: "1.000000",
        chunks: [{ type: "markdown_text", text: " world" }],
      });
      expect(fake.stopStreamCalls[0]).toMatchObject({
        channel: "C123",
        ts: "1.000000",
        thread_ts: "171.000100",
        metadata: { event_type: "xmux_stream", event_payload: { ok: true } },
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "done" } }],
      });
      if (result.isOk()) {
        expect(result.value).toMatchObject({
          messageId: "1.000000",
          text: "hello world",
          format: "markdown",
          adapterData: { slackThreadTs: "171.000100" },
        });
      }
    } finally {
      await chat.close();
    }
  });

  test("streamMessage requires an explicit native stream thread target", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: oneDelta("hello") },
        fallback: "error",
        adapterOptions: { stream: { recipientTeamId: "T123", recipientUserId: "U123" } },
      });

      expect(result.isErr()).toBe(true);
      expect(fake.startStreamCalls).toHaveLength(0);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ChatStreamMessageError);
        expect(result.error.cause).toBeInstanceOf(SlackStreamMessageError);
      }
    } finally {
      await chat.close();
    }
  });

  test("streamMessage uses multiple native stream messages when segment limit is reached", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake, { stream: { bufferSize: 5, maxSegmentChars: 5 } });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: twoDeltas("abcde", "fghij") },
        fallback: "error",
        adapterOptions: {
          stream: { threadTs: "171.000100", recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });

      expect(result.isOk()).toBe(true);
      expect(fake.startStreamCalls.map((call) => markdownChunkText(call.chunks?.[0]))).toEqual([
        "abcde",
        "fghij",
      ]);
      expect(fake.stopStreamCalls.map((call) => call.ts)).toEqual(["1.000000", "2.000000"]);
      if (result.isOk()) {
        expect(result.value.messageId).toBe("2.000000");
        expect(result.value.text).toBe("abcdefghij");
        expect(result.value.adapterData.raw).toHaveLength(2);
      }
    } finally {
      await chat.close();
    }
  });

  test("Slack stream API failures map to typed core errors", async () => {
    const fake = createFakeSlackClient({ appendStreamError: new Error("append failed") });
    const chat = createTestChat(fake, { stream: { bufferSize: 5 } });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamReply({
        chatId: "slack",
        conversationId: "C123",
        messageId: "171.000100",
        content: { chunks: twoDeltas("hello", " world") },
        fallback: "error",
        adapterOptions: { stream: { recipientTeamId: "T123", recipientUserId: "U123" } },
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ChatStreamReplyError);
        expect(result.error.cause).toBeInstanceOf(SlackStreamReplyError);
      }
      expect(fake.stopStreamCalls).toHaveLength(1);
    } finally {
      await chat.close();
    }
  });

  test("abort after start best-effort stops the open Slack stream", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake, { stream: { bufferSize: 5 } });
    const abort = new AbortController();

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: abortAfterFirstDelta(abort) },
        fallback: "error",
        signal: abort.signal,
        adapterOptions: {
          stream: { threadTs: "171.000100", recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });

      expect(result.isErr()).toBe(true);
      expect(fake.startStreamCalls).toHaveLength(1);
      expect(fake.stopStreamCalls).toHaveLength(1);
      expect(fake.stopStreamCalls[0]).toMatchObject({ channel: "C123", ts: "1.000000" });
    } finally {
      await chat.close();
    }
  });

  test("abort before start prevents Slack stream calls", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);
    const abort = new AbortController();
    abort.abort(new Error("cancelled"));

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: oneDelta("hello") },
        fallback: "error",
        signal: abort.signal,
        adapterOptions: {
          stream: { threadTs: "171.000100", recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });

      expect(result.isErr()).toBe(true);
      expect(fake.startStreamCalls).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });
});

function createTestChat(
  fake: ReturnType<typeof createFakeSlackClient>,
  options: Partial<CreateSlackAdapterOptions<"slack">> = {},
) {
  return createChat({
    adapters: { slack: createTestAdapter(fake, options) },
    commands: {},
  });
}

function createTestAdapter(
  fake: ReturnType<typeof createFakeSlackClient>,
  options: Partial<CreateSlackAdapterOptions<"slack">>,
) {
  return createSlackAdapter<"slack">({
    ...socketOptions(),
    ...options,
    createClient: (() => fake) satisfies CreateSlackBotClient,
  });
}

function socketOptions(): CreateSlackAdapterOptions<"slack"> {
  return {
    botToken: "xoxb-token",
    mode: { type: "socket", appToken: "xapp-token" },
  };
}

function markdownChunkText(chunk: SlackNativeStreamChunk | undefined) {
  return chunk?.type === "markdown_text" ? chunk.text : undefined;
}

async function* abortAfterFirstDelta(abort: AbortController) {
  yield { type: "delta" as const, delta: "hello" };
  abort.abort(new Error("cancelled"));
  yield { type: "delta" as const, delta: " world" };
}

async function* oneDelta(delta: string) {
  yield { type: "delta" as const, delta };
}

async function* twoDeltas(first: string, second: string) {
  yield { type: "delta" as const, delta: first };
  yield { type: "delta" as const, delta: second };
}
