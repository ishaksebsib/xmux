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

function slackMessage(
  overrides: Partial<{ readonly text: string }> = {},
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
