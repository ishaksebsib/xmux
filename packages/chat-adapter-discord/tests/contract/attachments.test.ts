import { createChat, type ChatMessageEvent } from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createDiscordAdapter, type DiscordAdapterData } from "../../src";
import type { CreateDiscordBotClient } from "../../src/client";
import { DiscordAttachmentReadError } from "../../src/errors";
import {
  createFakeDiscordClient,
  type FakeDiscordBotClient,
} from "../fixtures/fake-discord-client";
import { waitForCondition } from "../fixtures/collect";

describe("Discord attachments contract", () => {
  test("attachment.open downloads only when called", async () => {
    const fake = createFakeDiscordClient({
      attachmentResponses: {
        "https://cdn.example/report.pdf": new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf", "content-length": "3" },
        }),
      },
    });
    const chat = createDiscordChat(fake);
    const messages: Array<ChatMessageEvent<"discord", DiscordAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessageWithAttachment({ size: 3 }));

      await waitForCondition(() => messages.length === 1);
      const attachment = messages[0]?.message.attachments[0];
      expect(attachment).toMatchObject({ attachmentId: "attachment-1", sizeBytes: 3 });
      expect(fake.downloadedAttachments).toHaveLength(0);

      const opened = await attachment?.open();
      expect(opened?.isOk()).toBe(true);
      expect(fake.downloadedAttachments).toHaveLength(1);
      if (opened?.isOk()) {
        expect(opened.value.filename).toBe("report.pdf");
        expect(opened.value.mimeType).toBe("application/pdf");
        expect(new Uint8Array(await new Response(opened.value.chunks).arrayBuffer())).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      }
    } finally {
      await chat.close();
    }
  });

  test("maxBytes rejects before network when size is known", async () => {
    const fake = createFakeDiscordClient();
    const chat = createDiscordChat(fake);
    const messages: Array<ChatMessageEvent<"discord", DiscordAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessageWithAttachment({ size: 5_000 }));

      await waitForCondition(() => messages.length === 1);
      const opened = await messages[0]?.message.attachments[0]?.open({ maxBytes: 100 });
      expect(opened?.isErr()).toBe(true);
      if (opened?.isErr()) expect(opened.error).toBeInstanceOf(DiscordAttachmentReadError);
      expect(fake.downloadedAttachments).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("stream over maxBytes rejects while reading when size is unknown", async () => {
    const fake = createFakeDiscordClient({
      attachmentResponses: {
        "https://cdn.example/report.pdf": new Response(new Uint8Array([1, 2, 3])),
      },
    });
    const chat = createDiscordChat(fake);
    const messages: Array<ChatMessageEvent<"discord", DiscordAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessageWithAttachment({ size: undefined, contentType: undefined }));

      await waitForCondition(() => messages.length === 1);
      const opened = await messages[0]?.message.attachments[0]?.open({ maxBytes: 2 });
      expect(opened?.isOk()).toBe(true);
      if (opened?.isOk()) {
        await expect(new Response(opened.value.chunks).arrayBuffer()).rejects.toBeInstanceOf(
          DiscordAttachmentReadError,
        );
      }
    } finally {
      await chat.close();
    }
  });

  test("response headers fill missing attachment metadata", async () => {
    const fake = createFakeDiscordClient({
      attachmentResponses: {
        "https://cdn.example/report.pdf": new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf", "content-length": "3" },
        }),
      },
    });
    const chat = createDiscordChat(fake);
    const messages: Array<ChatMessageEvent<"discord", DiscordAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessageWithAttachment({ size: undefined, contentType: undefined }));

      await waitForCondition(() => messages.length === 1);
      const opened = await messages[0]?.message.attachments[0]?.open();
      expect(opened?.isOk()).toBe(true);
      if (opened?.isOk()) {
        expect(opened.value.mimeType).toBe("application/pdf");
        expect(opened.value.sizeBytes).toBe(3);
      }
    } finally {
      await chat.close();
    }
  });

  test("content-length over limit rejects after response", async () => {
    const fake = createFakeDiscordClient({
      attachmentResponses: {
        "https://cdn.example/report.pdf": new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-length": "5000" },
        }),
      },
    });
    const chat = createDiscordChat(fake);
    const messages: Array<ChatMessageEvent<"discord", DiscordAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessageWithAttachment({ size: undefined }));

      await waitForCondition(() => messages.length === 1);
      const opened = await messages[0]?.message.attachments[0]?.open({ maxBytes: 100 });
      expect(opened?.isErr()).toBe(true);
      expect(fake.downloadedAttachments).toHaveLength(1);
    } finally {
      await chat.close();
    }
  });

  test("non-OK response maps to DiscordAttachmentReadError", async () => {
    const fake = createFakeDiscordClient({
      attachmentResponses: {
        "https://cdn.example/report.pdf": new Response("missing", { status: 404 }),
      },
    });
    const chat = createDiscordChat(fake);
    const messages: Array<ChatMessageEvent<"discord", DiscordAdapterData>> = [];
    chat.on("message", (event) => {
      messages.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      fake.emitMessage(discordMessageWithAttachment({ size: undefined }));

      await waitForCondition(() => messages.length === 1);
      const opened = await messages[0]?.message.attachments[0]?.open();
      expect(opened?.isErr()).toBe(true);
      if (opened?.isErr()) expect(opened.error).toBeInstanceOf(DiscordAttachmentReadError);
    } finally {
      await chat.close();
    }
  });
});

function createDiscordChat(fake: FakeDiscordBotClient) {
  return createChat({
    adapters: {
      discord: createDiscordAdapter({
        token: "token",
        applicationId: "application",
        mode: { type: "gateway", observeMessages: true },
        createClient: (() => fake) satisfies CreateDiscordBotClient,
      }),
    },
    commands: {},
  });
}

function discordMessageWithAttachment(args: {
  readonly size?: number;
  readonly contentType?: string;
}) {
  return {
    id: "message-1",
    channelId: "channel-1",
    guildId: "guild-1",
    content: "file",
    author: { id: "user-1", username: "user", bot: false },
    attachments: [
      {
        id: "attachment-1",
        url: "https://cdn.example/report.pdf",
        name: "report.pdf",
        contentType: "contentType" in args ? args.contentType : "application/pdf",
        size: args.size,
      },
    ],
  };
}
