import { describe, expect, test } from "vitest";
import {
  actionValue,
  createChat,
  defineChatAction,
  defineChatActions,
} from "@xmux/chat-core";
import { createTelegramAdapter } from "../../src";
import { TelegramActionResponseError } from "../../src/errors";
import { waitForCondition } from "../fixtures/collect";
import { startFakeTelegramApi } from "../fixtures/fake-telegram-api";
import { fakeBotInfo, telegramCallbackQuery, telegramUpdate } from "../fixtures/telegram-builders";

function createTelegramChat(api: Awaited<ReturnType<typeof startFakeTelegramApi>>) {
  const actions = defineChatActions({
    deployment: defineChatAction({ values: { approve: actionValue<{ deploymentId: string }>() } }),
  });

  return createChat({
    adapters: {
      telegram: createTelegramAdapter({
        token: api.token,
        botOptions: { client: { apiRoot: api.url }, botInfo: fakeBotInfo() },
      }),
    },
    commands: {},
    actions,
  });
}

async function startChat(api: Awaited<ReturnType<typeof startFakeTelegramApi>>) {
  const chat = createTelegramChat(api);
  expect((await chat.start()).isOk()).toBe(true);
  await api.waitForMethod("getUpdates");
  return chat;
}

function enqueueAction(api: Awaited<ReturnType<typeof startFakeTelegramApi>>, updateId: number) {
  api.enqueueUpdate(
    telegramUpdate({
      update_id: updateId,
      callback_query: telegramCallbackQuery({
        id: `callback-${updateId}`,
        data: JSON.stringify({
          actionId: "deployment",
          value: "approve",
          payload: { deploymentId: "dep1" },
        }),
      }),
    }),
  );
}

describe("Telegram action response contract", () => {
  test("ack responses call answerCallbackQuery with Telegram alert options", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);
    const results: unknown[] = [];
    chat.on("action", "deployment", async (event) => {
      results.push(await event.ack({ text: "Done", showAlert: true }));
    });

    try {
      enqueueAction(api, 401);

      const request = await api.waitForMethod("answerCallbackQuery");
      await waitForCondition(() => results.length === 1);
      expect(request.body).toMatchObject({ callback_query_id: "callback-401", text: "Done", show_alert: true });
      const result = results[0] as { readonly isOk?: () => boolean };
      expect(result.isOk?.()).toBe(true);
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("reply responses send a formatted Telegram message", async () => {
    const api = await startFakeTelegramApi();
    const chat = await startChat(api);
    chat.on("action", "deployment", async (event) => {
      await event.reply({ text: "**approved**", format: "markdown" }, { adapterOptions: { disable_notification: true } });
    });

    try {
      enqueueAction(api, 402);

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
    chat.on("action", "deployment", async (event) => {
      await event.update({
        message: "Updated",
        buttons: [[{ id: "docs", kind: "url", label: "Docs", url: "https://example.com/docs" }]],
      });
    });

    try {
      enqueueAction(api, 403);

      const request = await api.waitForMethod("editMessageText");
      expect(request.body).toMatchObject({
        chat_id: "12345",
        message_id: 123,
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
    const results: unknown[] = [];
    chat.on("action", "deployment", async (event) => {
      results.push(await event.ack());
    });

    try {
      enqueueAction(api, 404);

      await waitForCondition(() => results.length === 1);
      const result = results[0] as { readonly isErr?: () => boolean; readonly error?: { readonly cause?: unknown } };
      expect(result.isErr?.()).toBe(true);
      if (typeof result.isErr === "function" && result.isErr()) {
        expect(result.error?.cause).toBeInstanceOf(TelegramActionResponseError);
      }
    } finally {
      await chat.close();
      await api.close();
    }
  });
});
