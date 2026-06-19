import { ChatStreamReplyError, createChat } from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createSlackAdapter } from "../../src";
import type {
  CreateSlackBotClient,
  SlackMessageEvent,
  SlackNativeStreamChunk,
} from "../../src/client";
import { SlackStreamReplyError } from "../../src/errors";
import type { CreateSlackAdapterOptions } from "../../src/types";
import { waitForCondition } from "../fixtures/collect";
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

  test("message reply streams infer channel recipients from the inbound Slack message", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake, { stream: { bufferSize: 5 } });
    const results: boolean[] = [];
    const errors: unknown[] = [];

    chat.on("message", async (event) => {
      const result = await event.replyStream({
        chunks: oneDelta("hello"),
        format: "markdown",
      });
      results.push(result.isOk());
      if (result.isErr()) errors.push(result.error);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await fake.emitMessage(slackMessage({ text: "question", team_id: "T999", user: "U999" }));
      await waitForCondition(() => results.length === 1);

      expect(results).toEqual([true]);
      expect(errors).toEqual([]);
      expect(fake.startStreamCalls[0]).toMatchObject({
        channel: "C123",
        thread_ts: "171.000100",
        recipient_team_id: "T999",
        recipient_user_id: "U999",
        chunks: [{ type: "markdown_text", text: "hello" }],
      });
    } finally {
      await chat.close();
    }
  });

  test("streamMessage without a native target streams in conversation using message updates", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: oneDelta("hello") },
        fallback: "error",
      });

      expect(result.isOk()).toBe(true);
      expect(fake.startStreamCalls).toHaveLength(0);
      expect(fake.postMessageCalls).toHaveLength(1);
      expect(fake.updateMessageCalls).toHaveLength(1);
      expect(fake.postMessageCalls[0]).toMatchObject({
        channel: "C123",
        text: "hello",
        mrkdwn: false,
      });
    } finally {
      await chat.close();
    }
  });

  test("streamReply without native recipients falls back to threaded message updates", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamReply({
        chatId: "slack",
        conversationId: "C123",
        messageId: "171.000100",
        content: { chunks: oneDelta("hello") },
        fallback: "error",
      });

      expect(result.isOk()).toBe(true);
      expect(fake.startStreamCalls).toHaveLength(0);
      expect(fake.postMessageCalls[0]).toMatchObject({
        channel: "C123",
        thread_ts: "171.000100",
        text: "hello",
        mrkdwn: false,
      });
    } finally {
      await chat.close();
    }
  });

  test("streamReply auto falls back to adapter thread when message id is blank", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamReply({
        chatId: "slack",
        conversationId: "C123",
        messageId: "   ",
        content: { chunks: oneDelta("hello") },
        fallback: "error",
        adapterOptions: {
          stream: { threadTs: "171.000200", recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });

      expect(result.isOk()).toBe(true);
      expect(fake.startStreamCalls[0]).toMatchObject({ thread_ts: "171.000200" });
    } finally {
      await chat.close();
    }
  });

  test("streamMessage with incomplete native recipients falls back to threaded message updates", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: oneDelta("hello") },
        fallback: "error",
        adapterOptions: {
          stream: { threadTs: "171.000100", recipientTeamId: "   ", recipientUserId: "U123" },
        },
      });

      expect(result.isOk()).toBe(true);
      expect(fake.startStreamCalls).toHaveLength(0);
      expect(fake.postMessageCalls[0]).toMatchObject({
        channel: "C123",
        thread_ts: "171.000100",
        text: "hello",
        mrkdwn: false,
      });
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
      const streamTexts = allStreamChunkTexts(fake);
      expect(streamTexts.every((text) => text.length <= 5)).toBe(true);
      expect(streamTexts.every((text) => text.length <= 12_000)).toBe(true);
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

  test("plain text expansion is split after escaping so Slack chunks respect limits", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake, { stream: { bufferSize: 5, maxSegmentChars: 5 } });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: oneDelta("***** <&>"), format: "plain" },
        fallback: "error",
        adapterOptions: {
          stream: { threadTs: "171.000100", recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });

      expect(result.isOk()).toBe(true);
      const streamTexts = allStreamChunkTexts(fake);
      expect(streamTexts.every((text) => text.length <= 5)).toBe(true);
      expect(streamTexts.every((text) => text.length <= 12_000)).toBe(true);
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

  test("abort while upstream iterator is pending best-effort stops the open Slack stream", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake, { stream: { bufferSize: 5 } });
    const abort = new AbortController();

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const pending = chat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: pendingAfterFirstDelta() },
        fallback: "error",
        signal: abort.signal,
        adapterOptions: {
          stream: { threadTs: "171.000100", recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });

      await waitForMicrotasks();
      expect(fake.startStreamCalls).toHaveLength(1);
      abort.abort(new Error("cancelled"));
      const result = await pending;

      expect(result.isErr()).toBe(true);
      expect(fake.stopStreamCalls).toHaveLength(1);
      expect(fake.stopStreamCalls[0]).toMatchObject({ channel: "C123", ts: "1.000000" });
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

  test("empty streams error by default and can use configured emptyText", async () => {
    const emptyErrorFake = createFakeSlackClient();
    const emptyErrorChat = createTestChat(emptyErrorFake);
    const emptyTextFake = createFakeSlackClient();
    const emptyTextChat = createTestChat(emptyTextFake, { stream: { emptyText: "No content" } });

    try {
      expect((await emptyErrorChat.start()).isOk()).toBe(true);
      const emptyError = await emptyErrorChat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: emptyChunks() },
        fallback: "error",
        adapterOptions: {
          stream: { threadTs: "171.000100", recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });
      expect(emptyError.isErr()).toBe(true);
      expect(emptyErrorFake.startStreamCalls).toHaveLength(0);
    } finally {
      await emptyErrorChat.close();
    }

    try {
      expect((await emptyTextChat.start()).isOk()).toBe(true);
      const emptyText = await emptyTextChat.streamMessage({
        chatId: "slack",
        conversationId: "C123",
        content: { chunks: emptyChunks() },
        fallback: "error",
        adapterOptions: {
          stream: { threadTs: "171.000100", recipientTeamId: "T123", recipientUserId: "U123" },
        },
      });
      expect(emptyText.isOk()).toBe(true);
      expect(markdownChunkText(emptyTextFake.startStreamCalls[0]?.chunks?.[0])).toBe("No content");
      if (emptyText.isOk()) expect(emptyText.value.text).toBe("No content");
    } finally {
      await emptyTextChat.close();
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

function allStreamChunkTexts(fake: ReturnType<typeof createFakeSlackClient>) {
  return [...fake.startStreamCalls, ...fake.appendStreamCalls, ...fake.stopStreamCalls]
    .flatMap((call) => call.chunks ?? [])
    .flatMap((chunk) => (chunk.type === "markdown_text" ? [chunk.text] : []));
}

function waitForMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function slackMessage(
  overrides: Partial<{
    readonly text: string;
    readonly team_id: string;
    readonly user: string;
  }> = {},
): SlackMessageEvent["event"] {
  return {
    type: "message",
    channel: "C123",
    ts: "171.000100",
    text: "hello",
    user: "U123",
    username: "riley",
    team_id: "T123",
    ...overrides,
  } as never;
}

async function* pendingAfterFirstDelta() {
  yield { type: "delta" as const, delta: "hello" };
  await new Promise<never>(() => undefined);
}

async function* abortAfterFirstDelta(abort: AbortController) {
  yield { type: "delta" as const, delta: "hello" };
  abort.abort(new Error("cancelled"));
  yield { type: "delta" as const, delta: " world" };
}

function emptyChunks() {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true as const, value: undefined as never }),
      };
    },
  };
}

async function* oneDelta(delta: string) {
  yield { type: "delta" as const, delta };
}

async function* twoDeltas(first: string, second: string) {
  yield { type: "delta" as const, delta: first };
  yield { type: "delta" as const, delta: second };
}
