import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { createXmux } from "../src";
import { CommandHarnessNotConfiguredError } from "../src/features/errors";

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

describe("/new command", () => {
  test("creates a harness session, stores metadata, binds the chat thread, and replies", async () => {
    const replies: string[] = [];
    const createInputs: { readonly cwd: string; readonly title?: string }[] = [];
    let emitCommand: ((event: unknown) => void) | undefined;

    const xmux = createXmux({
      harnesses: {
        pi: defineHarnessAdapter({
          id: "pi",
          async open() {
            return Result.ok({
              id: "pi",
              async createSession(input) {
                createInputs.push(input);
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
                emitCommand = context.emit as (event: unknown) => void;
                return Result.ok();
              },
              async sendMessage(input) {
                return Result.ok({
                  chatId: "telegram",
                  conversationId: input.conversationId,
                  messageId: "sent-1",
                  text: input.text,
                  format: input.format,
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
              async reply(input) {
                replies.push(input.text);
                return Result.ok({
                  chatId: "telegram",
                  conversationId: input.conversationId,
                  messageId: "reply-1",
                  text: input.text,
                  format: input.format,
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
        defaultWorkingDirectory: process.cwd(),
        deliveryMode: "requester_only",
      },
    });

    const initialized = await xmux.initialize();
    expect(initialized.isOk()).toBe(true);
    expect(emitCommand).toBeDefined();

    emitCommand?.({
      type: "command",
      chatId: "telegram",
      conversation: { chatId: "telegram", conversationId: "conversation-1" },
      actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
      message: { chatId: "telegram", conversationId: "conversation-1", messageId: "message-1" },
      command: {
        name: "new",
        options: { harnessId: "pi", title: "Fix bug" },
      },
    });

    await eventually(() => replies.length === 1);

    expect(createInputs).toMatchObject([{ cwd: process.cwd(), title: "Fix bug" }]);
    expect(replies[0]).toBe(
      "**Session created**\n\nHarness: `pi`\nSession ID: `session-1`\nTitle: Fix bug\n- The session is now active. Send a message to start the conversation.\n",
    );

    const session = await xmux.ctx.store.sessions.get({ harnessId: "pi", sessionId: "session-1" });
    expect(session.unwrap("expected session to be stored")).toMatchObject({
      ref: { harnessId: "pi", sessionId: "session-1" },
      origin: { chatId: "telegram", threadId: "conversation-1" },
      requester: { userId: "user-1", displayName: "Ishak" },
      cwd: process.cwd(),
      title: "Fix bug",
      deliveryMode: "requester_only",
      status: "open",
    });

    const binding = await xmux.ctx.store.threadBindings.get({
      chatId: "telegram",
      threadId: "conversation-1",
    });
    expect(binding.unwrap("expected binding lookup to succeed")).toMatchObject({
      thread: { chatId: "telegram", threadId: "conversation-1" },
      sessionRef: { harnessId: "pi", sessionId: "session-1" },
    });

    await xmux.shutdown();
  });

  test("replies with a typed error for an unknown harness", async () => {
    const replies: string[] = [];
    let createCalls = 0;
    let emitCommand: ((event: unknown) => void) | undefined;

    const xmux = createXmux({
      harnesses: {
        pi: defineHarnessAdapter({
          id: "pi",
          async open() {
            return Result.ok({
              id: "pi",
              async createSession() {
                createCalls += 1;
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
                emitCommand = context.emit as (event: unknown) => void;
                return Result.ok();
              },
              async sendMessage(input) {
                return Result.ok({
                  chatId: "telegram",
                  conversationId: input.conversationId,
                  messageId: "sent-1",
                  text: input.text,
                  format: input.format,
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
              async reply(input) {
                replies.push(input.text);
                return Result.ok({
                  chatId: "telegram",
                  conversationId: input.conversationId,
                  messageId: "reply-1",
                  text: input.text,
                  format: input.format,
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
        defaultWorkingDirectory: process.cwd(),
        deliveryMode: "requester_only",
      },
    });

    const initialized = await xmux.initialize();
    expect(initialized.isOk()).toBe(true);

    emitCommand?.({
      type: "command",
      chatId: "telegram",
      conversation: { chatId: "telegram", conversationId: "conversation-1" },
      command: {
        name: "new",
        options: { harnessId: "missing", title: undefined },
      },
    });

    await eventually(() => replies.length === 1);

    expect(createCalls).toBe(0);
    expect(replies[0]).toBe("**Error:** Unknown harness `missing`\n\nAvailable harnesses\n- `pi`");
    expect(
      CommandHarnessNotConfiguredError.is(
        new CommandHarnessNotConfiguredError({
          harnessId: "missing",
          availableHarnessIds: ["pi"],
        }),
      ),
    ).toBe(true);

    await xmux.shutdown();
  });
});

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(predicate()).toBe(true);
}
