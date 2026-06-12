import { describe, expect, test } from "vitest";
import { TelegramSendActionError } from "../../src/errors";
import {
  decodeTelegramActionCallbackData,
  encodeTelegramSendAction,
} from "../../src/conversions/actions";

describe("Telegram action conversions", () => {
  test("encodes callback and URL buttons as Telegram inline keyboard markup", () => {
    const encoded = encodeTelegramSendAction({
      chatId: "telegram",
      conversationId: "12345",
      text: "Deploy?",
      buttons: [
        [
          {
            id: "approve",
            label: "Approve",
            actionId: "d",
            value: "a",
            payload: { id: "1" },
          },
          { id: "logs", kind: "url", label: "Logs", url: "https://example.com/logs" },
        ],
      ],
      adapterOptions: {},
    });

    expect(encoded.options.reply_markup).toEqual({
      inline_keyboard: [
        [
          {
            text: "Approve",
            callback_data: '{"actionId":"d","value":"a","payload":{"id":"1"}}',
          },
          { text: "Logs", url: "https://example.com/logs" },
        ],
      ],
    });
  });

  test("rejects oversized callback payloads before sending", () => {
    expect(() =>
      encodeTelegramSendAction({
        chatId: "telegram",
        conversationId: "12345",
        text: "Too large",
        buttons: [
          [
            {
              id: "large",
              label: "Large",
              actionId: "deployment",
              value: "approve",
              payload: { value: "x".repeat(80) },
            },
          ],
        ],
        adapterOptions: {},
      }),
    ).toThrow(TelegramSendActionError);
  });

  test("decodes only supported callback data shapes", () => {
    expect(decodeTelegramActionCallbackData('{"actionId":"deployment","value":"approve"}')).toEqual(
      {
        actionId: "deployment",
        value: "approve",
      },
    );
    expect(decodeTelegramActionCallbackData("not json")).toBeUndefined();
    expect(decodeTelegramActionCallbackData('{"actionId":1,"value":"approve"}')).toBeUndefined();
  });
});
