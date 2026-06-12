import { describe, expect, test } from "vitest";
import { toPromptParts } from "../../src/prompt/content";

describe("OpenCode prompt content mapping", () => {
  test("drops empty text and preserves non-empty text order", () => {
    expect(
      toPromptParts([
        { type: "text", text: "" },
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]),
    ).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]);
  });

  test("maps images to OpenCode data-url file parts", () => {
    expect(toPromptParts([{ type: "image", data: "aW1n", mimeType: "image/png", name: "img.png" }])).toEqual([
      { type: "file", mime: "image/png", filename: "img.png", url: "data:image/png;base64,aW1n" },
    ]);
  });

  test.each([
    ["file:///tmp/readme.md", "text/markdown", "text/plain"],
    ["file:///tmp/image.png", "image/png", "image/png"],
    ["file:///tmp/doc.pdf", "application/pdf", "application/pdf"],
    ["https://example.com/readme.md", "text/markdown", "text/markdown"],
  ])("normalizes file mime %s %s", (uri, mime, expectedMime) => {
    expect(toPromptParts([{ type: "file", uri, mime, name: "file" }])).toEqual([
      { type: "file", mime: expectedMime, filename: "file", url: uri },
    ]);
  });
});
