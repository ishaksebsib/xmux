import { describe, expect, test } from "vitest";
import { createChat, defineChatCommand, defineChatCommands, numberOption } from "@xmux/chat-core";
import { createTelegramAdapter } from "../../src";
import { waitForCondition } from "../fixtures/collect";
import { startFakeTelegramApi } from "../fixtures/fake-telegram-api";
import {
  fakeBotInfo,
  telegramChat,
  telegramPhotoMessage,
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

describe("Telegram inbound normalization contract", () => {
  test("photo updates choose the largest photo as an image attachment", async () => {
    const api = await startFakeTelegramApi();
    const chat = createChat({ adapters: { telegram: createAdapter(api) }, commands: {} });
    const messages: unknown[] = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 301,
          message: telegramPhotoMessage({
            photo: [
              {
                file_id: "small",
                file_unique_id: "small-unique",
                width: 10,
                height: 10,
                file_size: 100,
              },
              {
                file_id: "large",
                file_unique_id: "large-unique",
                width: 100,
                height: 100,
                file_size: 200,
              },
            ],
          }),
        }),
      );

      await waitForCondition(() => messages.length === 1);
      expect(messages[0]).toMatchObject({
        message: {
          attachments: [
            {
              attachmentId: "large-unique",
              kind: "image",
              disposition: "inline",
              mimeType: "image/jpeg",
              adapterData: { telegramFileId: "large", telegramFileUniqueId: "large-unique" },
            },
          ],
        },
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("bot and missing actors are normalized as bot and system actors", async () => {
    const api = await startFakeTelegramApi();
    const chat = createChat({ adapters: { telegram: createAdapter(api) }, commands: {} });
    const messages: unknown[] = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 302,
          message: telegramTextMessage({
            from: telegramUser({
              id: 77,
              is_bot: true,
              first_name: "Helper",
              username: "helper_bot",
            }),
            text: "bot message",
          }),
        }),
      );
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 303,
          message: telegramTextMessage({
            chat: telegramChat({ id: -100, type: "group", title: "Team" }),
            from: undefined,
            text: "system message",
          }),
        }),
      );

      await waitForCondition(() => messages.length === 2);
      expect(messages[0]).toMatchObject({
        message: { actor: { kind: "bot", actorId: "77", displayName: "Helper" } },
      });
      expect(messages[1]).toMatchObject({
        message: { actor: { kind: "system", actorId: "-100", displayName: "Team" } },
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("commands for other bots stay messages while unknown and invalid commands emit command events", async () => {
    const api = await startFakeTelegramApi();
    const commands = defineChatCommands({
      scale: defineChatCommand({
        description: "Scale",
        options: { replicas: numberOption({ required: true }) },
      }),
    });
    const chat = createChat({ adapters: { telegram: createAdapter(api) }, commands });
    const messages: unknown[] = [];
    const unknown: unknown[] = [];
    const invalid: unknown[] = [];
    chat.on("message", (event) => {
      messages.push(event);
    });
    chat.on("command.unknown", (event) => {
      unknown.push(event);
    });
    chat.on("command.invalid", (event) => {
      invalid.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 304,
          message: telegramTextMessage({
            text: "/scale@other_bot --replicas 2",
            entities: [{ type: "bot_command", offset: 0, length: "/scale@other_bot".length }],
          }),
        }),
      );
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 305,
          message: telegramTextMessage({
            text: "/missing",
            entities: [{ type: "bot_command", offset: 0, length: "/missing".length }],
          }),
        }),
      );
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 306,
          message: telegramTextMessage({
            text: "/scale --replicas nope",
            entities: [{ type: "bot_command", offset: 0, length: "/scale".length }],
          }),
        }),
      );

      await waitForCondition(
        () => messages.length === 1 && unknown.length === 1 && invalid.length === 1,
      );
      expect(messages[0]).toMatchObject({
        type: "message",
        message: { text: "/scale@other_bot --replicas 2" },
      });
      expect(unknown[0]).toMatchObject({ type: "command.unknown", commandName: "missing" });
      expect(invalid[0]).toMatchObject({
        type: "command.invalid",
        commandName: "scale",
        optionName: "replicas",
        reason: "number option must be numeric",
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });
});
