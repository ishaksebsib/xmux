import { Result } from "better-result";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createXmux } from "../src";
import { createThreadWorkspace } from "../src/store";

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

describe("/pwd command", () => {
  test("replies with the default cwd when no workspace exists", async () => {
    const replies: string[] = [];
    let emitCommand: ((event: unknown) => void) | undefined;
    const defaultWorkingDirectory = process.cwd();

    const xmux = createTestXmux({
      replies,
      defaultWorkingDirectory,
      onEmit: (emit) => {
        emitCommand = emit;
      },
    });

    const initialized = await xmux.initialize();
    expect(initialized.isOk()).toBe(true);

    emitCommand?.(pwdEvent({ conversationId: "conversation-1" }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(`**Current directory** :\n\n\`${defaultWorkingDirectory}\``);

    await xmux.shutdown();
  });

  test("replies with the stored thread cwd when workspace exists", async () => {
    const replies: string[] = [];
    let emitCommand: ((event: unknown) => void) | undefined;
    const defaultWorkingDirectory = process.cwd();
    const storedCwd = `${process.cwd()}/packages/orchestrator`;

    const xmux = createTestXmux({
      replies,
      defaultWorkingDirectory,
      onEmit: (emit) => {
        emitCommand = emit;
      },
    });

    await xmux.ctx.store.workspaces.set(
      createThreadWorkspace({
        thread: { chatId: "telegram", threadId: "conversation-1" },
        cwd: storedCwd,
        now: "2026-05-08T10:00:00.000Z",
      }),
    );

    const initialized = await xmux.initialize();
    expect(initialized.isOk()).toBe(true);

    emitCommand?.(pwdEvent({ conversationId: "conversation-1" }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(`**Current directory** :\n\n\`${storedCwd}\``);

    await xmux.shutdown();
  });
});

function pwdEvent(input: { readonly conversationId: string }) {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: input.conversationId },
    command: {
      name: "pwd",
      options: {},
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
