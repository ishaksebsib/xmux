import { describe, expect, test } from "vitest";
import { createChat, type ChatTextStreamChunk } from "@xmux/chat-core";
import { createTelegramAdapter } from "../../src";
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

function textChunks(chunks: readonly string[]): AsyncIterable<ChatTextStreamChunk> {
  return (async function* () {
    for (const delta of chunks) {
      const chunk: ChatTextStreamChunk = { type: "delta", delta };
      yield chunk;
    }
  })();
}

describe("Telegram stream contract", () => {
  test("chat.streamMessage uses Telegram rich markdown streaming", async () => {
    const api = await startFakeTelegramApi();
    const chat = createTelegramChat(api);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");

      const streamed = await chat.streamMessage({
        chatId: "telegram",
        conversationId: "12345",
        content: { chunks: textChunks(["**hello", "** world"]), format: "markdown" },
        adapterOptions: { message_thread_id: 9 },
      });

      expect(streamed.isOk()).toBe(true);
      const draft = await api.waitForMethod("sendRichMessageDraft");
      expect(draft.body).toMatchObject({
        chat_id: 12345,
        message_thread_id: 9,
        rich_message: { markdown: expect.stringContaining("**hello") },
      });
      const final = await api.waitForMethod("sendRichMessage");
      expect(final.body).toMatchObject({
        chat_id: 12345,
        message_thread_id: 9,
        rich_message: { markdown: "**hello** world" },
      });
      expect(final.body).not.toMatchObject({ parse_mode: expect.anything() });
      if (streamed.isOk()) {
        expect(streamed.value).toMatchObject({
          chatId: "telegram",
          conversationId: "12345",
          messageId: "100",
          text: "**hello** world",
          format: "markdown",
          adapterData: { telegramChatId: "12345", telegramMessageId: 100 },
        });
      }
    } finally {
      await chat.close();
      await api.close();
    }
  });
});
