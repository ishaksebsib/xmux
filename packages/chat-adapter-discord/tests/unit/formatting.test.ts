import { describe, expect, test } from "vitest";
import { DiscordFormattingError } from "../../src/errors";
import { formatDiscordText } from "../../src/conversions/formatting";

describe("Discord formatting", () => {
  test("plain text escapes Discord markdown", () => {
    const result = formatDiscordText({ text: "**hello** from hello_world" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("\\*\\*hello\\*\\* from hello\\_world");
    }
  });

  test("markdown text passes through", () => {
    const result = formatDiscordText({ text: "**hello**", format: "markdown" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("**hello**");
    }
  });

  test("does not convert accidental mentions", () => {
    const result = formatDiscordText({ text: "hello @everyone and @user", format: "markdown" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("hello @everyone and @user");
    }
  });

  test("html formatting returns a typed failure", () => {
    const result = formatDiscordText({ text: "<b>hello</b>", format: "html" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(DiscordFormattingError);
      expect(result.error.format).toBe("html");
    }
  });
});
