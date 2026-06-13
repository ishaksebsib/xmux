import {
  ChatActionResponseError,
  actionValue,
  createChat,
  defineChatAction,
  defineChatActions,
  defineChatCommands,
} from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createDiscordAdapter } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import { DiscordActionResponseError } from "../../src/errors";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";
import { waitForCondition } from "../fixtures/collect";

const commands = defineChatCommands({});
const actions = defineChatActions({
  deployment: defineChatAction({
    values: {
      approve: actionValue<{ deploymentId: string }>(),
      reject: actionValue<{ deploymentId: string }>(),
    },
  }),
});

describe("Discord action contract", () => {
  test("chat.sendAction sends a message with Discord components", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const sent = await chat.sendAction({
        chatId: "discord",
        conversationId: "channel-1",
        text: "Deploy build 123?",
        buttons: [[deploymentButton("approve")]],
        adapterOptions: {},
      });

      expect(sent.isOk()).toBe(true);
      expect(fake.sentMessages).toHaveLength(1);
      const payload = fake.sentMessages[0]?.payload as { components?: unknown; content?: string };
      expect(payload).toMatchObject({
        content: "Deploy build 123?",
      });
      expect(payload.components).toBeDefined();
    } finally {
      await chat.close();
    }
  });

  test("fake button click emits typed action event after deferUpdate", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const seen: string[] = [];

    chat.on("action", "deployment", (event) => {
      seen.push(`${event.value}:${event.payload.deploymentId}`);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const customId = await sendDeploymentActionAndGetCustomId(chat, fake);
      const interaction = createFakeButtonInteraction(customId);
      fake.emitInteraction(interaction);

      await waitForCondition(() => seen.length === 1);
      expect(interaction.callOrder[0]).toBe("deferUpdate");
      expect(seen).toEqual(["approve:build-123"]);
    } finally {
      await chat.close();
    }
  });

  test("event.ack succeeds after deferUpdate", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    let acked = false;

    chat.on("action", "deployment", async (event) => {
      const result = await event.ack();
      if (result.isErr()) throw result.error;
      acked = true;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitInteraction(
        createFakeButtonInteraction(await sendDeploymentActionAndGetCustomId(chat, fake)),
      );

      await waitForCondition(() => acked);
    } finally {
      await chat.close();
    }
  });

  test("event.reply sends a follow-up and event.update edits original message", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const interaction = createFakeButtonInteraction("placeholder");

    chat.on("action", "deployment", async (event) => {
      const replied = await event.reply("Queued", { adapterOptions: {} });
      if (replied.isErr()) throw replied.error;
      const updated = await event.update({
        message: `${event.value} clicked`,
        buttons: [],
        adapterOptions: {},
      });
      if (updated.isErr()) throw updated.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      interaction.customId = await sendDeploymentActionAndGetCustomId(chat, fake);
      fake.emitInteraction(interaction);

      await waitForCondition(() => interaction.followUps.length === 1);
      await waitForCondition(() => interaction.editedReplies.length === 1);
      expect(interaction.followUps[0]).toMatchObject({ content: "Queued" });
      expect(interaction.editedReplies[0]).toMatchObject({
        content: "approve clicked",
        components: [],
      });
    } finally {
      await chat.close();
    }
  });

  test("Discord API failure maps to chat and adapter action response errors", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    let responseError: unknown;

    chat.on("action", "deployment", async (event) => {
      const result = await event.update({ message: "failed", adapterOptions: {} });
      if (result.isErr()) responseError = result.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const customId = await sendDeploymentActionAndGetCustomId(chat, fake);
      fake.emitInteraction(
        createFakeButtonInteraction(customId, { editReplyError: new Error("edit failed") }),
      );

      await waitForCondition(() => responseError !== undefined);
      expect(responseError).toBeInstanceOf(ChatActionResponseError);
      if (responseError instanceof ChatActionResponseError) {
        expect(responseError.cause).toBeInstanceOf(DiscordActionResponseError);
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
    commands,
    actions,
  });
}

function deploymentButton(value: "approve" | "reject") {
  return {
    id: value,
    label: value === "approve" ? "Approve" : "Reject",
    actionId: "deployment",
    value,
    payload: { deploymentId: "build-123" },
    style: value === "approve" ? "success" : "danger",
  } as const;
}

async function sendDeploymentActionAndGetCustomId(
  chat: ReturnType<typeof createDiscordChat>,
  fake: FakeDiscordBotClient,
): Promise<string> {
  const sent = await chat.sendAction({
    chatId: "discord",
    conversationId: "channel-1",
    text: "Deploy build 123?",
    buttons: [[deploymentButton("approve")]],
    adapterOptions: {},
  });
  if (sent.isErr()) throw sent.error;

  const payload = fake.sentMessages.at(-1)?.payload as {
    readonly components?: readonly [
      { readonly components: readonly [{ readonly custom_id: string }] },
    ];
  };
  const customId = payload.components?.[0]?.components[0]?.custom_id;
  if (customId === undefined) throw new Error("Missing custom id");
  return customId;
}

function createFakeButtonInteraction(
  customId: string,
  behavior: { readonly editReplyError?: unknown } = {},
) {
  return {
    id: "button-interaction-1",
    channelId: "channel-1",
    guildId: "guild-1",
    customId,
    message: { id: "message-1" },
    user: { id: "user-1", username: "user" },
    callOrder: [] as string[],
    editedReplies: [] as unknown[],
    followUps: [] as unknown[],
    isButton: () => true,
    async deferUpdate() {
      this.callOrder.push("deferUpdate");
    },
    async editReply(payload: unknown) {
      this.callOrder.push("editReply");
      if (behavior.editReplyError !== undefined) {
        throw behavior.editReplyError;
      }
      this.editedReplies.push(payload);
      return { id: this.message.id, channelId: this.channelId, guildId: this.guildId };
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
