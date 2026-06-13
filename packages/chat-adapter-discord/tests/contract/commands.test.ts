import {
  ChatAdapterStartError,
  ChatReplyError,
  createChat,
  defineChatCommand,
  defineChatCommands,
  stringOption,
  type ChatLogger,
} from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createDiscordAdapter } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import { DiscordCommandRegistrationError, DiscordReplyError } from "../../src/errors";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";
import { createMockLogger, waitForCondition } from "../fixtures/collect";

const commands = defineChatCommands({
  start: defineChatCommand({ description: "Start the Discord demo bot" }),
  echo: defineChatCommand({
    description: "Echo text back to Discord",
    options: { text: stringOption({ required: true }) },
  }),
});

describe("Discord command contract", () => {
  test("chat.start registers commands through the Discord client with upsert by default", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);

      expect(fake.registeredCommands).toHaveLength(1);
      expect(fake.registeredCommands[0]).toMatchObject({
        applicationId: "application",
        scope: { type: "guild", guildId: "guild" },
        strategy: "upsert",
        commands: [
          { name: "start", description: "Start the Discord demo bot" },
          { name: "echo", description: "Echo text back to Discord" },
        ],
      });
    } finally {
      await chat.close();
    }
  });

  test("chat.start passes explicit bulk-overwrite command registration strategy", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake, { strategy: "bulk-overwrite" });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      expect(fake.registeredCommands).toHaveLength(1);
      expect(fake.registeredCommands[0]?.strategy).toBe("bulk-overwrite");
    } finally {
      await chat.close();
    }
  });

  test("bulk overwrite refuses to start when any command was skipped", async () => {
    const fake = createFakeDiscordClient();
    const unsafeCommands = defineChatCommands({
      BadName: defineChatCommand({ description: "Bad" }),
      good: defineChatCommand({ description: "Good" }),
    });
    const chat = createChat({
      adapters: {
        discord: createDiscordAdapter({
          token: "token",
          applicationId: "application",
          commandRegistration: {
            scope: { type: "guild", guildId: "guild" },
            strategy: "bulk-overwrite",
          },
          createClient: (() => fake) satisfies CreateDiscordBotClient,
        }),
      },
      commands: unsafeCommands,
    });

    try {
      const started = await chat.start();

      expect(started.isErr()).toBe(true);
      if (started.isErr()) {
        expect(started.error).toBeInstanceOf(ChatAdapterStartError);
        expect(started.error.cause).toBeInstanceOf(DiscordCommandRegistrationError);
      }
      expect(fake.registeredCommands).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("all-invalid command registration refuses to start", async () => {
    const fake = createFakeDiscordClient();
    const unsafeCommands = defineChatCommands({
      BadName: defineChatCommand({ description: "Bad" }),
    });
    const chat = createChat({
      adapters: {
        discord: createDiscordAdapter({
          token: "token",
          applicationId: "application",
          commandRegistration: { scope: { type: "guild", guildId: "guild" } },
          createClient: (() => fake) satisfies CreateDiscordBotClient,
        }),
      },
      commands: unsafeCommands,
    });

    try {
      const started = await chat.start();

      expect(started.isErr()).toBe(true);
      if (started.isErr()) {
        expect(started.error).toBeInstanceOf(ChatAdapterStartError);
        expect(started.error.cause).toBeInstanceOf(DiscordCommandRegistrationError);
      }
      expect(fake.registeredCommands).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("registration API failures fail startup with typed causes", async () => {
    const fake = createFakeDiscordClient({ registerCommandsError: new Error("register failed") });
    const chat = createDiscordChat(fake);

    try {
      const started = await chat.start();

      expect(started.isErr()).toBe(true);
      if (started.isErr()) {
        expect(started.error).toBeInstanceOf(ChatAdapterStartError);
        expect(started.error.cause).toBeInstanceOf(DiscordCommandRegistrationError);
      }
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
      const first = await event.reply("first", { mode: "conversation", adapterOptions: {} });
      if (first.isErr()) throw first.error;
      const second = await event.reply("second", { mode: "conversation", adapterOptions: {} });
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

  test("editReply failure from event.reply maps to chat and adapter reply errors", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const interaction = createFakeSlashCommandInteraction(
      "echo",
      { text: "hello" },
      {
        editReplyError: new Error("edit failed"),
      },
    );
    let replyFailed = false;
    let replyError: unknown;

    chat.on("command", "echo", async (event) => {
      const result = await event.reply("first", { mode: "conversation", adapterOptions: {} });
      if (result.isErr()) {
        replyFailed = true;
        replyError = result.error;
      }
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(interaction);

      await waitForCondition(() => replyFailed);
      expect(replyError).toBeInstanceOf(ChatReplyError);
      if (replyError instanceof ChatReplyError) {
        expect(replyError.cause).toBeInstanceOf(DiscordReplyError);
      }
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

  test("deferReply failures are emitted as error events", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const errors: unknown[] = [];

    chat.on("error", (event) => {
      errors.push(event.error);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(
        createFakeSlashCommandInteraction(
          "echo",
          { text: "hello" },
          {
            deferReplyError: new Error("defer failed"),
          },
        ),
      );

      await waitForCondition(() => errors.length === 1);
      expect(errors[0]).toBeInstanceOf(Error);
    } finally {
      await chat.close();
    }
  });

  test("unsupported interactions are ignored and logged", async () => {
    const fake = createFakeDiscordClient();
    const logger = createMockLogger();
    const debug = logger.debug as unknown as {
      readonly mock: { readonly calls: readonly unknown[] };
    };
    const chat = createDiscordChat(fake, { logger });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction({ id: "unsupported", isChatInputCommand: () => false });

      await waitForCondition(() => debug.mock.calls.length > 0);
      expect(logger.debug).toHaveBeenCalledWith(
        "xmux.discord.inbound.ignored",
        expect.objectContaining({ reason: "unsupported_interaction" }),
      );
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

function createDiscordChat(
  fake: FakeDiscordBotClient,
  options: {
    readonly strategy?: "upsert" | "bulk-overwrite";
    readonly logger?: ChatLogger;
  } = {},
) {
  return createChat({
    adapters: {
      discord: createDiscordAdapter({
        token: "token",
        applicationId: "application",
        commandRegistration: {
          scope: { type: "guild", guildId: "guild" },
          strategy: options.strategy,
        },
        createClient: (() => fake) satisfies CreateDiscordBotClient,
      }),
    },
    commands,
    logger: options.logger,
  });
}

function createFakeSlashCommandInteraction(
  commandName: string,
  options: Readonly<Record<string, unknown>>,
  behavior: {
    readonly deferReplyError?: unknown;
    readonly editReplyError?: unknown;
  } = {},
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
      if (behavior.deferReplyError !== undefined) {
        throw behavior.deferReplyError;
      }
    },
    async editReply(payload: unknown) {
      this.callOrder.push("editReply");
      if (behavior.editReplyError !== undefined) {
        throw behavior.editReplyError;
      }
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
