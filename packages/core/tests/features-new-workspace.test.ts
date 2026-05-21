import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

describe("/new workspace cwd integration", () => {
  test("uses the thread cwd changed by /cd and stores it as the session cwd snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-new-workspace-"));
    const child = join(root, "project");

    try {
      await mkdir(child, { recursive: true });
      const replies: string[] = [];
      const createInputs: { readonly cwd: string; readonly title?: string }[] = [];
      let emitCommand: ((event: unknown) => void) | undefined;
      const xmux = createTestXmux({
        replies,
        createInputs,
        defaultWorkingDirectory: root,
        onEmit: (emit) => {
          emitCommand = emit;
        },
      });

      const initialized = await xmux.initialize();
      expect(initialized.isOk()).toBe(true);
      expect(emitCommand).toBeDefined();

      emitCommand?.(cdEvent({ conversationId: "conversation-1", path: "project" }));
      await eventually(() => replies.length === 1);

      emitCommand?.(newEvent({ conversationId: "conversation-1", harnessId: "opencode" }));
      await eventually(() => replies.length === 2);

      expect(createInputs).toMatchObject([{ cwd: child }]);
      expect(replies[1]).toBe("Created opencode session session-1.");

      const session = await xmux.ctx.store.sessions.get({
        harnessId: "opencode",
        sessionId: "session-1",
      });
      expect(session.unwrap("expected session to be stored")).toMatchObject({ cwd: child });

      await xmux.shutdown();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("uses the default cwd when no thread workspace exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-new-workspace-"));

    try {
      const replies: string[] = [];
      const createInputs: { readonly cwd: string; readonly title?: string }[] = [];
      let emitCommand: ((event: unknown) => void) | undefined;
      const xmux = createTestXmux({
        replies,
        createInputs,
        defaultWorkingDirectory: root,
        onEmit: (emit) => {
          emitCommand = emit;
        },
      });

      const initialized = await xmux.initialize();
      expect(initialized.isOk()).toBe(true);
      expect(emitCommand).toBeDefined();

      emitCommand?.(newEvent({ conversationId: "conversation-1", harnessId: "opencode" }));
      await eventually(() => replies.length === 1);

      expect(createInputs).toMatchObject([{ cwd: root }]);
      expect(replies[0]).toBe("Created opencode session session-1.");

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

function newEvent(input: { readonly conversationId: string; readonly harnessId: string }) {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: input.conversationId },
    command: {
      name: "new",
      options: { harnessId: input.harnessId, title: undefined },
    },
  };
}

function createTestXmux(input: {
  readonly replies: string[];
  readonly createInputs: { readonly cwd: string; readonly title?: string }[];
  readonly defaultWorkingDirectory: string;
  readonly onEmit: (emit: (event: unknown) => void) => void;
}) {
  return createXmux({
    harnesses: {
      opencode: defineHarnessAdapter({
        id: "opencode",
        async open() {
          return Result.ok({
            id: "opencode",
            async createSession(createInput) {
              input.createInputs.push(createInput);
              return Result.ok({ sessionId: "session-1", adapterData: {} });
            },
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
