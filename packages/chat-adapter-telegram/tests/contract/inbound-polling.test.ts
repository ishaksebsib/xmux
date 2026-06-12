import { describe, expect, test } from "vitest";
import {
  actionValue,
  createChat,
  defineChatAction,
  defineChatActions,
  defineChatCommand,
  defineChatCommands,
  stringOption,
} from "@xmux/chat-core";
import { createTelegramAdapter } from "../../src";
import { waitForCondition } from "../fixtures/collect";
import { startFakeTelegramApi } from "../fixtures/fake-telegram-api";
import {
  fakeBotInfo,
  telegramCallbackQuery,
  telegramChat,
  telegramTextMessage,
  telegramUpdate,
  telegramUser,
} from "../fixtures/telegram-builders";

function createAdapter(api: Awaited<ReturnType<typeof startFakeTelegramApi>>) {
  return createTelegramAdapter({
    token: api.token,
    botOptions: { client: { apiRoot: api.url }, botInfo: fakeBotInfo() },
  });
}

describe("Telegram inbound polling contract", () => {
  test("polling a text update emits a normalized chat-core message event", async () => {
    const api = await startFakeTelegramApi();
    const chat = createChat({
      adapters: { telegram: createAdapter(api) },
      commands: {},
    });
    const messages: unknown[] = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      api.enqueueUpdate(
        telegramUpdate({
          update_id: 101,
          message: telegramTextMessage({
            message_id: 55,
            chat: telegramChat({ id: -100 }),
            from: telegramUser({ id: 7, first_name: "Bob", username: "bob" }),
            text: "hello from polling",
          }),
        }),
      );

      await waitForCondition(() => messages.length === 1);
      expect(messages[0]).toMatchObject({
        type: "message",
        chatId: "telegram",
        conversation: { conversationId: "-100" },
        message: {
          messageId: "55",
          text: "hello from polling",
          format: "plain",
          actor: { kind: "user", actorId: "7", displayName: "Bob" },
          adapterData: { telegramChatId: "-100", telegramMessageId: 55, updateId: 101 },
        },
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("slash commands are parsed from real Telegram updates", async () => {
    const api = await startFakeTelegramApi();
    const commands = defineChatCommands({
      echo: defineChatCommand({
        description: "Echo text",
        options: { text: stringOption({ required: true }) },
      }),
    });
    const chat = createChat({
      adapters: { telegram: createAdapter(api) },
      commands,
    });
    const commandsSeen: unknown[] = [];
    chat.on("command", (event) => {
      commandsSeen.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      api.enqueueUpdate(
        telegramUpdate({
          update_id: 102,
          message: telegramTextMessage({
            text: "/echo hello from telegram",
            entities: [{ type: "bot_command", offset: 0, length: "/echo".length }],
          }),
        }),
      );

      await waitForCondition(() => commandsSeen.length === 1);
      expect(commandsSeen[0]).toMatchObject({
        type: "command",
        command: { name: "echo", options: { text: "hello from telegram" } },
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("callback query updates with supported JSON data emit action events", async () => {
    const api = await startFakeTelegramApi();
    const actions = defineChatActions({
      deployment: defineChatAction({
        values: { approve: actionValue<{ deploymentId: string }>() },
      }),
    });
    const chat = createChat({
      adapters: { telegram: createAdapter(api) },
      commands: {},
      actions,
    });
    const actionsSeen: unknown[] = [];
    chat.on("action", (event) => {
      actionsSeen.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      api.enqueueUpdate(
        telegramUpdate({
          update_id: 103,
          callback_query: telegramCallbackQuery({
            id: "callback-1",
            data: JSON.stringify({
              actionId: "deployment",
              value: "approve",
              payload: { deploymentId: "dep1" },
            }),
          }),
        }),
      );

      await waitForCondition(() => actionsSeen.length === 1);
      expect(actionsSeen[0]).toMatchObject({
        type: "action",
        chatId: "telegram",
        interactionId: "callback-1",
        actionId: "deployment",
        value: "approve",
        payload: { deploymentId: "dep1" },
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("self messages from the current bot are ignored", async () => {
    const api = await startFakeTelegramApi();
    const chat = createChat({
      adapters: { telegram: createAdapter(api) },
      commands: {},
    });
    const messages: unknown[] = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 104,
          message: telegramTextMessage({
            from: telegramUser({ id: 999, is_bot: true, first_name: "Xmux", username: "xmux_bot" }),
            text: "bot echo",
          }),
        }),
      );

      await waitForCondition(
        () => api.requests.filter((request) => request.telegramMethod === "getUpdates").length >= 2,
      );
      expect(messages).toHaveLength(0);
    } finally {
      await chat.close();
      await api.close();
    }
  });
});
