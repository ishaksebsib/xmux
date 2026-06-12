import { describe, expect, test } from "vitest";
import { createChat } from "@xmux/chat-core";
import { createTelegramAdapter } from "../../src";
import { TelegramReplyError } from "../../src/errors";
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

describe("Telegram reply contract", () => {
  test("auto replies include Telegram reply_parameters when a numeric message id is available", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);

    try {
      const replied = await chat.reply({
        chatId: "telegram",
        conversationId: "12345",
        messageId: "99",
        text: "**hello**",
        format: "markdown",
      });

      expect(replied.isOk()).toBe(true);
      const request = await api.waitForMethod("sendMessage");
      expect(request.body).toMatchObject({
        chat_id: "12345",
        text: "*hello*",
        parse_mode: "MarkdownV2",
        reply_parameters: { message_id: 99 },
      });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("conversation replies send normal messages without reply parameters", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);

    try {
      const replied = await chat.reply({
        chatId: "telegram",
        conversationId: "12345",
        messageId: "99",
        mode: "conversation",
        text: "hello",
        adapterOptions: { disable_notification: true },
      });

      expect(replied.isOk()).toBe(true);
      const request = await api.waitForMethod("sendMessage");
      expect(request.body).toMatchObject({ chat_id: "12345", text: "hello", disable_notification: true });
      expect(request.body).not.toMatchObject({ reply_parameters: expect.anything() });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("strict quote replies require a usable Telegram message id", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);
    const requestCount = api.requests.length;

    try {
      const replied = await chat.reply({
        chatId: "telegram",
        conversationId: "12345",
        mode: "quote",
        text: "hello",
      });

      expect(replied.isErr()).toBe(true);
      if (replied.isErr()) {
        expect(replied.error.cause).toBeInstanceOf(TelegramReplyError);
      }
      expect(api.requests.slice(requestCount).some((request) => request.telegramMethod === "sendMessage")).toBe(false);
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("thread replies require message_thread_id", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);

    try {
      const missingThread = await chat.reply({
        chatId: "telegram",
        conversationId: "12345",
        messageId: "99",
        mode: "thread",
        text: "hello",
      });
      expect(missingThread.isErr()).toBe(true);
      if (missingThread.isErr()) {
        expect(missingThread.error.cause).toBeInstanceOf(TelegramReplyError);
      }

      const threaded = await chat.reply({
        chatId: "telegram",
        conversationId: "12345",
        messageId: "99",
        mode: "thread",
        text: "hello thread",
        adapterOptions: { message_thread_id: 7 },
      });
      expect(threaded.isOk()).toBe(true);
      const request = await api.waitForMethod("sendMessage");
      expect(request.body).toMatchObject({ chat_id: "12345", text: "hello thread", message_thread_id: 7 });
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("Telegram send failures during replies become typed adapter failures", async () => {
    const api = await startFakeTelegramApi();
    api.setMethodError("sendMessage", { error_code: 403, description: "Forbidden" });
    const chat = await startChat(api);

    try {
      const replied = await chat.reply({
        chatId: "telegram",
        conversationId: "12345",
        messageId: "99",
        text: "hello",
      });

      expect(replied.isErr()).toBe(true);
      if (replied.isErr()) {
        expect(replied.error.cause).toBeInstanceOf(TelegramReplyError);
      }
    } finally {
      await chat.close();
      await api.close();
    }
  });
});
