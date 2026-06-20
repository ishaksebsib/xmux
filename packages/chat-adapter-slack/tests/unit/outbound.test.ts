import { describe, expect, test } from "vitest";
import { encodeSlackReplyMessage, encodeSlackSendMessage } from "../../src/conversions/outbound";

describe("Slack outbound conversion", () => {
  test("sendMessage maps conversation and native options", () => {
    const result = encodeSlackSendMessage({
      chatId: "slack",
      conversationId: "C123",
      text: "hello <@U123>",
      format: "plain",
      adapterOptions: {
        unfurl_links: false,
        unfurl_media: false,
        metadata: { event_type: "xmux", event_payload: { id: "1" } },
      },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        channel: "C123",
        text: "hello &lt;@U123&gt;",
        mrkdwn: false,
        unfurl_links: false,
        unfurl_media: false,
        metadata: { event_type: "xmux", event_payload: { id: "1" } },
      });
    }
  });

  test("markdown sendMessage uses Slack markdown_text without blocks", () => {
    const result = encodeSlackSendMessage({
      chatId: "slack",
      conversationId: "C123",
      text: "hello **slack**",
      format: "markdown",
      adapterOptions: {},
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        channel: "C123",
        markdown_text: "hello **slack**",
      });
    }
  });

  test("thread-scoped sendMessage targets the underlying Slack thread", () => {
    const result = encodeSlackSendMessage({
      chatId: "slack",
      conversationId: "C123:171.000100",
      text: "thread message",
      adapterOptions: { replyBroadcast: true },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        channel: "C123",
        thread_ts: "171.000100",
        reply_broadcast: true,
        text: "thread message",
      });
    }
  });

  test("markdown sendMessage falls back to mrkdwn when blocks are present", () => {
    const result = encodeSlackSendMessage({
      chatId: "slack",
      conversationId: "C123",
      text: "hello **slack**",
      format: "markdown",
      adapterOptions: { blocks: [{ type: "section", text: { type: "mrkdwn", text: "block" } }] },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        channel: "C123",
        text: "hello *slack*",
        mrkdwn: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "block" } }],
      });
    }
  });

  test("auto replies use a Slack thread when a message id exists", () => {
    const result = encodeSlackReplyMessage({
      chatId: "slack",
      conversationId: "C123",
      message: { chatId: "slack", conversationId: "C123", messageId: "171.000100" },
      text: "thread reply",
      adapterOptions: { replyBroadcast: true },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.thread_ts).toBe("171.000100");
      expect(result.value.reply_broadcast).toBe(true);
    }
  });

  test("thread-scoped conversation replies stay in the Slack thread", () => {
    const result = encodeSlackReplyMessage({
      chatId: "slack",
      conversationId: "C123:171.000100",
      message: { chatId: "slack", conversationId: "C123:171.000100", messageId: "171.000200" },
      mode: "conversation",
      text: "conversation reply",
      adapterOptions: {},
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        channel: "C123",
        thread_ts: "171.000100",
      });
    }
  });

  test("conversation replies stay in the channel", () => {
    const result = encodeSlackReplyMessage({
      chatId: "slack",
      conversationId: "C123",
      message: { chatId: "slack", conversationId: "C123", messageId: "171.000100" },
      mode: "conversation",
      text: "channel reply",
      adapterOptions: { replyBroadcast: true },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.thread_ts).toBeUndefined();
      expect(result.value.reply_broadcast).toBeUndefined();
    }
  });

  test("thread mode requires a message id", () => {
    const result = encodeSlackReplyMessage({
      chatId: "slack",
      conversationId: "C123",
      mode: "thread",
      text: "missing thread",
      adapterOptions: {},
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("message id");
    }
  });

  test("auto replies without a message id fall back to channel", () => {
    const result = encodeSlackReplyMessage({
      chatId: "slack",
      conversationId: "C123",
      text: "channel",
      adapterOptions: {},
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.thread_ts).toBeUndefined();
    }
  });
});
