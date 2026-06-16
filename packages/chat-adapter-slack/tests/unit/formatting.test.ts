import { describe, expect, test } from "vitest";
import {
  convertMarkdownToSlackMrkdwn,
  escapeSlackText,
  formatSlackText,
  stripSlackHtml,
} from "../../src/conversions/formatting";

describe("Slack formatting", () => {
  test("escapes Slack entities for plain text", () => {
    expect(escapeSlackText("a & <@U123> > <!here>")).toBe(
      "a &amp; &lt;@U123&gt; &gt; &lt;!here&gt;",
    );
  });

  test("plain text disables mrkdwn", () => {
    const result = formatSlackText({ text: "**hi** <@U123>", format: "plain" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ text: "**hi** &lt;@U123&gt;", mrkdwn: false });
    }
  });

  test("markdown keeps native markdown and builds a conservative mrkdwn fallback", () => {
    expect(convertMarkdownToSlackMrkdwn("**hi** [site](https://example.com?a=1&b=2)")).toBe(
      "*hi* <https://example.com?a=1&amp;b=2|site>",
    );

    const result = formatSlackText({
      text: "**hi** [site](https://example.com?a=1&b=2)",
      format: "markdown",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        text: "*hi* <https://example.com?a=1&amp;b=2|site>",
        markdown_text: "**hi** [site](https://example.com?a=1&b=2)",
        mrkdwn: true,
      });
    }
  });

  test("markdown fallback still escapes raw Slack mention syntax", () => {
    const result = formatSlackText({ text: "hello <@U123> and <!here>", format: "markdown" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.text).toBe("hello &lt;@U123&gt; and &lt;!here&gt;");
      expect(result.value.markdown_text).toBe("hello <@U123> and <!here>");
      expect(result.value.mrkdwn).toBe(true);
    }
  });

  test("html is stripped and escaped safely", () => {
    expect(stripSlackHtml("<p>Hello <strong>&lt;team&gt;</strong></p><br><script>x</script>")).toBe(
      "Hello &lt;team&gt;\nx",
    );
  });
});
