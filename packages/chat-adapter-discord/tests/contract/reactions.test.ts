import { createChat } from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createDiscordAdapter } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";
import { waitForCondition } from "../fixtures/collect";

describe("Discord reactions contract", () => {
  test("reaction add emits reaction.added", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const seen: string[] = [];
    chat.on("reaction.added", (event) => {
      seen.push(`${event.reaction}:${event.message.messageId}`);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitReactionAdd(discordReaction("👍"), discordUser());

      await waitForCondition(() => seen.length === 1);
      expect(seen).toEqual(["👍:message-1"]);
    } finally {
      await chat.close();
    }
  });

  test("reaction remove emits reaction.removed", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const seen: string[] = [];
    chat.on("reaction.removed", (event) => {
      seen.push(`${event.reaction}:${event.message.messageId}`);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitReactionRemove(discordReaction("🔥"), discordUser());

      await waitForCondition(() => seen.length === 1);
      expect(seen).toEqual(["🔥:message-1"]);
    } finally {
      await chat.close();
    }
  });

  test("bot and self reactions are ignored", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const seen: unknown[] = [];
    chat.on("reaction.added", (event) => {
      seen.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitReactionAdd(discordReaction("👍"), discordUser({ id: "bot-user-id" }));
      fake.emitReactionAdd(discordReaction("👍"), discordUser({ id: "bot-2", bot: true }));
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(seen).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("custom emoji is normalized consistently", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const seen: string[] = [];
    chat.on("reaction.added", (event) => {
      seen.push(event.reaction);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitReactionAdd(
        {
          message: { id: "message-1", channelId: "channel-1" },
          emoji: { id: "123", name: "party", animated: true },
        },
        discordUser(),
      );

      await waitForCondition(() => seen.length === 1);
      expect(seen).toEqual(["<a:party:123>"]);
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
        mode: { type: "gateway", observeReactions: true },
        createClient: (() => fake) satisfies CreateDiscordBotClient,
      }),
    },
    commands: {},
  });
}

function discordReaction(name: string) {
  return { message: { id: "message-1", channelId: "channel-1" }, emoji: { name } };
}

function discordUser(overrides: Partial<{ readonly id: string; readonly bot: boolean }> = {}) {
  return { id: "user-1", username: "user", bot: false, ...overrides };
}
