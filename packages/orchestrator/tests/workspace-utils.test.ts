import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createXmux } from "../src";
import { InvalidDirectoryError } from "../src/filesystem";
import { getCurrentWorkspaceCwd, resolveDirectoryForThread } from "../src/features/workspace";
import { createThreadWorkspace } from "../src/store";

const thread = { chatId: "telegram", threadId: "thread-1" } as const;

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

describe("workspace utilities", () => {
  test("returns default cwd when no workspace exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-workspace-"));

    try {
      const xmux = createTestXmux({ defaultWorkingDirectory: root });
      const cwd = await getCurrentWorkspaceCwd({ ctx: xmux.ctx, thread });

      expect(cwd.unwrap("expected cwd lookup to succeed")).toBe(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("returns stored cwd when a thread workspace exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-workspace-"));
    const child = join(root, "packages", "orchestrator");

    try {
      await mkdir(child, { recursive: true });
      const xmux = createTestXmux({ defaultWorkingDirectory: root });
      await xmux.ctx.store.workspaces.set(
        createThreadWorkspace({ thread, cwd: child, now: "2026-05-08T10:00:00.000Z" }),
      );

      const cwd = await getCurrentWorkspaceCwd({ ctx: xmux.ctx, thread });

      expect(cwd.unwrap("expected cwd lookup to succeed")).toBe(child);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("resolves relative directories from the current thread cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-workspace-"));
    const child = join(root, "packages", "orchestrator");

    try {
      await mkdir(child, { recursive: true });
      const xmux = createTestXmux({ defaultWorkingDirectory: root });
      const resolved = await resolveDirectoryForThread({
        ctx: xmux.ctx,
        thread,
        path: "packages/orchestrator",
      });

      expect(resolved.unwrap("expected directory resolution to succeed")).toBe(child);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("returns a typed error for non-directory targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-workspace-"));

    try {
      await writeFile(join(root, "README.md"), "hello");
      const xmux = createTestXmux({ defaultWorkingDirectory: root });
      const resolved = await resolveDirectoryForThread({
        ctx: xmux.ctx,
        thread,
        path: "README.md",
      });

      expect(resolved.isErr() && InvalidDirectoryError.is(resolved.error)).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function createTestXmux(input: { readonly defaultWorkingDirectory: string }) {
  return createXmux({
    harnesses: {
      pi: defineHarnessAdapter({
        id: "pi",
        async open() {
          return Result.ok({
            id: "pi",
            createSession: async () => Result.ok({ sessionId: "session-1", adapterData: {} }),
            resumeSession: async () => Result.err(new Error("not implemented")),
            listSessions: async () => Result.err(new Error("not implemented")),
            getSession: async () => Result.err(new Error("not implemented")),
            prompt: async () => Result.err(new Error("not implemented")),
            deleteSession: async () => Result.err(new Error("not implemented")),
            abort: async () => Result.err(new Error("not implemented")),
            close: async () => {},
          });
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
          return Result.ok({
            id: "telegram",
            start: async () => Result.ok(),
            sendMessage: async (messageInput) =>
              Result.ok({
                chatId: "telegram",
                conversationId: messageInput.conversationId,
                messageId: "sent-1",
                text: messageInput.text,
                format: messageInput.format,
                adapterData: {},
              }),
            sendAction: async (actionInput) =>
              Result.ok({
                chatId: "telegram",
                conversationId: actionInput.conversationId,
                messageId: "action-1",
                text: actionInput.text,
                format: actionInput.format,
                adapterData: {},
              }),
            respondToAction: async () => Result.ok(),
            reply: async (replyInput) =>
              Result.ok({
                chatId: "telegram",
                conversationId: replyInput.conversationId,
                messageId: "reply-1",
                text: replyInput.text,
                format: replyInput.format,
                adapterData: {},
              }),
            close: async () => {},
          });
        },
      }),
    },
    config: {
      defaultWorkingDirectory: input.defaultWorkingDirectory,
      deliveryMode: "requester_only",
    },
  });
}
