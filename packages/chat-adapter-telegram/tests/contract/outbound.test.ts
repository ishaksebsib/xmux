import { describe, expect, test } from "vitest";
import {
  actionValue,
  createChat,
  defineChatAction,
  defineChatActions,
} from "@xmux/chat-core";
import { createTelegramAdapter } from "../../src";
import { TelegramSendMessageError, TelegramSendTypingError } from "../../src/errors";
import { startFakeTelegramApi } from "../fixtures/fake-telegram-api";
import { fakeBotInfo } from "../fixtures/telegram-builders";

function createTelegramChat(api: Awaited<ReturnType<typeof startFakeTelegramApi>>) {
  return createChat({
    adapters: {
      telegram: createTelegramAdapter({
        token: api.token,
        botOptions: {
          client: { apiRoot: api.url },
          botInfo: fakeBotInfo(),
        },
      }),
    },
    commands: {},
  });
}

describe("Telegram outbound contract", () => {
  test("sendMessage serializes through grammY to the Telegram Bot API", async () => {
    const api = await startFakeTelegramApi();
    const chat = createTelegramChat(api);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      const sent = await chat.sendMessage({
        chatId: "telegram",
        conversationId: "12345",
        text: "**hello** from hello_world",
        format: "markdown",
        adapterOptions: { disable_notification: true },
      });

      expect(sent.isOk()).toBe(true);
      const request = await api.waitForMethod("sendMessage");
      expect(request.pathname).toBe(`/bot${api.token}/sendMessage`);
      expect(request.body).toMatchObject({
        chat_id: "12345",
        text: "*hello* from hello\\_world",
        parse_mode: "MarkdownV2",
        disable_notification: true,
      });
      if (sent.isOk()) {
        expect(sent.value).toMatchObject({
          chatId: "telegram",
          conversationId: "12345",
          messageId: "100",
          text: "**hello** from hello_world",
          format: "markdown",
          adapterData: { telegramChatId: "12345", telegramMessageId: 100 },
        });
      }
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("sendMessage exposes Telegram failure envelopes as typed failures", async () => {
    const api = await startFakeTelegramApi();
    api.setMethodError("sendMessage", {
      error_code: 400,
      description: "Bad Request: message is not modified",
    });
    const chat = createTelegramChat(api);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      const sent = await chat.sendMessage({
        chatId: "telegram",
        conversationId: "12345",
        text: "hello",
        adapterOptions: {},
      });

      expect(sent.isErr()).toBe(true);
      if (sent.isErr()) {
        expect(sent.error.cause).toBeInstanceOf(TelegramSendMessageError);
      }
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("typingIndicator sends sendChatAction while stripping message formatting options", async () => {
    const api = await startFakeTelegramApi();
    const chat = createTelegramChat(api);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      const typed = await chat.typingIndicator({
        chatId: "telegram",
        conversationId: "12345",
        action: "typing",
        mode: "pulse",
        adapterOptions: { message_thread_id: 9, parse_mode: "Markdown" },
      });

      expect(typed.isOk()).toBe(true);
      const request = await api.waitForMethod("sendChatAction");
      expect(request.body).toMatchObject({
        chat_id: "12345",
        action: "typing",
        message_thread_id: 9,
      });
      expect(request.body).not.toMatchObject({ parse_mode: expect.anything() });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("typingIndicator maps Telegram errors to typed failures", async () => {
    const api = await startFakeTelegramApi();
    api.setMethodError("sendChatAction", { error_code: 403, description: "Forbidden" });
    const chat = createTelegramChat(api);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      const typed = await chat.typingIndicator({
        chatId: "telegram",
        conversationId: "12345",
        action: "typing",
        adapterOptions: {},
      });

      expect(typed.isErr()).toBe(true);
      if (typed.isErr()) {
        expect(typed.error.cause).toBeInstanceOf(TelegramSendTypingError);
      }
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("sendAction serializes callback and URL buttons as inline keyboard markup", async () => {
    const api = await startFakeTelegramApi();
    const actions = defineChatActions({
      d: defineChatAction({
        values: {
          a: actionValue<{ id: string }>(),
        },
      }),
    });
    const chat = createChat({
      adapters: {
        telegram: createTelegramAdapter({
          token: api.token,
          botOptions: { client: { apiRoot: api.url }, botInfo: fakeBotInfo() },
        }),
      },
      commands: {},
      actions,
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      const sent = await chat.sendAction({
        chatId: "telegram",
        conversationId: "12345",
        text: "Deploy?",
        buttons: [
          [
            {
              kind: "action",
              id: "approve",
              label: "Approve",
              actionId: "d",
              value: "a",
              payload: { id: "1" },
            },
            { kind: "url", id: "logs", label: "Logs", url: "https://example.com/logs" },
          ],
        ],
        adapterOptions: {},
      });

      expect(sent.isOk()).toBe(true);
      const request = await api.waitForMethod("sendMessage");
      expect(request.body).toMatchObject({
        chat_id: "12345",
        text: "Deploy?",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Approve",
                callback_data: '{"actionId":"d","value":"a","payload":{"id":"1"}}',
              },
              { text: "Logs", url: "https://example.com/logs" },
            ],
          ],
        },
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });
});
