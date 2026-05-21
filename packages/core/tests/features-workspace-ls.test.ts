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
    attachments: false,
  },
} as const;

describe("/ls command", () => {
  test("lists current cwd with directories before files", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-ls-"));

    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "README.md"), "hello");
      const { replies, emitCommand, xmux } = await initializeTestXmux({
        defaultWorkingDirectory: root,
      });

      emitCommand(lsEvent({ conversationId: "conversation-1" }));
      await eventually(() => replies.length === 1);

      expect(replies[0]).toBe(
        `**Directory listing**\n\nPath: \`${root}\`\n\n- 📁 \`src/\`\n- 📄 \`README.md\``,
      );

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("lists a relative target path", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-ls-"));
    const child = join(root, "packages", "core");

    try {
      await mkdir(child, { recursive: true });
      await writeFile(join(child, "package.json"), "{}");
      const { replies, emitCommand, xmux } = await initializeTestXmux({
        defaultWorkingDirectory: root,
      });

      emitCommand(lsEvent({ conversationId: "conversation-1", path: "packages/core" }));
      await eventually(() => replies.length === 1);

      expect(replies[0]).toBe(
        `**Directory listing**\n\nPath: \`${child}\`\n\n- 📄 \`package.json\``,
      );

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("hides dotfiles by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-ls-"));

    try {
      await writeFile(join(root, ".env"), "SECRET=1");
      await writeFile(join(root, "README.md"), "hello");
      const { replies, emitCommand, xmux } = await initializeTestXmux({
        defaultWorkingDirectory: root,
      });

      emitCommand(lsEvent({ conversationId: "conversation-1" }));
      await eventually(() => replies.length === 1);

      expect(replies[0]).toBe(`**Directory listing**\n\nPath: \`${root}\`\n\n- 📄 \`README.md\``);

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("shows dotfiles when config enables hidden files", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-ls-"));

    try {
      await writeFile(join(root, ".env"), "SECRET=1");
      await writeFile(join(root, "README.md"), "hello");
      const { replies, emitCommand, xmux } = await initializeTestXmux({
        defaultWorkingDirectory: root,
        showHiddenFiles: true,
      });

      emitCommand(lsEvent({ conversationId: "conversation-1" }));
      await eventually(() => replies.length === 1);

      expect(replies[0]).toBe(
        `**Directory listing**\n\nPath: \`${root}\`\n\n- 📄 \`.env\`\n- 📄 \`README.md\``,
      );

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("truncates long listings", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-ls-"));

    try {
      await writeFile(join(root, "a.txt"), "a");
      await writeFile(join(root, "b.txt"), "b");
      await writeFile(join(root, "c.txt"), "c");
      const { replies, emitCommand, xmux } = await initializeTestXmux({
        defaultWorkingDirectory: root,
        maxListEntries: 2,
      });

      emitCommand(lsEvent({ conversationId: "conversation-1" }));
      await eventually(() => replies.length === 1);

      expect(replies[0]).toBe(
        `**Directory listing**\n\nPath: \`${root}\`\n\n- 📄 \`a.txt\`\n- 📄 \`b.txt\`\n\n_Showing 2 of 3 entries._`,
      );

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function lsEvent(input: { readonly conversationId: string; readonly path?: string }) {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: input.conversationId },
    command: {
      name: "ls",
      options: input.path === undefined ? {} : { path: input.path },
    },
  };
}

async function initializeTestXmux(input: {
  readonly defaultWorkingDirectory: string;
  readonly showHiddenFiles?: boolean;
  readonly maxListEntries?: number;
}) {
  const replies: string[] = [];
  let emitCommand: ((event: unknown) => void) | undefined;
  const xmux = createTestXmux({
    replies,
    defaultWorkingDirectory: input.defaultWorkingDirectory,
    showHiddenFiles: input.showHiddenFiles,
    maxListEntries: input.maxListEntries,
    onEmit: (emit) => {
      emitCommand = emit;
    },
  });

  const initialized = await xmux.initialize();
  expect(initialized.isOk()).toBe(true);
  expect(emitCommand).toBeDefined();

  return { replies, emitCommand: emitCommand as (event: unknown) => void, xmux };
}

function createTestXmux(input: {
  readonly replies: string[];
  readonly defaultWorkingDirectory: string;
  readonly showHiddenFiles?: boolean;
  readonly maxListEntries?: number;
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
      workspace: {
        showHiddenFiles: input.showHiddenFiles,
        maxListEntries: input.maxListEntries,
      },
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
