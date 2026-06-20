import { createChat, type ChatEventByType } from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createSlackAdapter } from "../../src";
import type { CreateSlackBotClient, SlackMessageEvent, SlackReactionEvent } from "../../src/client";
import type { CreateSlackAdapterOptions } from "../../src/types";
import { waitForCondition } from "../fixtures/collect";
import { createFakeSlackClient } from "../fixtures/fake-slack-client";

type SlackMessageEventForTest = ChatEventByType<
  "message",
  Record<never, never>,
  Record<never, never>,
  "slack"
>;
type SlackReactionAddedEventForTest = ChatEventByType<
  "reaction.added",
  Record<never, never>,
  Record<never, never>,
  "slack"
>;

describe("Slack inbound contract", () => {
  test("emits normalized message events and ignores Slack retries", async () => {
    const fake = createFakeSlackClient({
      botIdentity: { botUserId: "U_BOT", botId: "B_BOT", raw: {} },
    });
    const messages: SlackMessageEventForTest[] = [];
    const chat = createTestChat(fake);

    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitMessage(slackMessage({ text: "retry" }), {
        retryNum: 1,
        retryReason: "timeout",
      });
      await fake.emitMessage(slackMessage({ text: "hello" }));

      await waitForCondition(() => messages.length === 1);
      expect(messages[0]?.message).toMatchObject({
        chatId: "slack",
        conversationId: "C123",
        messageId: "171.000100",
        text: "hello",
      });
    } finally {
      await chat.close();
    }
  });

  test("thread conversation scope keeps channel and thread messages in separate conversations", async () => {
    const fake = createFakeSlackClient({
      botIdentity: { botUserId: "U_BOT", botId: "B_BOT", raw: {} },
    });
    const messages: SlackMessageEventForTest[] = [];
    const chat = createTestChat(fake, { conversationScope: "thread" });

    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitMessage(slackMessage({ text: "channel" }));
      await fake.emitMessage(
        slackMessage({ text: "thread", ts: "171.000200", thread_ts: "171.000001" }),
      );

      await waitForCondition(() => messages.length === 2);
      expect(messages.map((event) => event.conversation.conversationId)).toEqual([
        "C123",
        "C123:171.000001",
      ]);
    } finally {
      await chat.close();
    }
  });

  test("thread conversation scope replies back into the underlying Slack thread", async () => {
    const fake = createFakeSlackClient({
      botIdentity: { botUserId: "U_BOT", botId: "B_BOT", raw: {} },
    });
    const replies: boolean[] = [];
    const chat = createTestChat(fake, { conversationScope: "thread" });

    chat.on("message", async (event) => {
      const result = await event.reply("thread reply", { mode: "conversation" });
      replies.push(result.isOk());
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitMessage(
        slackMessage({ text: "thread", ts: "171.000200", thread_ts: "171.000001" }),
      );

      await waitForCondition(() => replies.length === 1);
      expect(replies).toEqual([true]);
      expect(fake.postMessageCalls[0]).toMatchObject({
        channel: "C123",
        thread_ts: "171.000001",
        text: "thread reply",
      });
    } finally {
      await chat.close();
    }
  });

  test("emits normalized reaction events", async () => {
    const fake = createFakeSlackClient();
    const reactions: SlackReactionAddedEventForTest[] = [];
    const chat = createTestChat(fake);

    chat.on("reaction.added", (event) => {
      reactions.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitReactionAdded(slackReaction({ reaction: "thumbsup" }));

      await waitForCondition(() => reactions.length === 1);
      expect(reactions[0]).toMatchObject({
        type: "reaction.added",
        chatId: "slack",
        message: { chatId: "slack", conversationId: "C123", messageId: "171.000100" },
        actor: { kind: "user", actorId: "U123" },
        reaction: "thumbsup",
      });
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
  options: Partial<CreateSlackAdapterOptions<"slack">> = {},
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

function slackMessage(
  overrides: Partial<{
    readonly text: string;
    readonly ts: string;
    readonly thread_ts: string;
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

function slackReaction(
  overrides: Partial<{ readonly reaction: string }> = {},
): SlackReactionEvent["event"] {
  return {
    type: "reaction_added",
    item: { type: "message", channel: "C123", ts: "171.000100" },
    reaction: "eyes",
    user: "U123",
    event_ts: "172.000000",
    ...overrides,
  } as never;
}
