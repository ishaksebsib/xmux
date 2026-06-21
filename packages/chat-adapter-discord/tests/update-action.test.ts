import { describe, expect, test, vi } from "vitest";
import { updateAction } from "../src/handlers/update-action";
import type { DiscordBotClient } from "../src/client";

function client(input: { readonly editMessage: DiscordBotClient["editMessage"] }) {
  return {
    editMessage: input.editMessage,
  } as DiscordBotClient;
}

describe("discord updateAction", () => {
  test("edits the existing message with updated components", async () => {
    const editMessage = vi.fn(async (input) => ({
      channelId: input.channelId,
      messageId: input.messageId,
      raw: {},
    }));

    const updated = await updateAction({
      chatId: "discord",
      client: client({ editMessage }),
      defaults: { allowedMentions: { parse: [] } },
      input: {
        chatId: "discord",
        conversationId: "channel-1",
        message: { chatId: "discord", conversationId: "channel-1", messageId: "message-1" },
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
    expect(editMessage).toHaveBeenCalledWith({
      channelId: "channel-1",
      messageId: "message-1",
      payload: expect.objectContaining({
        content: "Transcription ready",
        components: [
          expect.objectContaining({
            components: [
              expect.objectContaining({
                label: "Send",
                custom_id: expect.stringContaining("xmux:a:"),
              }),
            ],
          }),
        ],
      }),
      signal: undefined,
    });
  });
});
