import { describe, expect, test } from "vitest";
import { ChatSendMessageError, ChatTypingIndicatorError, createChat } from "@xmux/chat-core";
import { createDiscordAdapter } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import { DiscordSendMessageError, DiscordSendTypingError } from "../../src/errors";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";

describe("Discord outbound contract", () => {
  test("sendMessage serializes through the Discord client", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const sent = await chat.sendMessage({
        chatId: "discord",
        conversationId: "channel-1",
        text: "**hello** from hello_world",
        format: "markdown",
        adapterOptions: { flags: 4 },
      });

      expect(sent.isOk()).toBe(true);
      expect(fake.sentMessages).toHaveLength(1);
      expect(fake.sentMessages[0]).toMatchObject({
        channelId: "channel-1",
        payload: {
          content: "**hello** from hello_world",
          flags: 4,
          allowedMentions: { parse: [], repliedUser: false },
        },
      });
      if (sent.isOk()) {
        expect(sent.value).toMatchObject({
          chatId: "discord",
          conversationId: "channel-1",
          messageId: "sent-1",
          text: "**hello** from hello_world",
          format: "markdown",
          adapterData: {
            discordChannelId: "channel-1",
            discordMessageId: "sent-1",
          },
        });
      }
    } finally {
      await chat.close();
    }
  });

  test("sendMessage maps Discord client failures to chat failures", async () => {
    const fake = createFakeDiscordClient({ sendMessageError: new Error("send failed") });
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const sent = await chat.sendMessage({
        chatId: "discord",
        conversationId: "channel-1",
        text: "hello",
        adapterOptions: {},
      });

      expect(sent.isErr()).toBe(true);
      if (sent.isErr()) {
        expect(sent.error).toBeInstanceOf(ChatSendMessageError);
        expect(sent.error.cause).toBeInstanceOf(DiscordSendMessageError);
      }
    } finally {
      await chat.close();
    }
  });

  test("typingIndicator calls the Discord typing endpoint", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const typed = await chat.typingIndicator({
        chatId: "discord",
        conversationId: "channel-1",
        action: "typing",
        adapterOptions: { flags: 4 },
      });

      expect(typed.isOk()).toBe(true);
      expect(fake.typingRequests).toHaveLength(1);
      expect(fake.typingRequests[0]).toMatchObject({ channelId: "channel-1" });
    } finally {
      await chat.close();
    }
  });

  test("typingIndicator maps Discord client failures to chat failures", async () => {
    const fake = createFakeDiscordClient({ sendTypingError: new Error("typing failed") });
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const typed = await chat.typingIndicator({
        chatId: "discord",
        conversationId: "channel-1",
        adapterOptions: {},
      });

      expect(typed.isErr()).toBe(true);
      if (typed.isErr()) {
        expect(typed.error).toBeInstanceOf(ChatTypingIndicatorError);
        expect(typed.error.cause).toBeInstanceOf(DiscordSendTypingError);
      }
    } finally {
      await chat.close();
    }
  });
});

function createDiscordChat(fake: FakeDiscordBotClient) {
  return createChat({
    adapters: {
      discord: createDiscordAdapter({
        token: "token",
        applicationId: "application",
        createClient: (() => fake) satisfies CreateDiscordBotClient,
      }),
    },
    commands: {},
  });
}
