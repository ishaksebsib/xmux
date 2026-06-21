import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { createXmux, type XmuxMiddleware } from "../src";

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

describe("xmux middleware", () => {
  test("runs handlers through onion middleware in route order", async () => {
    const order: string[] = [];
    const { emitCommand, replies, xmux } = await initializeXmux({
      middleware: [
        async (_ctx, next) => {
          order.push("outer:before");
          const result = await next();
          order.push("outer:after");
          return result;
        },
        async (_ctx, next) => {
          order.push("inner:before");
          const result = await next();
          order.push("inner:after");
          return result;
        },
      ],
    });

    emitCommand(newCommandEvent());
    await eventually(() => replies.length === 1);

    expect(order).toEqual(["outer:before", "inner:before", "inner:after", "outer:after"]);

    await xmux.shutdown();
  });

  test("middleware can clean up after the routed response finishes", async () => {
    let finishCreateSession!: () => void;
    const createSessionCanFinish = new Promise<void>((resolve) => {
      finishCreateSession = resolve;
    });
    const lifecycle: string[] = [];
    const { emitCommand, replies, xmux } = await initializeXmux({
      middleware: [
        async (_ctx, next) => {
          lifecycle.push("start");
          try {
            return await next();
          } finally {
            lifecycle.push("stop");
          }
        },
      ],
      onCreateSession: () => createSessionCanFinish,
    });

    emitCommand(newCommandEvent());
    await eventually(() => lifecycle.length === 1);
    expect(lifecycle).toEqual(["start"]);

    finishCreateSession();
    await eventually(() => replies.length === 1);

    expect(lifecycle).toEqual(["start", "stop"]);

    await xmux.shutdown();
  });
});

async function initializeXmux(
  input: {
    readonly middleware?: readonly XmuxMiddleware<
      ReturnType<typeof createHarnesses>,
      ReturnType<typeof createChats>
    >[];
    readonly onCreateSession?: () => Promise<void>;
  } = {},
) {
  const replies: string[] = [];
  let emitCommand: ((event: unknown) => void) | undefined;

  const chats = createChats({
    replies,
    setEmitCommand: (emit) => {
      emitCommand = emit;
    },
  });
  const xmux = createXmux({
    harnesses: createHarnesses({ onCreateSession: input.onCreateSession }),
    chats,
    middleware: input.middleware,
    config: {
      defaultWorkingDirectory: process.cwd(),
      deliveryMode: "requester_only",
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitCommand).toBeDefined();

  return { emitCommand: emitCommand as (event: unknown) => void, replies, xmux };
}

function createHarnesses(input: { readonly onCreateSession?: () => Promise<void> } = {}) {
  return {
    pi: defineHarnessAdapter<"pi">({
      id: "pi",
      async open() {
        return Result.ok({
          id: "pi",
          async createSession() {
            await input.onCreateSession?.();
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
  };
}

function createChats(input: {
  readonly replies: string[];
  readonly setEmitCommand: (emit: (event: unknown) => void) => void;
}) {
  return {
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
            input.setEmitCommand(context.emit as (event: unknown) => void);
            return Result.ok();
          },
          async sendMessage(message) {
            return Result.ok(sentMessage(message.text));
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
          async reply(message) {
            input.replies.push(message.text);
            return Result.ok(sentMessage(message.text));
          },
          close: async () => {},
        });
      },
    }),
  };
}

function newCommandEvent() {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: "conversation-1" },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: "conversation-1", messageId: "message-1" },
    command: {
      name: "new",
      options: { harnessId: "pi", title: "Fix bug" },
    },
  };
}

function sentMessage(text: string) {
  return {
    chatId: "telegram" as const,
    conversationId: "conversation-1",
    messageId: "reply-1",
    text,
    adapterData: {},
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }

    await delay(5);
  }

  expect(predicate()).toBe(true);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
