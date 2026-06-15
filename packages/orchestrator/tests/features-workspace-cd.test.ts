import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
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

describe("/cd command", () => {
  test("changes from default cwd to a child directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-cd-"));
    const child = join(root, "packages", "orchestrator");

    try {
      await mkdir(child, { recursive: true });
      const replies: string[] = [];
      let emitCommand: ((event: unknown) => void) | undefined;
      const xmux = createTestXmux({
        replies,
        defaultWorkingDirectory: root,
        onEmit: (emit) => {
          emitCommand = emit;
        },
      });

      const initialized = await xmux.initialize();
      expect(initialized.isOk()).toBe(true);

      emitCommand?.(cdEvent({ conversationId: "conversation-1", path: "packages/orchestrator" }));

      await eventually(() => replies.length === 1);

      expect(replies[0]).toBe(`**Directory changed**\n\nCurrent directory: \`${child}\``);
      expect(
        (
          await xmux.ctx.store.workspaces.get({ chatId: "telegram", threadId: "conversation-1" })
        ).unwrap("expected workspace lookup to succeed"),
      ).toMatchObject({ cwd: child });

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("supports relative navigation such as ..", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-cd-"));
    const child = join(root, "packages", "orchestrator");
    const parent = join(root, "packages");

    try {
      await mkdir(child, { recursive: true });
      const replies: string[] = [];
      let emitCommand: ((event: unknown) => void) | undefined;
      const xmux = createTestXmux({
        replies,
        defaultWorkingDirectory: root,
        onEmit: (emit) => {
          emitCommand = emit;
        },
      });

      const initialized = await xmux.initialize();
      expect(initialized.isOk()).toBe(true);

      emitCommand?.(cdEvent({ conversationId: "conversation-1", path: "packages/orchestrator" }));
      await eventually(() => replies.length === 1);

      emitCommand?.(cdEvent({ conversationId: "conversation-1", path: ".." }));
      await eventually(() => replies.length === 2);

      expect(replies[1]).toBe(`**Directory changed**\n\nCurrent directory: \`${parent}\``);
      expect(
        (
          await xmux.ctx.store.workspaces.get({ chatId: "telegram", threadId: "conversation-1" })
        ).unwrap("expected workspace lookup to succeed"),
      ).toMatchObject({ cwd: parent });

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects file targets and nonexistent paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-cd-"));

    try {
      await writeFile(join(root, "README.md"), "hello");
      const replies: string[] = [];
      let emitCommand: ((event: unknown) => void) | undefined;
      const xmux = createTestXmux({
        replies,
        defaultWorkingDirectory: root,
        onEmit: (emit) => {
          emitCommand = emit;
        },
      });

      const initialized = await xmux.initialize();
      expect(initialized.isOk()).toBe(true);

      emitCommand?.(cdEvent({ conversationId: "conversation-1", path: "README.md" }));
      await eventually(() => replies.length === 1);

      emitCommand?.(cdEvent({ conversationId: "conversation-1", path: "missing" }));
      await eventually(() => replies.length === 2);

      expect(replies[0]).toBe(`**Error:** Not a directory\n\n\`${join(root, "README.md")}\``);
      expect(replies[1]).toBe(`**Error:** Path not found\n\n\`${join(root, "missing")}\``);
      expect(
        (
          await xmux.ctx.store.workspaces.get({ chatId: "telegram", threadId: "conversation-1" })
        ).unwrap("expected workspace lookup to succeed"),
      ).toBeNull();

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function cdEvent(input: { readonly conversationId: string; readonly path: string }) {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: input.conversationId },
    command: {
      name: "cd",
      options: { path: input.path },
    },
  };
}

function createTestXmux(input: {
  readonly replies: string[];
  readonly defaultWorkingDirectory: string;
  readonly onEmit: (emit: (event: unknown) => void) => void;
}) {
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
            async start(context) {
              input.onEmit(context.emit as (event: unknown) => void);
              return Result.ok();
            },
            async sendMessage(messageInput) {
              return Result.ok({
                chatId: "telegram",
                conversationId: messageInput.conversationId,
                messageId: "sent-1",
                text: messageInput.text,
                format: messageInput.format,
                adapterData: {},
              });
            },
            async sendAction(input) {
              return Result.ok({
                chatId: input.chatId,
                conversationId: input.conversationId,
                messageId: "action-1",
                text: input.text,
                adapterData: {},
              });
            },
            async respondToAction() {
              return Result.ok();
            },
            async reply(replyInput) {
              input.replies.push(replyInput.text);
              return Result.ok({
                chatId: "telegram",
                conversationId: replyInput.conversationId,
                messageId: "reply-1",
                text: replyInput.text,
                format: replyInput.format,
                adapterData: {},
              });
            },
            close: async () => {},
          });
        },
      }),
    },
    config: {
      userName: "xmux",
      defaultWorkingDirectory: input.defaultWorkingDirectory,
      deliveryMode: "requester_only",
    },
  });
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(predicate()).toBe(true);
}
