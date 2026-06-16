import { describe, expect, test } from "vitest";
import { decodeSlackMessageEvent } from "../../src/conversions/inbound";
import { SlackAttachmentReadError } from "../../src/errors";
import { createFakeSlackClient } from "../fixtures/fake-slack-client";

describe("Slack inbound message conversion", () => {
  test("decodes a user message with thread metadata", () => {
    const fake = createFakeSlackClient();
    const decoded = decodeSlackMessageEvent({
      chatId: "slack",
      client: fake,
      botIdentity: { botUserId: "U_BOT", botId: "B_BOT", raw: {} },
      event: slackMessage({ text: "hello &amp; <@U999|riley>", thread_ts: "100.000000" }),
    });

    expect(decoded.status).toBe("event");
    if (decoded.status === "event") {
      expect(decoded.event.message).toMatchObject({
        chatId: "slack",
        conversationId: "C123",
        messageId: "171.000100",
        text: "hello & @riley",
        actor: { kind: "user", actorId: "U123", displayName: "riley" },
        adapterData: {
          slackTeamId: "T123",
          slackChannelId: "C123",
          slackMessageTs: "171.000100",
          slackThreadTs: "100.000000",
          slackUserId: "U123",
        },
      });
    }
  });

  test("ignores self, bot, changed, and system subtype messages", () => {
    const fake = createFakeSlackClient();
    const botIdentity = { botUserId: "U_BOT", botId: "B_BOT", raw: {} };

    expect(
      decodeSlackMessageEvent({
        chatId: "slack",
        client: fake,
        botIdentity,
        event: slackMessage({ user: "U_BOT" }),
      }),
    ).toEqual({ status: "ignored", reason: "self_message" });

    expect(
      decodeSlackMessageEvent({
        chatId: "slack",
        client: fake,
        botIdentity,
        event: slackMessage({ user: undefined, bot_id: "B_OTHER" }),
      }),
    ).toEqual({ status: "ignored", reason: "bot_message" });

    expect(
      decodeSlackMessageEvent({
        chatId: "slack",
        client: fake,
        botIdentity,
        event: slackMessage({ subtype: "message_changed" }),
      }),
    ).toEqual({ status: "ignored", reason: "message_changed" });

    expect(
      decodeSlackMessageEvent({
        chatId: "slack",
        client: fake,
        botIdentity,
        event: slackMessage({ subtype: "channel_join" }),
      }),
    ).toEqual({ status: "ignored", reason: "ignored_subtype" });
  });

  test("attachment open detects max bytes and Slack HTML auth failures", async () => {
    const fake = createFakeSlackClient({
      downloadFile: async () =>
        new Response("<html>login</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const decoded = decodeSlackMessageEvent({
      chatId: "slack",
      client: fake,
      event: slackMessage({
        files: [
          {
            id: "F123",
            name: "report.pdf",
            mimetype: "application/pdf",
            size: 10,
            url_private_download: "https://files.slack.test/F123",
          },
        ],
      }),
    });

    expect(decoded.status).toBe("event");
    if (decoded.status !== "event") return;

    const tooLarge = await decoded.event.message.attachments[0]?.open({ maxBytes: 5 });
    expect(tooLarge?.isErr()).toBe(true);
    if (tooLarge?.isErr()) {
      expect(tooLarge.error).toBeInstanceOf(SlackAttachmentReadError);
      if (tooLarge.error instanceof SlackAttachmentReadError) {
        expect(tooLarge.error.reason).toBe("too_large");
      }
    }

    const html = await decoded.event.message.attachments[0]?.open();
    expect(html?.isErr()).toBe(true);
    if (html?.isErr()) {
      expect(html.error).toBeInstanceOf(SlackAttachmentReadError);
      if (html.error instanceof SlackAttachmentReadError) {
        expect(html.error.reason).toBe("invalid_response");
      }
      expect(html.error.message).toContain("files:read");
    }
  });
});

function slackMessage(
  overrides: Partial<{
    readonly type: string;
    readonly subtype: string;
    readonly channel: string;
    readonly ts: string;
    readonly thread_ts: string;
    readonly text: string;
    readonly user: string;
    readonly username: string;
    readonly bot_id: string;
    readonly team_id: string;
    readonly files: readonly {
      readonly id?: string;
      readonly mimetype?: string;
      readonly url_private?: string;
      readonly url_private_download?: string;
      readonly name?: string;
      readonly size?: number;
    }[];
  }> = {},
) {
  return {
    type: "message",
    channel: "C123",
    ts: "171.000100",
    text: "hello",
    user: "U123",
    username: "riley",
    team_id: "T123",
    ...overrides,
  } as never;
}
