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
    attachments: { receive: false, send: false, download: false },
  },
} as const;

describe("/new command", () => {
  test("defaults to the only configured harness, stores metadata, binds the chat thread, and replies", async () => {
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
        options: { harnessId: undefined, title: "Fix bug" },
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

  test("offers a button per configured harness when no harnessId is given", async () => {
    const harness = await initializeNewXmux();

    harness.emitCommand({ harnessId: undefined, title: undefined });

    await eventually(() => harness.actionMessages.length === 1);

    expect(harness.createInputs).toEqual([]);
    expect(harness.actionMessages[0]?.text).toContain("**Choose a harness**");
    expect(harness.actionMessages[0]?.text).toContain(`Current directory: \`${process.cwd()}\``);
    expect(harness.actionMessages[0]?.text).toContain("Pick one to start a new session.");
    expect(harness.actionMessages[0]?.buttons).toEqual([
      [
        expect.objectContaining({
          label: "opencode",
          actionId: "nh",
          value: "x",
          payload: "opencode",
          style: "primary",
        }),
      ],
      [
        expect.objectContaining({
          label: "pi",
          actionId: "nh",
          value: "x",
          payload: "pi",
          style: "primary",
        }),
      ],
    ]);

    await harness.xmux.shutdown();
  });

  test("creates the session and clears the buttons when a harness button is tapped", async () => {
    const harness = await initializeNewXmux();

    harness.emitHarnessAction("pi");

    await eventually(() => harness.actionUpdates.length === 1);

    expect(harness.createInputs).toMatchObject([{ cwd: process.cwd() }]);
    expect(harness.actionUpdates[0]?.text).toContain("**Session created**");
    expect(harness.actionUpdates[0]?.text).toContain("Harness: `pi`");
    expect(harness.actionUpdates[0]?.text).toContain("Session ID: `session-1`");
    expect(harness.actionUpdates[0]?.buttons).toEqual([]);

    const session = await harness.xmux.ctx.store.sessions.get({
      harnessId: "pi",
      sessionId: "session-1",
    });
    expect(session.unwrap("expected session to be stored")).toMatchObject({
      ref: { harnessId: "pi", sessionId: "session-1" },
      origin: { chatId: "telegram", threadId: "conversation-1" },
      requester: { userId: "user-1", displayName: "Ishak" },
      cwd: process.cwd(),
    });

    const binding = await harness.xmux.ctx.store.threadBindings.get({
      chatId: "telegram",
      threadId: "conversation-1",
    });
    expect(binding.unwrap("expected binding lookup to succeed")).toMatchObject({
      thread: { chatId: "telegram", threadId: "conversation-1" },
      sessionRef: { harnessId: "pi", sessionId: "session-1" },
    });

    await harness.xmux.shutdown();
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

interface CapturedActionMessage {
  readonly text: string;
  readonly buttons: readonly (readonly unknown[])[];
}

/**
 * Builds an xmux wired to two harnesses (`opencode`, `pi`) and a telegram chat
 * that records sent action messages and in-place action updates, so the harness
 * picker flow for a bare `/new` can be asserted end to end.
 */
async function initializeNewXmux() {
  const replies: string[] = [];
  const actionMessages: CapturedActionMessage[] = [];
  const actionUpdates: CapturedActionMessage[] = [];
  const createInputs: { readonly cwd: string; readonly title?: string }[] = [];
  let emitCommand: ((event: unknown) => void) | undefined;

  const createHarnessRuntime = <const THarnessId extends "opencode" | "pi">(
    harnessId: THarnessId,
  ) => ({
    id: harnessId,
    async createSession(input: { readonly cwd: string; readonly title?: string }) {
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

  const xmux = createXmux({
    harnesses: {
      opencode: defineHarnessAdapter<"opencode">({
        id: "opencode",
        async open() {
          return Result.ok(createHarnessRuntime("opencode"));
        },
      }),
      pi: defineHarnessAdapter<"pi">({
        id: "pi",
        async open() {
          return Result.ok(createHarnessRuntime("pi"));
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
              actionMessages.push({ text: input.text, buttons: input.buttons });
              return Result.ok({
                chatId: input.chatId,
                conversationId: input.conversationId,
                messageId: "action-1",
                text: input.text,
                adapterData: {},
              });
            },
            async respondToAction(input) {
              if (input.response.kind === "reply") {
                const message = input.response.message;
                replies.push(typeof message === "string" ? message : message.text);
              }
              if (input.response.kind === "update" && input.response.message) {
                const message = input.response.message;
                actionUpdates.push({
                  text: typeof message === "string" ? message : message.text,
                  buttons: input.response.buttons ?? [],
                });
              }
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
      defaultWorkingDirectory: process.cwd(),
      deliveryMode: "requester_only",
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitCommand).toBeDefined();

  const emit = emitCommand as (event: unknown) => void;

  return {
    replies,
    actionMessages,
    actionUpdates,
    createInputs,
    xmux,
    emitCommand: (options: { readonly harnessId?: string; readonly title?: string }) =>
      emit(newCommandEvent(options)),
    emitHarnessAction: (harnessId: string) => emit(newHarnessActionEvent(harnessId)),
  };
}

function newCommandEvent(options: { readonly harnessId?: string; readonly title?: string }) {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: "conversation-1" },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: "conversation-1", messageId: "message-1" },
    command: { name: "new", options },
  };
}

function newHarnessActionEvent(harnessId: string) {
  return {
    type: "action",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: "conversation-1" },
    message: { chatId: "telegram", conversationId: "conversation-1", messageId: "1" },
    interactionId: "new-harness-1",
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    actionId: "nh",
    value: "x",
    payload: harnessId,
  };
}
