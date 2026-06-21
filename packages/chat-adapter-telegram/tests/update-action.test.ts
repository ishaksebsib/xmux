import { describe, expect, test, vi } from "vitest";
import { Result } from "better-result";
import { updateAction } from "../src/handlers/update-action";
import type { TelegramBotClient } from "../src/client";

function botClient(input: { readonly editMessageText: TelegramBotClient["editMessageText"] }) {
  return {
    editMessageText: input.editMessageText,
  } as TelegramBotClient;
}

describe("telegram updateAction", () => {
  test("edits the existing message with a new inline keyboard", async () => {
    const editMessageText = vi.fn(async (): Promise<true> => true);

    const updated = await updateAction({
      chatId: "telegram",
      bot: botClient({ editMessageText }),
      input: {
        chatId: "telegram",
        conversationId: "12345",
        message: { chatId: "telegram", conversationId: "12345", messageId: "678" },
        text: "Transcription ready",
        format: "markdown",
        buttons: [
          [
            {
              id: "send",
              label: "Send",
              actionId: "stt",
              value: "send",
              payload: "run-1",
            },
          ],
        ],
        adapterOptions: {},
      },
    });

    expect(updated.isOk()).toBe(true);
    expect(editMessageText).toHaveBeenCalledWith({
      chatId: "12345",
      messageId: 678,
      text: "Transcription ready",
      options: expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [
              expect.objectContaining({
                text: "Send",
                callback_data: expect.stringContaining('"actionId":"stt"'),
              }),
            ],
          ],
        },
      }),
      signal: undefined,
    });
  });
});
