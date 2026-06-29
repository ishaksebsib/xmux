import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { createXmux } from "../src";

const capabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: false,
    markdown: false,
    attachments: { receive: false, send: false, download: false },
  },
} as const;

describe("xmux status", () => {
  test("composes chat and harness snapshots without opening adapters", () => {
    const opened: string[] = [];
    const xmux = createXmux({
      harnesses: {
        pi: defineHarnessAdapter({
          id: "pi",
          async open() {
            opened.push("harness");
            return Result.err(new Error("should not open"));
          },
        }),
      },
      chats: {
        telegram: defineChatAdapter<
          "telegram",
          Record<never, never>,
          Record<never, never>,
          typeof capabilities
        >({
          id: "telegram",
          capabilities,
          async open() {
            opened.push("chat");
            return Result.err(new Error("should not open"));
          },
        }),
      },
      config: {
        defaultWorkingDirectory: process.cwd(),
        deliveryMode: "requester_only",
      },
    });

    expect(xmux.status()).toEqual({
      chats: {
        lifecycle: "created",
        adapters: [{ id: "telegram", state: "configured" }],
      },
      harnesses: {
        adapters: [{ id: "pi", state: "configured_lazy" }],
      },
    });
    expect(opened).toEqual([]);
  });
});
