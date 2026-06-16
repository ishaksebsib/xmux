import { createChat } from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createSlackAdapter } from "../../src";
import type { CreateSlackBotClient } from "../../src/client";
import type { CreateSlackAdapterOptions } from "../../src/types";
import { createFakeSlackClient } from "../fixtures/fake-slack-client";

describe("Slack outbound contract", () => {
  test("sendMessage posts to Slack and returns normalized sent message data", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const sent = await chat.sendMessage({
        chatId: "slack",
        conversationId: "C123",
        text: "hello **slack**",
        format: "markdown",
        adapterOptions: { unfurl_links: false },
      });

      expect(sent.isOk()).toBe(true);
      expect(fake.postMessageCalls).toHaveLength(1);
      expect(fake.postMessageCalls[0]).toMatchObject({
        channel: "C123",
        markdown_text: "hello **slack**",
        unfurl_links: false,
      });
      expect(fake.postMessageCalls[0]?.text).toBeUndefined();
      if (sent.isOk()) {
        expect(sent.value).toMatchObject({
          chatId: "slack",
          conversationId: "C123",
          messageId: "1.000000",
          text: "hello **slack**",
          format: "markdown",
          adapterData: {
            slackTeamId: "T123",
            slackChannelId: "C123",
            slackMessageTs: "1.000000",
          },
        });
      }
    } finally {
      await chat.close();
    }
  });

  test("reply posts in a Slack thread when requested", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const sent = await chat.reply({
        chatId: "slack",
        conversationId: "C123",
        messageId: "171.000100",
        mode: "thread",
        text: "thread reply",
        adapterOptions: { replyBroadcast: true },
      });

      expect(sent.isOk()).toBe(true);
      expect(fake.postMessageCalls[0]).toMatchObject({
        channel: "C123",
        thread_ts: "171.000100",
        reply_broadcast: true,
      });
      if (sent.isOk()) {
        expect(sent.value.adapterData.slackThreadTs).toBe("171.000100");
      }
    } finally {
      await chat.close();
    }
  });

  test("reply errors when thread mode has no message id", async () => {
    const fake = createFakeSlackClient();
    const chat = createTestChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      const sent = await chat.reply({
        chatId: "slack",
        conversationId: "C123",
        mode: "thread",
        text: "thread reply",
      });

      expect(sent.isErr()).toBe(true);
      expect(fake.postMessageCalls).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });
});

function createTestChat(fake: ReturnType<typeof createFakeSlackClient>) {
  return createChat({
    adapters: { slack: createTestAdapter(fake) },
    commands: {},
  });
}

function createTestAdapter(fake: ReturnType<typeof createFakeSlackClient>) {
  return createSlackAdapter<"slack">({
    ...socketOptions(),
    createClient: (() => fake) satisfies CreateSlackBotClient,
  });
}

function socketOptions(): CreateSlackAdapterOptions<"slack"> {
  return {
    botToken: "xoxb-token",
    mode: { type: "socket", appToken: "xapp-token" },
  };
}
