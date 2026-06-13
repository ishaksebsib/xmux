import { describe, expect, test, vi } from "vitest";
import { decodeDiscordMessage } from "../../src/conversions/inbound";
import { kindFromDiscordAttachment } from "../../src/conversions/attachments";

const client = { downloadAttachment: vi.fn() };

describe("Discord inbound conversion", () => {
  test("message object normalizes to ChatAdapterMessageEvent", () => {
    const decoded = decodeDiscordMessage({
      chatId: "discord",
      client,
      botUserId: "bot-user-id",
      message: {
        id: "message-1",
        channelId: "channel-1",
        guildId: "guild-1",
        content: "hello",
        author: { id: "user-1", username: "alice" },
      },
    });

    expect(decoded.status).toBe("event");
    if (decoded.status === "event") {
      expect(decoded.event).toMatchObject({
        type: "message",
        chatId: "discord",
        conversation: { chatId: "discord", conversationId: "channel-1" },
        message: {
          messageId: "message-1",
          text: "hello",
          format: "plain",
          actor: { kind: "user", actorId: "user-1", displayName: "alice" },
        },
      });
    }
  });

  test("self and bot messages are ignored", () => {
    expect(
      decodeDiscordMessage({
        chatId: "discord",
        client,
        botUserId: "bot-user-id",
        message: {
          id: "message-1",
          channelId: "channel-1",
          author: { id: "bot-user-id", bot: false },
        },
      }),
    ).toEqual({ status: "ignored", reason: "self_message" });

    expect(
      decodeDiscordMessage({
        chatId: "discord",
        client,
        message: {
          id: "message-2",
          channelId: "channel-1",
          author: { id: "other-bot", bot: true },
        },
      }),
    ).toEqual({ status: "ignored", reason: "bot_message" });
  });

  test("DM and thread messages use channel id as conversation id", () => {
    const dm = decodeDiscordMessage({
      chatId: "discord",
      client,
      message: { id: "dm-1", channelId: "dm-channel", content: "dm" },
    });
    const thread = decodeDiscordMessage({
      chatId: "discord",
      client,
      message: { id: "thread-1", channelId: "thread-channel", guildId: "guild-1" },
    });

    expect(dm.status === "event" ? dm.event.conversation.conversationId : undefined).toBe(
      "dm-channel",
    );
    expect(thread.status === "event" ? thread.event.conversation.conversationId : undefined).toBe(
      "thread-channel",
    );
  });

  test("attachments normalize by MIME type", () => {
    expect(kindFromDiscordAttachment({ mimeType: "image/png" })).toBe("image");
    expect(kindFromDiscordAttachment({ mimeType: "audio/mpeg" })).toBe("audio");
    expect(kindFromDiscordAttachment({ mimeType: "video/mp4" })).toBe("video");
    expect(kindFromDiscordAttachment({ filename: "logs.zip" })).toBe("archive");
    expect(kindFromDiscordAttachment({ mimeType: "application/pdf" })).toBe("document");
    expect(kindFromDiscordAttachment({})).toBe("other");
  });

  test("malformed partial messages are ignored", () => {
    expect(decodeDiscordMessage({ chatId: "discord", client, message: {} })).toEqual({
      status: "ignored",
      reason: "malformed_message",
    });
  });
});
