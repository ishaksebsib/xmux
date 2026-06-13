import { describe, expect, test } from "vitest";
import { ChatReplyError, createChat } from "@xmux/chat-core";
import { createDiscordAdapter } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import { DiscordReplyError } from "../../src/errors";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";

describe("Discord reply contract", () => {
  test("auto replies include Discord message references when a message id is available", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const replied = await chat.reply({
        chatId: "discord",
        conversationId: "channel-1",
        messageId: "message-1",
        text: "hello",
      });

      expect(replied.isOk()).toBe(true);
      expect(fake.sentMessages).toHaveLength(1);
      expect(fake.sentMessages[0]?.payload).toMatchObject({
        reply: { messageReference: "message-1", failIfNotExists: false },
      });
    } finally {
      await chat.close();
    }
  });

  test("conversation replies send normal messages without message references", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const replied = await chat.reply({
        chatId: "discord",
        conversationId: "channel-1",
        messageId: "message-1",
        mode: "conversation",
        text: "hello",
        adapterOptions: { replyMention: true },
      });

      expect(replied.isOk()).toBe(true);
      expect(fake.sentMessages[0]?.payload).toMatchObject({
        content: "hello",
        allowedMentions: { parse: [], repliedUser: true },
      });
      expect(fake.sentMessages[0]?.payload).not.toMatchObject({ reply: expect.anything() });
    } finally {
      await chat.close();
    }
  });

  test("strict quote replies require a message id", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const replied = await chat.reply({
        chatId: "discord",
        conversationId: "channel-1",
        mode: "quote",
        text: "hello",
      });

      expect(replied.isErr()).toBe(true);
      if (replied.isErr()) {
        expect(replied.error).toBeInstanceOf(ChatReplyError);
        expect(replied.error.cause).toBeInstanceOf(DiscordReplyError);
      }
      expect(fake.sentMessages).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("thread replies create a thread from the referenced message and send there", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const replied = await chat.reply({
        chatId: "discord",
        conversationId: "channel-1",
        messageId: "message-1",
        mode: "thread",
        text: "hello thread",
        adapterOptions: { threadName: "Support" },
      });

      expect(replied.isOk()).toBe(true);
      expect(fake.threadRequests).toEqual([
        expect.objectContaining({
          channelId: "channel-1",
          messageId: "message-1",
          name: "Support",
        }),
      ]);
      expect(fake.sentMessages[0]).toMatchObject({
        channelId: "thread-message-1",
        payload: { content: "hello thread" },
      });
      if (replied.isOk()) {
        expect(replied.value.conversationId).toBe("thread-message-1");
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
