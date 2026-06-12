import { describe, expect, test } from "vitest";
import {
  renderTelegramMarkdownFinal,
  renderTelegramMarkdownPreview,
  validateTelegramEntities,
} from "../../src/conversions/markdown-entities";
import { splitTelegramRenderedText } from "../../src/conversions/telegram-segments";

describe("Telegram markdown entity conversions", () => {
  test("previews heal incomplete markdown without leaking raw markers", () => {
    const rendered = renderTelegramMarkdownPreview("**hello");

    expect(rendered.text).toBe("hello");
    expect(rendered.text).not.toContain("**");
    expect(validateTelegramEntities(rendered).isOk()).toBe(true);
  });

  test("final markdown renders plain text with valid Telegram entities", () => {
    const rendered = renderTelegramMarkdownFinal("**hello** `code`");

    expect(rendered.text).toBe("hello code");
    expect(rendered.entities.map((entity) => entity.type)).toEqual(["bold", "code"]);
    expect(validateTelegramEntities(rendered).isOk()).toBe(true);
  });

  test("segment splitting keeps segment-local offsets and avoids surrogate splits", () => {
    const text = `${"a".repeat(4095)}😀`;
    const segments = splitTelegramRenderedText({
      text,
      entities: [{ type: "bold", offset: 0, length: text.length }],
    });
    expect(segments).toHaveLength(2);
    const first = segments[0]!;
    const second = segments[1]!;

    expect(first.text.endsWith("\ud83d")).toBe(false);
    expect(second.text.startsWith("\ude00")).toBe(false);
    expect(first.entities[0]).toMatchObject({ offset: 0, length: first.text.length });
    expect(second.entities[0]).toMatchObject({ offset: 0, length: second.text.length });
  });
});
