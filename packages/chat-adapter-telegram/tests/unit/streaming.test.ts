import { describe, expect, test } from "vitest";
import type { ChatTextStreamChunk } from "@xmux/chat-core";
import {
  encodeTelegramStreamMessage,
  shouldUseTelegramRichStream,
} from "../../src/conversions/streaming";
import {
  splitTelegramRichText,
  TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT,
} from "../../src/handlers/rich-stream";
import { collectAsync } from "../fixtures/collect";

function chunks(items: readonly ChatTextStreamChunk[]): AsyncIterable<ChatTextStreamChunk> {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

describe("Telegram stream conversions", () => {
  test("uses Telegram rich markdown streams when no legacy parse options are requested", async () => {
    const request = encodeTelegramStreamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: {
        format: "markdown",
        chunks: chunks([
          { type: "delta", delta: "**hello" },
          { type: "snapshot", text: "**hello**" },
          { type: "completed", text: "**hello** world" },
        ]),
      },
      adapterOptions: { message_thread_id: 9 },
    });

    expect(request.kind).toBe("rich");
    if (request.kind !== "rich") throw new Error("expected rich stream request");
    expect(request.format).toBe("markdown");
    expect(request.chatId).toBe(12345);
    expect(request.draftId).toBeGreaterThan(0);
    expect(request.draftOptions).toEqual({ message_thread_id: 9 });
    expect(request.messageOptions).toEqual({ message_thread_id: 9 });
    await expect(collectAsync(request.stream)).resolves.toEqual(["**hello", "**", " world"]);
  });

  test("uses Telegram rich HTML streams", async () => {
    const request = encodeTelegramStreamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: {
        format: "html",
        chunks: chunks([{ type: "delta", delta: "<b>hello</b>" }]),
      },
      adapterOptions: {},
    });

    expect(request.kind).toBe("rich");
    if (request.kind !== "rich") throw new Error("expected rich stream request");
    expect(request.format).toBe("html");
    await expect(collectAsync(request.stream)).resolves.toEqual(["<b>hello</b>"]);
  });

  test("keeps the legacy text stream when explicit text entity parsing is requested", () => {
    expect(
      shouldUseTelegramRichStream({
        format: "markdown",
        adapterOptions: { parse_mode: "MarkdownV2" },
      }),
    ).toBe(false);

    const request = encodeTelegramStreamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: {
        format: "markdown",
        chunks: chunks([{ type: "delta", delta: "**hello**" }]),
      },
      adapterOptions: { parse_mode: "MarkdownV2" },
    });

    expect(request.kind).toBe("plain");
    if (request.kind !== "plain") throw new Error("expected plain stream request");
    expect(request.draftOptions).toEqual({ parse_mode: "MarkdownV2" });
    expect(request.messageOptions).toMatchObject({ parse_mode: "MarkdownV2" });
  });
});

describe("Telegram rich stream segmentation", () => {
  test("keeps rich text below the limit in one segment", () => {
    expect(splitTelegramRichText("hello")).toEqual(["hello"]);
  });

  test("splits rich text above the limit into bounded segments", () => {
    const text = "a".repeat(TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT + 1);
    const segments = splitTelegramRichText(text);

    expect(segments).toHaveLength(2);
    expect(segments.join("")).toBe(text);
    expect(
      segments.every(
        (segment) => Array.from(segment).length <= TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT,
      ),
    ).toBe(true);
  });

  test("does not split surrogate pairs", () => {
    const emoji = "🙂";
    const text = `${"a".repeat(TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT - 1)}${emoji}tail`;
    const segments = splitTelegramRichText(text);

    expect(segments.join("")).toBe(text);
    expect(segments[0]?.endsWith(emoji)).toBe(true);
  });

  test("prefers paragraph, newline, and space boundaries", () => {
    const paragraphText = `${"a".repeat(100)}\n\n${"b".repeat(TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT)}`;
    expect(splitTelegramRichText(paragraphText)[0]).toBe(`${"a".repeat(100)}\n\n`);

    const spaceText = `${"a".repeat(100)} ${"b".repeat(TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT)}`;
    expect(splitTelegramRichText(spaceText)[0]).toBe(`${"a".repeat(100)} `);
  });
});
