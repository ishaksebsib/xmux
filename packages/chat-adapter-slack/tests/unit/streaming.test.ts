import { describe, expect, test } from "vitest";
import {
  appendSlackNativeStreamChunk,
  encodeSlackNativeStreamText,
  resolveSlackNativeStreamConfig,
  splitSlackNativeStreamText,
} from "../../src/conversions/streaming";

const streamConfig = { stream: { bufferSize: 256, maxSegmentChars: 12_000, emptyText: "" } };

describe("Slack native streaming conversion", () => {
  test("applies append-only chunks", () => {
    const delta = appendSlackNativeStreamChunk({
      currentText: "hello",
      chunk: { type: "delta", delta: " world" },
    });
    const snapshot = appendSlackNativeStreamChunk({
      currentText: "hello",
      chunk: { type: "snapshot", text: "hello world" },
    });
    const completed = appendSlackNativeStreamChunk({
      currentText: "hello",
      chunk: { type: "completed", text: "hello world!" },
    });

    expect(delta.isOk()).toBe(true);
    expect(snapshot.isOk()).toBe(true);
    expect(completed.isOk()).toBe(true);
    if (delta.isOk()) expect(delta.value).toEqual({ text: "hello world", delta: " world" });
    if (snapshot.isOk()) expect(snapshot.value).toEqual({ text: "hello world", delta: " world" });
    if (completed.isOk())
      expect(completed.value).toEqual({ text: "hello world!", delta: " world!" });
  });

  test("rejects non-prefix snapshots because Slack native streams are append-only", () => {
    const result = appendSlackNativeStreamChunk({
      currentText: "hello world",
      chunk: { type: "snapshot", text: "reset" },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain("append-only");
  });

  test("formats native stream text for Slack markdown_text", () => {
    const markdown = encodeSlackNativeStreamText({ text: "hello **slack**", format: "markdown" });
    const plain = encodeSlackNativeStreamText({ text: "**hi** <@U123> & `code`", format: "plain" });
    const html = encodeSlackNativeStreamText({
      text: "<p>**hi** &lt;@U123&gt;</p>",
      format: "html",
    });

    expect(markdown.isOk()).toBe(true);
    expect(plain.isOk()).toBe(true);
    expect(html.isOk()).toBe(true);
    if (markdown.isOk()) expect(markdown.value).toBe("hello **slack**");
    if (plain.isOk()) expect(plain.value).toBe("\\*\\*hi\\*\\* &lt;@U123&gt; &amp; \\`code\\`");
    if (html.isOk()) expect(html.value).toBe("\\*\\*hi\\*\\* &lt;@U123&gt;");
  });

  test("splits stream text on preferred boundaries and avoids surrogate splits", () => {
    expect(splitSlackNativeStreamText("hello world", 8)).toEqual(["hello ", "world"]);
    expect(splitSlackNativeStreamText("a😀b", 2)).toEqual(["a", "😀", "b"]);
    expect(splitSlackNativeStreamText("😀", 1)).toEqual(["😀"]);
  });

  test("rejects unsupported native stream adapter options", () => {
    const ephemeral = resolveSlackNativeStreamConfig({
      config: streamConfig,
      adapterOptions: { ephemeral: true },
    });
    const unfurls = resolveSlackNativeStreamConfig({
      config: streamConfig,
      adapterOptions: { unfurl_links: false },
    });
    const oversized = resolveSlackNativeStreamConfig({
      config: streamConfig,
      adapterOptions: { stream: { bufferSize: 12_001 } },
    });

    expect(ephemeral.isErr()).toBe(true);
    expect(unfurls.isErr()).toBe(true);
    expect(oversized.isErr()).toBe(true);
  });
});
