import { describe, expect, test } from "vitest";
import { createChat, defineChatCommand, defineChatCommands, stringOption } from "@xmux/chat-core";
import { createTelegramAdapter } from "../../src";
import { TelegramConfigurationError, TelegramWebhookModeUnsupportedError } from "../../src/errors";
import { createMockLogger } from "../fixtures/collect";
import { startFakeTelegramApi } from "../fixtures/fake-telegram-api";
import { fakeBotInfo } from "../fixtures/telegram-builders";

describe("Telegram lifecycle contract", () => {
  test("start rejects an empty token before any Telegram API request", async () => {
    const api = await startFakeTelegramApi();
    const chat = createChat({
      adapters: {
        telegram: createTelegramAdapter({
          token: "",
          botOptions: { client: { apiRoot: api.url }, botInfo: fakeBotInfo() },
        }),
      },
      commands: {},
    });

    try {
      const started = await chat.start();
      expect(started.isErr()).toBe(true);
      if (started.isErr()) {
        expect(started.error.cause).toBeInstanceOf(TelegramConfigurationError);
      }
      expect(api.requests).toHaveLength(0);
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("start uses botInfo, registers commands, and starts polling with configured options", async () => {
    const api = await startFakeTelegramApi();
    const logger = createMockLogger();
    const commands = defineChatCommands({
      start: defineChatCommand({ description: "Start session" }),
      echo: defineChatCommand({
        description: "Echo text",
        options: { text: stringOption({ required: true }) },
      }),
    });
    const chat = createChat({
      adapters: {
        telegram: createTelegramAdapter({
          token: api.token,
          mode: {
            type: "polling",
            dropPendingUpdates: true,
            allowedUpdates: ["message", "callback_query"],
          },
          botOptions: { client: { apiRoot: api.url }, botInfo: fakeBotInfo() },
        }),
      },
      commands,
      logger,
    });

    try {
      const started = await chat.start();
      expect(started.isOk()).toBe(true);

      const setCommands = await api.waitForMethod("setMyCommands");
      expect(setCommands.body).toMatchObject({
        commands: [
          { command: "start", description: "Start session" },
          { command: "echo", description: "Echo text" },
        ],
      });

      const getUpdates = await api.waitForMethod("getUpdates");
      expect(getUpdates.body).toMatchObject({
        allowed_updates: ["message", "callback_query"],
      });
      expect(api.requests.some((request) => request.telegramMethod === "getMe")).toBe(false);
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("webhook mode fails with explicit typed adapter error", async () => {
    const api = await startFakeTelegramApi();
    const chat = createChat({
      adapters: {
        telegram: createTelegramAdapter({
          token: api.token,
          mode: { type: "webhook", secretToken: "secret" },
          botOptions: { client: { apiRoot: api.url }, botInfo: fakeBotInfo() },
        }),
      },
      commands: {},
    });

    try {
      const started = await chat.start();

      expect(started.isErr()).toBe(true);
      if (started.isErr()) {
        expect(started.error.cause).toBeInstanceOf(TelegramWebhookModeUnsupportedError);
      }
      expect(api.requests).toHaveLength(0);
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("close stops polling cleanly after polling has started", async () => {
    const api = await startFakeTelegramApi();
    const chat = createChat({
      adapters: {
        telegram: createTelegramAdapter({
          token: api.token,
          botOptions: { client: { apiRoot: api.url }, botInfo: fakeBotInfo() },
        }),
      },
      commands: {},
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");
      expect((await chat.close()).isOk()).toBe(true);
    } finally {
      await api.close();
    }
  });
});
