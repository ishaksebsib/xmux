import { describe, expect, test } from "vitest";
import { createChat } from "@xmux/chat-core";
import { createTelegramAdapter } from "../../src";
import { TelegramActionResponseError } from "../../src/errors";
import { startFakeTelegramApi } from "../fixtures/fake-telegram-api";
import { fakeBotInfo } from "../fixtures/telegram-builders";

function createTelegramChat(api: Awaited<ReturnType<typeof startFakeTelegramApi>>) {
  return createChat({
    adapters: {
      telegram: createTelegramAdapter({
        token: api.token,
        botOptions: { client: { apiRoot: api.url }, botInfo: fakeBotInfo() },
      }),
    },
    commands: {},
  });
}

async function startChat(api: Awaited<ReturnType<typeof startFakeTelegramApi>>) {
  const chat = createTelegramChat(api);
  expect((await chat.start()).isOk()).toBe(true);
  await api.waitForMethod("getUpdates");
  return chat;
}

describe("Telegram action response contract", () => {
  test("ack responses call answerCallbackQuery with Telegram alert options", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);

    try {
      const responded = await chat.respondToAction({
        chatId: "telegram",
        conversationId: "12345",
        interactionId: "callback-1",
        message: { chatId: "telegram", conversationId: "12345", messageId: "100" },
        response: { kind: "ack", text: "Done", showAlert: true },
      });

      expect(responded.isOk()).toBe(true);
      const request = await api.waitForMethod("answerCallbackQuery");
      expect(request.body).toMatchObject({ callback_query_id: "callback-1", text: "Done", show_alert: true });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("reply responses send a formatted Telegram message", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);

    try {
      const responded = await chat.respondToAction({
        chatId: "telegram",
        conversationId: "12345",
        interactionId: "callback-1",
        message: { chatId: "telegram", conversationId: "12345", messageId: "100" },
        response: { kind: "reply", message: { text: "**approved**", format: "markdown" } },
        adapterOptions: { disable_notification: true },
      });

      expect(responded.isOk()).toBe(true);
      const request = await api.waitForMethod("sendMessage");
      expect(request.body).toMatchObject({
        chat_id: "12345",
        text: "*approved*",
        parse_mode: "MarkdownV2",
        disable_notification: true,
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("update responses edit the original Telegram message and buttons", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);

    try {
      const responded = await chat.respondToAction({
        chatId: "telegram",
        conversationId: "12345",
        interactionId: "callback-1",
        message: { chatId: "telegram", conversationId: "12345", messageId: "100" },
        response: {
          kind: "update",
          message: "Updated",
          buttons: [[{ id: "docs", kind: "url", label: "Docs", url: "https://example.com/docs" }]],
        },
      });

      expect(responded.isOk()).toBe(true);
      const request = await api.waitForMethod("editMessageText");
      expect(request.body).toMatchObject({
        chat_id: "12345",
        message_id: 100,
        text: "Updated",
        reply_markup: { inline_keyboard: [[{ text: "Docs", url: "https://example.com/docs" }]] },
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("Telegram action response failures become typed adapter failures", async () => {
    const api = await startFakeTelegramApi();
    api.setMethodError("answerCallbackQuery", { error_code: 400, description: "Bad Request" });
    const chat = await startChat(api);

    try {
      const responded = await chat.respondToAction({
        chatId: "telegram",
        conversationId: "12345",
        interactionId: "callback-1",
        message: { chatId: "telegram", conversationId: "12345", messageId: "100" },
        response: { kind: "ack" },
      });

      expect(responded.isErr()).toBe(true);
      if (responded.isErr()) {
        expect(responded.error.cause).toBeInstanceOf(TelegramActionResponseError);
      }
    } finally {
      await chat.close();
      await api.close();
    }
  });
});
