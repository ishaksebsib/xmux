import { describe, expect, test, vi } from "vitest";
import { updateAction } from "../src/handlers/update-action";
import type { SlackBotClient } from "../src/client";

function client(input: { readonly updateMessage: SlackBotClient["updateMessage"] }) {
  return {
    updateMessage: input.updateMessage,
  } as SlackBotClient;
}

describe("slack updateAction", () => {
  test("updates the existing message with updated blocks", async () => {
    const updateMessage = vi.fn(async (input) => ({
      channelId: input.channel,
      messageTs: input.ts,
      raw: {},
    }));

    const updated = await updateAction({
      chatId: "slack",
      client: client({ updateMessage }),
      config: {},
      input: {
        chatId: "slack",
        conversationId: "C123",
        message: { chatId: "slack", conversationId: "C123", messageId: "1710000000.000100" },
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
    expect(updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        ts: "1710000000.000100",
        text: "Transcription ready",
        blocks: [
          expect.objectContaining({ type: "section" }),
          expect.objectContaining({
            type: "actions",
            elements: [
              expect.objectContaining({
                type: "button",
                text: expect.objectContaining({ type: "plain_text", text: "Send" }),
              }),
            ],
          }),
        ],
      }),
    );
  });
});
