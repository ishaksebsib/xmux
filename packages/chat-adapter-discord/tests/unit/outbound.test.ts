import { AllowedMentionsTypes } from "discord-api-types/v10";
import { describe, expect, test } from "vitest";
import { createSafeDiscordAllowedMentions } from "../../src/config";
import { DiscordReplyError, DiscordSendMessageError } from "../../src/errors";
import {
  encodeDiscordReplyMessage,
  encodeDiscordSendMessage,
} from "../../src/conversions/outbound";

const defaults = { allowedMentions: createSafeDiscordAllowedMentions() };

describe("Discord outbound conversions", () => {
  test("safe allowed mentions are present by default", () => {
    const result = encodeDiscordSendMessage(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "hello @everyone",
        adapterOptions: {},
      },
      defaults,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk() && typeof result.value.payload !== "string") {
      expect(result.value.payload.allowedMentions).toEqual({ parse: [], repliedUser: false });
    }
  });

  test("adapter allowed mentions override defaults explicitly", () => {
    const result = encodeDiscordSendMessage(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "hello <@123>",
        adapterOptions: { allowedMentions: { parse: [AllowedMentionsTypes.User] } },
      },
      defaults,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk() && typeof result.value.payload !== "string") {
      expect(result.value.payload.allowedMentions).toEqual({
        parse: [AllowedMentionsTypes.User],
        repliedUser: false,
      });
    }
  });

  test("content over Discord limit returns a typed error", () => {
    const result = encodeDiscordSendMessage(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "a".repeat(2_001),
        adapterOptions: {},
      },
      defaults,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(DiscordSendMessageError);
    }
  });

  test("quote reply encodes message reference", () => {
    const result = encodeDiscordReplyMessage(
      {
        chatId: "discord",
        conversationId: "channel-1",
        message: { chatId: "discord", conversationId: "channel-1", messageId: "message-1" },
        mode: "quote",
        text: "hello",
        adapterOptions: {},
      },
      defaults,
    );

    expect(result.isOk()).toBe(true);
    if (
      result.isOk() &&
      result.value.kind === "message" &&
      typeof result.value.message.payload !== "string"
    ) {
      expect(result.value.message.payload.reply).toEqual({
        messageReference: "message-1",
        failIfNotExists: false,
      });
    }
  });

  test("conversation reply omits message reference", () => {
    const result = encodeDiscordReplyMessage(
      {
        chatId: "discord",
        conversationId: "channel-1",
        message: { chatId: "discord", conversationId: "channel-1", messageId: "message-1" },
        mode: "conversation",
        text: "hello",
        adapterOptions: {},
      },
      defaults,
    );

    expect(result.isOk()).toBe(true);
    if (
      result.isOk() &&
      result.value.kind === "message" &&
      typeof result.value.message.payload !== "string"
    ) {
      expect(result.value.message.payload.reply).toBeUndefined();
    }
  });

  test("strict quote reply requires a message id", () => {
    const result = encodeDiscordReplyMessage(
      {
        chatId: "discord",
        conversationId: "channel-1",
        mode: "quote",
        text: "hello",
        adapterOptions: {},
      },
      defaults,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(DiscordReplyError);
    }
  });
});
