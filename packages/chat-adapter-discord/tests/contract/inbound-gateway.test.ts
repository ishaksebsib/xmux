import {
  createChat,
  defineChatCommand,
  defineChatCommands,
  stringOption,
  type ChatMessageEvent,
} from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createDiscordAdapter, type DiscordAdapterData } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";
import { waitForCondition } from "../fixtures/collect";

const commands = defineChatCommands({
  echo: defineChatCommand({
    description: "Echo text back to Discord",
    options: { text: stringOption({ required: true }) },
  }),
});

describe("Discord gateway inbound contract", () => {
  test("fake gateway message emits message event through chat-core", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const messages: Array<ChatMessageEvent<"discord", DiscordAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessage({ content: "hello" }));

      await waitForCondition(() => messages.length === 1);
      expect(messages[0]?.message).toMatchObject({
        conversationId: "channel-1",
        messageId: "message-1",
        text: "hello",
        actor: { kind: "user", actorId: "user-1" },
      });
    } finally {
      await chat.close();
    }
  });

  test("fake slash command still emits command event", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const seen: string[] = [];
    chat.on("command", "echo", (event) => {
      seen.push(event.command.options.text);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(createFakeSlashCommandInteraction("echo", { text: "hello" }));

      await waitForCondition(() => seen.length === 1);
      expect(seen).toEqual(["hello"]);
    } finally {
      await chat.close();
    }
  });

  test("self messages are ignored", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const messages: unknown[] = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessage({ author: { id: "bot-user-id", bot: false } }));
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(messages).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("DM message emits message event", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const conversations: string[] = [];
    chat.on("message", (event) => {
      conversations.push(event.conversation.conversationId);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessage({ channelId: "dm-1", guildId: null, content: "dm" }));

      await waitForCondition(() => conversations.length === 1);
      expect(conversations).toEqual(["dm-1"]);
    } finally {
      await chat.close();
    }
  });

  test("message with attachment includes lazy attachment handle", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const messages: Array<ChatMessageEvent<"discord", DiscordAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(
        discordMessage({
          attachments: [
            {
              id: "attachment-1",
              url: "https://cdn.example/report.pdf",
              name: "report.pdf",
              contentType: "application/pdf",
              size: 3,
            },
          ],
        }),
      );

      await waitForCondition(() => messages.length === 1);
      expect(messages[0]?.message.attachments[0]).toMatchObject({
        attachmentId: "attachment-1",
        kind: "document",
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
      });
      expect(fake.downloadedAttachments).toHaveLength(0);
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
        mode: { type: "gateway", observeMessages: true },
        createClient: (() => fake) satisfies CreateDiscordBotClient,
      }),
    },
    commands,
  });
}

function discordMessage(
  overrides: Partial<{
    readonly id: string;
    readonly channelId: string;
    readonly guildId: string | null;
    readonly content: string;
    readonly author: { readonly id: string; readonly username?: string; readonly bot?: boolean };
    readonly attachments: unknown;
  }> = {},
) {
  return {
    id: "message-1",
    channelId: "channel-1",
    guildId: "guild-1",
    content: "hello",
    author: { id: "user-1", username: "user", bot: false },
    attachments: [],
    ...overrides,
  };
}

function createFakeSlashCommandInteraction(
  commandName: string,
  options: Readonly<Record<string, unknown>>,
) {
  return {
    id: "interaction-1",
    channelId: "channel-1",
    guildId: "guild-1",
    commandName,
    user: { id: "user-1", username: "user" },
    isChatInputCommand: () => true,
    options: {
      get(name: string) {
        return name in options ? { value: options[name] } : null;
      },
    },
    async deferReply() {},
    async editReply() {
      return { id: "edit-1", channelId: this.channelId, guildId: this.guildId };
    },
    async followUp() {
      return { id: "follow-1", channelId: this.channelId, guildId: this.guildId };
    },
  };
}
