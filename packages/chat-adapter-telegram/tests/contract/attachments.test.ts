import { describe, expect, test } from "vitest";
import { createChat, type ChatMessageEvent } from "@xmux/chat-core";
import { createTelegramAdapter, type TelegramAdapterData } from "../../src";
import { TelegramAttachmentReadError } from "../../src/errors";
import { waitForCondition } from "../fixtures/collect";
import { startFakeTelegramApi } from "../fixtures/fake-telegram-api";
import {
  fakeBotInfo,
  telegramDocumentMessage,
  telegramFile,
  telegramUpdate,
} from "../fixtures/telegram-builders";

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

describe("Telegram attachments contract", () => {
  test("document attachments are lazy and download through fake Telegram file API", async () => {
    const api = await startFakeTelegramApi();
    api.setMethodResult("getFile", telegramFile({ file_path: "documents/report.pdf", file_size: 3 }));
    api.setFile("documents/report.pdf", new Uint8Array([1, 2, 3]), {
      contentType: "application/pdf",
    });
    const chat = createTelegramChat(api);
    const messages: Array<ChatMessageEvent<"telegram", TelegramAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 201,
          message: telegramDocumentMessage({
            document: {
              file_id: "doc-file-id",
              file_unique_id: "doc-file-unique-id",
              file_name: "report.pdf",
              mime_type: "application/pdf",
              file_size: 3,
            },
          }),
        }),
      );

      await waitForCondition(() => messages.length === 1);
      const attachment = messages[0]?.message.attachments[0];
      expect(attachment).toMatchObject({
        attachmentId: "doc-file-unique-id",
        kind: "document",
        disposition: "attachment",
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
      });
      expect(api.requests.some((request) => request.telegramMethod === "getFile")).toBe(false);

      const opened = await attachment?.open();
      expect(opened?.isOk()).toBe(true);
      const getFile = await api.waitForMethod("getFile");
      expect(getFile.body).toMatchObject({ file_id: "doc-file-id" });
      expect(api.requests.some((request) => request.pathname === `/file/bot${api.token}/documents/report.pdf`)).toBe(
        true,
      );
      if (opened?.isOk()) {
        expect(opened.value.filename).toBe("report.pdf");
        expect(opened.value.mimeType).toBe("application/pdf");
        expect(new Uint8Array(await new Response(opened.value.chunks).arrayBuffer())).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      }
    } finally {
      await chat.close();
      await api.close();
    }
  });

  test("known oversized Telegram files reject before getFile", async () => {
    const api = await startFakeTelegramApi();
    const chat = createTelegramChat(api);
    const messages: Array<ChatMessageEvent<"telegram", TelegramAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await api.waitForMethod("getUpdates");
      api.enqueueUpdate(
        telegramUpdate({
          update_id: 202,
          message: telegramDocumentMessage({
            document: {
              file_id: "big-file-id",
              file_unique_id: "big-file-unique-id",
              file_name: "big.pdf",
              mime_type: "application/pdf",
              file_size: 5_000,
            },
          }),
        }),
      );

      await waitForCondition(() => messages.length === 1);
      const opened = await messages[0]?.message.attachments[0]?.open({ maxBytes: 100 });
      expect(opened?.isErr()).toBe(true);
      if (opened?.isErr()) {
        expect(opened.error).toBeInstanceOf(TelegramAttachmentReadError);
      }
      expect(api.requests.some((request) => request.telegramMethod === "getFile")).toBe(false);
    } finally {
      await chat.close();
      await api.close();
    }
  });
});
