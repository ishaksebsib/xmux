import {
  ChatStreamMessageError,
  createChat,
  defineChatCommand,
  defineChatCommands,
} from "@xmux/chat-core";
import { describe, expect, test, vi } from "vitest";
import { createDiscordAdapter } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import { DiscordStreamMessageError } from "../../src/errors";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";

const commands = defineChatCommands({
  stream_reply: defineChatCommand({ description: "Stream a reply" }),
});

describe("Discord streams contract", () => {
  test("chat.streamMessage sends a placeholder then edits the same message", async () => {
    vi.useFakeTimers();
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const streamed = chat.streamMessage({
        chatId: "discord",
        conversationId: "channel-1",
        content: { chunks: delayedChunks() },
        fallback: "error",
        adapterOptions: {},
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(fake.sentMessages).toHaveLength(1);
      expect(fake.sentMessages[0]?.payload).toMatchObject({ content: "…" });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(fake.editedMessages).toHaveLength(1);
      expect(fake.editedMessages[0]).toMatchObject({ channelId: "channel-1", messageId: "sent-1" });
      expect(fake.editedMessages[0]?.payload).toMatchObject({ content: "hello" });

      await vi.advanceTimersByTimeAsync(500);
      const result = await streamed;
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatchObject({ messageId: "sent-1", text: "hello world" });
      }
      expect(fake.editedMessages.at(-1)?.payload).toMatchObject({ content: "hello world" });
    } finally {
      await chat.close();
      vi.useRealTimers();
    }
  });

  test("edits are throttled and final text is flushed", async () => {
    vi.useFakeTimers();
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const streamed = chat.streamMessage({
        chatId: "discord",
        conversationId: "channel-1",
        content: { chunks: delayedChunks() },
        fallback: "error",
        adapterOptions: {},
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(fake.editedMessages).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(
        fake.editedMessages.map((edit) => (edit.payload as { content?: string }).content),
      ).toEqual(["hello"]);

      await vi.advanceTimersByTimeAsync(500);
      await streamed;
      expect(
        fake.editedMessages.map((edit) => (edit.payload as { content?: string }).content),
      ).toEqual(["hello", "hello world"]);
    } finally {
      await chat.close();
      vi.useRealTimers();
    }
  });

  test("chat.streamMessage rolls long streams over multiple Discord messages", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const result = await chat.streamMessage({
        chatId: "discord",
        conversationId: "channel-1",
        content: { chunks: singleChunk(`${"a".repeat(2_000)}${"b".repeat(120)}`), format: "markdown" },
        fallback: "error",
        adapterOptions: {},
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatchObject({ messageId: "sent-2" });
        expect(result.value.text).toHaveLength(2_120);
      }
      expect(fake.sentMessages).toHaveLength(2);
      expect(fake.editedMessages).toHaveLength(1);
      expect(fake.editedMessages[0]).toMatchObject({ channelId: "channel-1", messageId: "sent-1" });
      expect((fake.editedMessages[0]?.payload as { content?: string } | undefined)?.content).toHaveLength(2_000);
      expect((fake.sentMessages[1]?.payload as { content?: string } | undefined)?.content).toHaveLength(120);
    } finally {
      await chat.close();
    }
  });

  test("event.replyStream after slash command edits the deferred original response", async () => {
    vi.useFakeTimers();
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const interaction = createFakeSlashCommandInteraction("stream_reply");

    chat.on("command", "stream_reply", async (event) => {
      const result = await event.replyStream(
        { chunks: delayedChunks() },
        { mode: "conversation", fallback: "error", adapterOptions: {} },
      );
      if (result.isErr()) throw result.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(interaction);

      await vi.advanceTimersByTimeAsync(0);
      expect(interaction.callOrder.slice(0, 2)).toEqual(["deferReply", "editReply"]);
      expect(interaction.editedReplies[0]).toMatchObject({ content: "…" });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(interaction.editedReplies[1]).toMatchObject({ content: "hello" });
      expect(fake.editedMessages).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(500);
      expect(interaction.editedReplies.at(-1)).toMatchObject({ content: "hello world" });
    } finally {
      await chat.close();
      vi.useRealTimers();
    }
  });

  test("slash command stream replies send overflow segments as follow-ups", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const interaction = createFakeSlashCommandInteraction("stream_reply");

    chat.on("command", "stream_reply", async (event) => {
      const result = await event.replyStream(
        { chunks: singleChunk(`${"a".repeat(2_000)}${"b".repeat(120)}`), format: "markdown" },
        { mode: "conversation", fallback: "error", adapterOptions: {} },
      );
      if (result.isErr()) throw result.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(interaction);
      await vi.waitFor(() => expect(interaction.followUps).toHaveLength(1));

      expect(interaction.callOrder).toEqual(["deferReply", "editReply", "editReply", "followUp"]);
      expect((interaction.editedReplies.at(-1) as { content?: string }).content).toHaveLength(2_000);
      expect((interaction.followUps[0] as { content?: string }).content).toHaveLength(120);
      expect(fake.editedMessages).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("stream API failure maps typed errors", async () => {
    vi.useFakeTimers();
    const fake = createFakeDiscordClient({ editMessageError: new Error("edit failed") });
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const streamed = chat.streamMessage({
        chatId: "discord",
        conversationId: "channel-1",
        content: { chunks: delayedChunks() },
        fallback: "error",
        adapterOptions: {},
      });

      await vi.advanceTimersByTimeAsync(1_000);
      const result = await streamed;
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ChatStreamMessageError);
        expect(result.error.cause).toBeInstanceOf(DiscordStreamMessageError);
      }
    } finally {
      await chat.close();
      vi.useRealTimers();
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
        stream: { placeholderText: "…", editIntervalMs: 1_000 },
      }),
    },
    commands,
  });
}

async function* delayedChunks() {
  yield { type: "delta" as const, delta: "hello" };
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  yield { type: "delta" as const, delta: " world" };
}

async function* singleChunk(delta: string) {
  yield { type: "delta" as const, delta };
}

function createFakeSlashCommandInteraction(commandName: string) {
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
    options: { get: () => null },
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
