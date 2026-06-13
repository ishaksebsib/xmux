import { createChat, defineChatCommand, defineChatCommands, stringOption } from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createDiscordAdapter } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";
import { waitForCondition } from "../fixtures/collect";

const commands = defineChatCommands({
  start: defineChatCommand({ description: "Start the Discord demo bot" }),
  echo: defineChatCommand({
    description: "Echo text back to Discord",
    options: { text: stringOption({ required: true }) },
  }),
});

describe("Discord command contract", () => {
  test("chat.start registers commands through the Discord client", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      expect(fake.registeredCommands).toHaveLength(1);
      expect(fake.registeredCommands[0]).toMatchObject({
        applicationId: "application",
        scope: { type: "guild", guildId: "guild" },
        commands: [
          { name: "start", description: "Start the Discord demo bot" },
          { name: "echo", description: "Echo text back to Discord" },
        ],
      });
    } finally {
      await chat.close();
    }
  });

  test("fake slash command interaction emits a command event after deferral", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const interaction = createFakeSlashCommandInteraction("echo", { text: "hello" });
    const order: string[] = [];
    interaction.callOrder = order;

    chat.on("command", "echo", (event) => {
      order.push("event");
      expect(event.command.options.text).toBe("hello");
      expect(event.message?.messageId).toBe("discord-interaction:interaction-1");
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(interaction);

      await waitForCondition(() => order.includes("event"));
      expect(order.slice(0, 2)).toEqual(["deferReply", "event"]);
    } finally {
      await chat.close();
    }
  });

  test("event.reply after slash command edits original response then follows up", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const interaction = createFakeSlashCommandInteraction("echo", { text: "hello" });

    chat.on("command", "echo", async (event) => {
      const first = await event.reply("first", { mode: "conversation" });
      if (first.isErr()) throw first.error;
      const second = await event.reply("second", { mode: "conversation" });
      if (second.isErr()) throw second.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(interaction);

      await waitForCondition(() => interaction.editedReplies.length === 1);
      await waitForCondition(() => interaction.followUps.length === 1);
      expect(interaction.editedReplies[0]).toMatchObject({ content: "first" });
      expect(interaction.followUps[0]).toMatchObject({ content: "second" });
    } finally {
      await chat.close();
    }
  });

  test("unknown slash command emits command.unknown", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const seen: string[] = [];

    chat.on("command.unknown", (event) => {
      seen.push(event.commandName);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(createFakeSlashCommandInteraction("missing", {}));

      await waitForCondition(() => seen.length === 1);
      expect(seen).toEqual(["missing"]);
    } finally {
      await chat.close();
    }
  });

  test("invalid slash command emits command.invalid", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const reasons: string[] = [];

    chat.on("command.invalid", (event) => {
      reasons.push(`${event.commandName}:${event.optionName}:${event.reason}`);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(createFakeSlashCommandInteraction("echo", {}));

      await waitForCondition(() => reasons.length === 1);
      expect(reasons).toEqual(["echo:text:required option is missing"]);
    } finally {
      await chat.close();
    }
  });

  test("command handler errors emit error events through chat-core", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const errors: unknown[] = [];

    chat.on("error", (event) => {
      errors.push(event.error);
    });
    chat.on("command", "echo", () => {
      throw new Error("handler failed");
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(createFakeSlashCommandInteraction("echo", { text: "hello" }));

      await waitForCondition(() => errors.length === 1);
      expect(errors[0]).toBeInstanceOf(Error);
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
        commandRegistration: { scope: { type: "guild", guildId: "guild" } },
        createClient: (() => fake) satisfies CreateDiscordBotClient,
      }),
    },
    commands,
  });
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
    callOrder: [] as string[],
    editedReplies: [] as unknown[],
    followUps: [] as unknown[],
    isChatInputCommand: () => true,
    options: {
      get(name: string) {
        return name in options ? { value: options[name] } : null;
      },
    },
    async deferReply() {
      this.callOrder.push("deferReply");
    },
    async editReply(payload: unknown) {
      this.callOrder.push("editReply");
      this.editedReplies.push(payload);
      return { id: "edit-1", channelId: this.channelId, guildId: this.guildId };
    },
    async followUp(payload: unknown) {
      this.callOrder.push("followUp");
      this.followUps.push(payload);
      return {
        id: `follow-${this.followUps.length}`,
        channelId: this.channelId,
        guildId: this.guildId,
      };
    },
  };
}
