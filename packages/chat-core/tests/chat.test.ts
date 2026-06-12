import { Result } from "better-result";
import { describe, expect, test, vi } from "vitest";
import {
  ChatAdapterOpenError,
  ChatAdapterStartError,
  ChatCloseError,
  ChatLifecycleError,
  ChatSendMessageError,
  ChatTypingIndicatorError,
  UnknownChatAdapterError,
  UnsupportedChatOperationError,
  actionValue,
  chatLogEvents,
  createChat,
  defineChatAction,
  defineChatActions,
  defineChatAdapter,
  defineChatCommand,
  defineChatCommands,
  type ChatAdapterStartContext,
  type ChatAdapterStreamMessageInput,
  type ChatAttachment,
  type ChatCommandRegistry,
  type ChatAdapterStreamReplyInput,
  type ChatLogger,
  type OpenChatAdapterContext,
} from "../src";

const commands = defineChatCommands({
  start: defineChatCommand({ description: "Start" }),
});

const basicCapabilities = {
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

const streamCapabilities = {
  messages: {
    send: true,
    reply: true,
    edit: true,
    delete: false,
    typing: false,
    markdown: false,
    attachments: { receive: false, send: false, download: false },
    stream: { send: true, reply: true, strategy: "edit" },
  },
} as const;

const typingCapabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: true,
    markdown: false,
    attachments: { receive: false, send: false, download: false },
  },
} as const;

type Handles = {
  readonly opens: string[];
  readonly starts: string[];
  readonly closes: string[];
};

async function* textChunks(parts: readonly string[]) {
  for (const delta of parts) {
    yield { type: "delta" as const, delta };
  }
}

async function* bytesChunks(chunks: readonly Uint8Array[]) {
  yield* chunks;
}

function createMockLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies ChatLogger;
}

function createRuntimeAdapter<const TId extends "alpha" | "beta">(args: {
  readonly id: TId;
  readonly handles: Handles;
  readonly closeError?: unknown;
  readonly openError?: unknown;
  readonly throwOnOpen?: unknown;
  readonly sendError?: unknown;
  readonly startError?: unknown;
  readonly throwOnStart?: unknown;
  readonly throwOnSend?: unknown;
  readonly nativeReply?: boolean;
  readonly nativeStream?: boolean;
  readonly nativeTyping?: boolean;
  readonly replyError?: unknown;
  readonly throwOnReply?: unknown;
  readonly typingError?: unknown;
  readonly throwOnTyping?: unknown;
  readonly onOpen?: (context: OpenChatAdapterContext) => void;
  readonly onStart?: (context: ChatAdapterStartContext<ChatCommandRegistry, TId>) => void;
  readonly onSend?: (input: {
    readonly adapterOptions: Record<never, never>;
    readonly conversationId: string;
    readonly text: string;
  }) => void;
  readonly onSendAction?: (input: {
    readonly adapterOptions: Record<never, never>;
    readonly conversationId: string;
    readonly text: string;
    readonly buttons: readonly (readonly unknown[])[];
  }) => void;
  readonly onRespondToAction?: (input: {
    readonly interactionId: string;
    readonly response: { readonly kind: string };
  }) => void;
  readonly onReply?: (input: {
    readonly message?: { readonly messageId: string };
    readonly mode?: string;
    readonly text: string;
  }) => void;
  readonly onStreamMessage?: (input: {
    readonly content: { readonly chunks: AsyncIterable<unknown> };
  }) => void;
  readonly onStreamReply?: (input: {
    readonly message?: { readonly messageId: string };
    readonly mode?: string;
    readonly content: { readonly chunks: AsyncIterable<unknown> };
  }) => void;
  readonly onTyping?: (input: {
    readonly conversationId: string;
    readonly message?: { readonly messageId: string };
    readonly adapterOptions: Record<never, never>;
  }) => void;
}) {
  const capabilities = args.nativeStream
    ? streamCapabilities
    : args.nativeTyping
      ? typingCapabilities
      : basicCapabilities;

  return defineChatAdapter<TId, Record<never, never>, Record<never, never>, typeof capabilities>({
    id: args.id,
    capabilities,
    async open(context) {
      args.onOpen?.(context);
      args.handles.opens.push(args.id);
      if (args.throwOnOpen !== undefined) {
        throw args.throwOnOpen;
      }
      if (args.openError !== undefined) {
        return Result.err(args.openError);
      }

      return Result.ok({
        id: args.id,
        async start(context) {
          args.handles.starts.push(args.id);
          if (args.throwOnStart !== undefined) {
            throw args.throwOnStart;
          }
          if (args.startError !== undefined) {
            return Result.err(args.startError);
          }
          args.onStart?.(context);
          return Result.ok();
        },
        async sendMessage(input) {
          args.onSend?.(input);
          if (args.throwOnSend !== undefined) {
            throw args.throwOnSend;
          }
          if (args.sendError !== undefined) {
            return Result.err(args.sendError);
          }

          return Result.ok({
            chatId: args.id,
            conversationId: input.conversationId,
            messageId: `${args.id}-message`,
            text: input.text,
            format: input.format,
            adapterData: {},
          });
        },
        async sendAction(input) {
          args.onSendAction?.(input);
          return Result.ok({
            chatId: args.id,
            conversationId: input.conversationId,
            messageId: `${args.id}-action`,
            text: input.text,
            format: input.format,
            adapterData: {},
          });
        },
        async respondToAction(input) {
          args.onRespondToAction?.(input);
          return Result.ok();
        },
        reply: args.nativeReply
          ? async (input) => {
              args.onReply?.(input);
              if (args.throwOnReply !== undefined) {
                throw args.throwOnReply;
              }
              if (args.replyError !== undefined) {
                return Result.err(args.replyError);
              }

              return Result.ok({
                chatId: args.id,
                conversationId: input.conversationId,
                messageId: `${args.id}-reply`,
                text: input.text,
                format: input.format,
                adapterData: {},
              });
            }
          : undefined,
        sendTyping: args.nativeTyping
          ? async (input) => {
              args.onTyping?.(input);
              if (args.throwOnTyping !== undefined) {
                throw args.throwOnTyping;
              }
              if (args.typingError !== undefined) {
                return Result.err(args.typingError);
              }

              return Result.ok();
            }
          : undefined,
        ...(args.nativeStream
          ? {
              async streamMessage(input: ChatAdapterStreamMessageInput<TId, Record<never, never>>) {
                args.onStreamMessage?.(input);
                return Result.ok({
                  chatId: args.id,
                  conversationId: input.conversationId,
                  messageId: `${args.id}-stream`,
                  text: "streamed",
                  format: input.content.format,
                  adapterData: {},
                });
              },
              async streamReply(input: ChatAdapterStreamReplyInput<TId, Record<never, never>>) {
                args.onStreamReply?.(input);
                return Result.ok({
                  chatId: args.id,
                  conversationId: input.conversationId,
                  messageId: `${args.id}-stream-reply`,
                  text: "streamed reply",
                  format: input.content.format,
                  adapterData: {},
                });
              },
            }
          : {}),
        async close() {
          args.handles.closes.push(args.id);
          if (args.closeError !== undefined) {
            throw args.closeError;
          }
        },
      });
    },
  });
}

describe("createChat lifecycle", () => {
  test("opens and starts each adapter with commands and emits ready", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const ready: string[] = [];
    const seenCommands: string[] = [];

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart: (context) => {
            seenCommands.push(context.commands.start?.description ?? "missing");
          },
        }),
        beta: createRuntimeAdapter({ id: "beta", handles }),
      },
      commands,
    });

    chat.on("ready", (event) => {
      ready.push(event.chatId);
    });

    const started = await chat.start();

    expect(started.isOk()).toBe(true);
    expect(handles.opens).toEqual(["alpha", "beta"]);
    expect(handles.starts).toEqual(["alpha", "beta"]);
    expect(seenCommands).toEqual(["Start"]);
    expect(ready).toEqual(["alpha", "beta"]);
  });

  test("passes injected loggers to adapters and logs safe structured metadata", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const logger = createMockLogger();
    let openLogger: ChatLogger | undefined;
    let startLogger: ChatLogger | undefined;

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onOpen: (context) => {
            openLogger = context.logger;
          },
          onStart: (context) => {
            startLogger = context.logger;
          },
        }),
      },
      commands,
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    expect(openLogger).toBe(logger);
    expect(startLogger).toBe(logger);

    const sent = await chat.sendMessage({
      chatId: "alpha",
      conversationId: "conversation",
      text: "do not log this secret text",
    });

    expect(sent.isOk()).toBe(true);
    expect(logger.debug).toHaveBeenCalledWith(
      chatLogEvents.startBegin,
      expect.objectContaining({ component: "@xmux/chat-core", operation: "start" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      chatLogEvents.operationBegin,
      expect.objectContaining({
        component: "@xmux/chat-core",
        chatId: "alpha",
        operation: "sendMessage",
        conversationId: "conversation",
        textLength: "do not log this secret text".length,
      }),
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("do not log this secret text");
  });

  test("logger failures do not affect chat operations", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const logger = {
      trace: vi.fn(() => {
        throw new Error("logger failed");
      }),
      debug: vi.fn(() => {
        throw new Error("logger failed");
      }),
      info: vi.fn(() => {
        throw new Error("logger failed");
      }),
      warn: vi.fn(() => {
        throw new Error("logger failed");
      }),
      error: vi.fn(() => {
        throw new Error("logger failed");
      }),
    } satisfies ChatLogger;

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles }),
      },
      commands,
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    expect(
      (
        await chat.sendMessage({
          chatId: "alpha",
          conversationId: "conversation",
          text: "hello",
        })
      ).isOk(),
    ).toBe(true);
    expect((await chat.close()).isOk()).toBe(true);
  });

  test("logs event handler failures", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const logger = createMockLogger();
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const errors: unknown[] = [];

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart: (context) => {
            startContext = context;
          },
        }),
      },
      commands,
      logger,
    });

    chat.on("message", () => {
      throw new Error("handler boom");
    });
    chat.on("error", (event) => {
      errors.push(event.error);
    });

    expect((await chat.start()).isOk()).toBe(true);
    startContext?.emit({
      type: "message",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: {
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "message",
        actor: { kind: "user", actorId: "user", adapterData: {} },
        text: "hello",
        adapterData: {},
        attachments: [],
      },
    });

    expect(errors).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      chatLogEvents.eventHandlerFailure,
      expect.objectContaining({
        chatId: "alpha",
        eventType: "message",
        error: expect.objectContaining({ message: "handler boom" }),
      }),
    );
  });

  test("delivers adapter-emitted message and command events", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const messages: string[] = [];
    const namedCommands: string[] = [];
    const allCommands: string[] = [];

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart: (context) => {
            startContext = context;
          },
        }),
      },
      commands,
    });

    chat.on("message", (event) => {
      messages.push(event.message.text);
    });
    chat.on("command", "start", (event) => {
      namedCommands.push(event.command.name);
    });
    chat.on("command", (event) => {
      allCommands.push(event.command.name);
    });

    expect((await chat.start()).isOk()).toBe(true);
    startContext?.emit({
      type: "message",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: {
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "message",
        actor: { kind: "user", actorId: "user", adapterData: {} },
        text: "hello",
        adapterData: {},
        attachments: [],
      },
    });
    startContext?.emit({
      type: "command",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      command: { name: "start", options: {} },
    });

    expect(messages).toEqual(["hello"]);
    expect(namedCommands).toEqual(["start"]);
    expect(allCommands).toEqual(["start"]);
  });

  test("delivers received attachments and opens bytes lazily", async () => {
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    let attachment: ChatAttachment | undefined;
    let openCount = 0;
    const handles = { opens: [], starts: [], closes: [] } satisfies Handles;
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart(context) {
            startContext = context;
          },
        }),
      },
      commands,
    });

    chat.on("message", (event) => {
      attachment = event.message.attachments[0];
    });

    expect((await chat.start()).isOk()).toBe(true);
    startContext?.emit({
      type: "message",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: {
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "message",
        actor: { kind: "user", actorId: "user", adapterData: {} },
        text: "see attached",
        adapterData: {},
        attachments: [
          {
            attachmentId: "file-1",
            kind: "image",
            disposition: "inline",
            filename: "cat.png",
            mimeType: "image/png",
            sizeBytes: 3,
            adapterData: {},
            open: async (input) => {
              openCount += 1;
              expect(input?.maxBytes).toBe(1024);
              return Result.ok({
                chunks: bytesChunks([new Uint8Array([1, 2, 3])]),
                filename: "cat.png",
                mimeType: "image/png",
                sizeBytes: 3,
              });
            },
          },
        ],
      },
    });

    expect(openCount).toBe(0);
    expect(attachment?.filename).toBe("cat.png");

    const opened = await attachment?.open({ maxBytes: 1024 });
    expect(opened?.isOk()).toBe(true);
    const chunks: Uint8Array[] = [];
    if (opened?.isOk()) {
      for await (const chunk of opened.value.chunks) {
        chunks.push(chunk);
      }
    }
    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);
    expect(openCount).toBe(1);
  });

  test("wraps thrown adapter open failures", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles, throwOnOpen: new Error("boom") }),
      },
      commands,
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error).toBeInstanceOf(ChatAdapterOpenError);
      if (ChatAdapterOpenError.is(started.error)) {
        expect(started.error.message).toContain("boom");
      }
    }
  });

  test("wraps thrown adapter start failures and cleans opened runtimes", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles }),
        beta: createRuntimeAdapter({ id: "beta", handles, throwOnStart: new Error("boom") }),
      },
      commands,
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    expect(handles.closes).toEqual(["alpha", "beta"]);
    if (started.isErr()) {
      expect(started.error).toBeInstanceOf(ChatAdapterStartError);
      if (ChatAdapterStartError.is(started.error)) {
        expect(started.error.message).toContain("boom");
      }
    }
  });

  test("logs startup cleanup close failures as warnings", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const logger = createMockLogger();
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          closeError: new Error("cleanup failed"),
        }),
        beta: createRuntimeAdapter({ id: "beta", handles, throwOnStart: new Error("boom") }),
      },
      commands,
      logger,
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    expect(handles.closes).toEqual(["alpha", "beta"]);
    expect(logger.warn).toHaveBeenCalledWith(
      chatLogEvents.adapterCloseFailure,
      expect.objectContaining({
        chatId: "alpha",
        operation: "closeAdapter",
        reason: "startup_cleanup",
        error: expect.objectContaining({
          cause: expect.objectContaining({ message: "cleanup failed" }),
        }),
      }),
    );
  });

  test("routes synchronous handler throws to error events", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const errors: unknown[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart: (context) => {
            startContext = context;
          },
        }),
      },
      commands,
    });

    chat.on("message", () => {
      throw new Error("handler failed");
    });
    chat.on("error", (event) => {
      errors.push(event.error);
    });

    expect((await chat.start()).isOk()).toBe(true);
    startContext?.emit({
      type: "message",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: {
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "message",
        actor: { kind: "user", actorId: "user", adapterData: {} },
        text: "hello",
        adapterData: {},
        attachments: [],
      },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  test("returns lifecycle errors for invalid transitions", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha", handles }) },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const secondStart = await chat.start();

    expect(secondStart.isErr()).toBe(true);
    if (secondStart.isErr()) {
      expect(secondStart.error).toBeInstanceOf(ChatLifecycleError);
      if (ChatLifecycleError.is(secondStart.error)) {
        expect(secondStart.error.operation).toBe("start");
      }
    }
  });

  test("sends messages through the selected started adapter", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const adapterOptions: unknown[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onSend: (input) => {
            adapterOptions.push(input.adapterOptions);
          },
        }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const sent = await chat.sendMessage({
      chatId: "alpha",
      conversationId: "conversation",
      text: "hello",
    });

    expect(sent.isOk()).toBe(true);
    expect(adapterOptions).toEqual([{}]);
    if (sent.isOk()) {
      expect(sent.value.messageId).toBe("alpha-message");
      expect(sent.value.adapterData).toEqual({});
    }
  });

  test("sends typed action messages and binds action response helpers", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const sentActions: unknown[] = [];
    const responses: string[] = [];
    const actions = defineChatActions({
      deployment: defineChatAction({
        values: {
          approve: actionValue<{ readonly deploymentId: string }>(),
          reject: actionValue<{ readonly deploymentId: string; readonly reason?: string }>(),
        },
      }),
    });
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart: (context) => {
            startContext = context;
          },
          onSendAction: (input) => {
            sentActions.push(input);
          },
          onRespondToAction: (input) => {
            responses.push(`${input.interactionId}:${input.response.kind}`);
          },
        }),
      },
      commands,
      actions,
    });

    chat.on("action", "deployment", async (event) => {
      if (event.value === "approve") {
        expect(event.payload.deploymentId).toBe("dep-1");
        await event.ack({ text: "approved" });
        await event.update({ message: "Approved ✅", buttons: [] });
      }
    });

    expect((await chat.start()).isOk()).toBe(true);
    const sent = await chat.sendAction({
      chatId: "alpha",
      conversationId: "conversation",
      text: "Deploy?",
      buttons: [
        [
          {
            id: "approve",
            label: "Approve",
            actionId: "deployment",
            value: "approve",
            payload: { deploymentId: "dep-1" },
          },
        ],
      ],
    });

    expect(sent.isOk()).toBe(true);
    expect(sentActions).toHaveLength(1);

    startContext?.emit({
      type: "action",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: { chatId: "alpha", conversationId: "conversation", messageId: "message" },
      interactionId: "interaction-1",
      actionId: "deployment",
      value: "approve",
      payload: { deploymentId: "dep-1" },
    });

    await vi.waitFor(() => {
      expect(responses).toEqual(["interaction-1:ack", "interaction-1:update"]);
    });
  });

  test("sendMessage returns typed errors for unknown ids, lifecycle, and adapter failures", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles, sendError: new Error("send failed") }),
      },
      commands,
    });

    const beforeStart = await chat.sendMessage({
      chatId: "alpha",
      conversationId: "conversation",
      text: "hello",
    });
    expect(beforeStart.isErr()).toBe(true);
    if (beforeStart.isErr()) {
      expect(beforeStart.error).toBeInstanceOf(ChatLifecycleError);
    }

    expect((await chat.start()).isOk()).toBe(true);

    const unknown = await chat.sendMessage({
      chatId: "missing",
      conversationId: "conversation",
      text: "hello",
    } as never);
    expect(unknown.isErr()).toBe(true);
    if (unknown.isErr()) {
      expect(unknown.error).toBeInstanceOf(UnknownChatAdapterError);
    }

    const failed = await chat.sendMessage({
      chatId: "alpha",
      conversationId: "conversation",
      text: "hello",
    });
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) {
      expect(failed.error).toBeInstanceOf(ChatSendMessageError);
    }
  });

  test("reply uses native adapter reply when available", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const sends: string[] = [];
    const replies: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          nativeReply: true,
          onSend: (input) => {
            sends.push(input.text);
          },
          onReply: (input) => {
            replies.push(`${input.message?.messageId}:${input.mode}:${input.text}`);
          },
        }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const replied = await chat.reply({
      chatId: "alpha",
      conversationId: "conversation",
      messageId: "original",
      text: "hello",
      mode: "quote",
    });

    expect(replied.isOk()).toBe(true);
    expect(sends).toEqual([]);
    expect(replies).toEqual(["original:quote:hello"]);
    if (replied.isOk()) {
      expect(replied.value.messageId).toBe("alpha-reply");
    }
  });

  test("reply falls back to sendMessage for auto and conversation modes", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const sends: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onSend: (input) => {
            sends.push(`${input.conversationId}:${input.text}`);
          },
        }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const auto = await chat.reply({
      chatId: "alpha",
      conversationId: "conversation",
      messageId: "original",
      text: "auto",
    });
    const conversation = await chat.reply({
      chatId: "alpha",
      conversationId: "conversation",
      messageId: "original",
      text: "conversation",
      mode: "conversation",
    });

    expect(auto.isOk()).toBe(true);
    expect(conversation.isOk()).toBe(true);
    expect(sends).toEqual(["conversation:auto", "conversation:conversation"]);
  });

  test("reply returns unsupported errors for strict modes without native reply", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha", handles }) },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const replied = await chat.reply({
      chatId: "alpha",
      conversationId: "conversation",
      messageId: "original",
      text: "hello",
      mode: "thread",
    });

    expect(replied.isErr()).toBe(true);
    if (replied.isErr()) {
      expect(replied.error).toBeInstanceOf(UnsupportedChatOperationError);
    }
  });

  test("event.reply targets the original message conversation", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const sends: string[] = [];
    let resolveReply!: (value: unknown) => void;
    const replyHandled = new Promise((resolve) => {
      resolveReply = resolve;
    });
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart: (context) => {
            startContext = context;
          },
          onSend: (input) => {
            sends.push(`${input.conversationId}:${input.text}`);
          },
        }),
      },
      commands,
    });

    chat.on("message", async (event) => {
      const result = await event.reply("handled", { mode: "conversation" });
      resolveReply(result);
    });

    expect((await chat.start()).isOk()).toBe(true);
    startContext?.emit({
      type: "message",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: {
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "original",
        actor: { kind: "user", actorId: "user", adapterData: {} },
        text: "incoming",
        adapterData: {},
        attachments: [],
      },
    });

    await replyHandled;
    expect(sends).toEqual(["conversation:handled"]);
  });

  test("streamMessage uses adapter streaming when available", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const streams: string[] = [];
    const sends: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          nativeStream: true,
          onSend: (input) => {
            sends.push(input.text);
          },
          onStreamMessage: (input) => {
            streams.push(input.content.chunks === undefined ? "missing" : "present");
          },
        }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const streamed = await chat.streamMessage({
      chatId: "alpha",
      conversationId: "conversation",
      content: { chunks: textChunks(["hello"]), format: "markdown" },
      fallback: "send-message",
    });

    expect(streamed.isOk()).toBe(true);
    expect(streams).toEqual(["present"]);
    expect(sends).toEqual([]);
    if (streamed.isOk()) {
      expect(streamed.value.messageId).toBe("alpha-stream");
      expect(streamed.value.format).toBe("markdown");
    }
  });

  test("streamMessage falls back to sendMessage when unsupported", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const sends: string[] = [];
    const logger = createMockLogger();
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onSend: (input) => {
            sends.push(input.text);
          },
        }),
      },
      commands,
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const streamed = await chat.streamMessage({
      chatId: "alpha",
      conversationId: "conversation",
      content: { chunks: textChunks(["hel", "lo"]) },
      fallback: "send-message",
    });

    expect(streamed.isOk()).toBe(true);
    expect(sends).toEqual(["hello"]);
    expect(logger.info).toHaveBeenCalledWith(
      chatLogEvents.operationFallback,
      expect.objectContaining({
        chatId: "alpha",
        operation: "streamMessage",
        reason: "adapter_stream_message_missing",
      }),
    );
  });

  test("streamMessage can require adapter streaming", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha", handles }) },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const streamed = await chat.streamMessage({
      chatId: "alpha",
      conversationId: "conversation",
      content: { chunks: textChunks(["hello"]) },
      fallback: "error",
    } as never);

    expect(streamed.isErr()).toBe(true);
    if (streamed.isErr()) {
      expect(streamed.error).toBeInstanceOf(UnsupportedChatOperationError);
    }
  });

  test("typingIndicator sends one native typing pulse", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const typing: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          nativeTyping: true,
          onTyping: (input) => {
            typing.push(
              `${input.conversationId}:${input.adapterOptions === undefined ? "missing" : "ok"}`,
            );
          },
        }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const indicated = await chat.typingIndicator({
      chatId: "alpha",
      conversationId: "conversation",
    });

    expect(indicated.isOk()).toBe(true);
    expect(typing).toEqual(["conversation:ok"]);
  });

  test("typingIndicator returns unsupported errors or ignored no-op handles", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const logger = createMockLogger();
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha", handles }) },
      commands,
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const unsupported = await chat.typingIndicator({
      chatId: "alpha",
      conversationId: "conversation",
    });
    const ignored = await chat.typingIndicator({
      chatId: "alpha",
      conversationId: "conversation",
      mode: "managed",
      fallback: "ignore",
    });

    expect(unsupported.isErr()).toBe(true);
    if (unsupported.isErr()) {
      expect(unsupported.error).toBeInstanceOf(UnsupportedChatOperationError);
    }
    expect(ignored.isOk()).toBe(true);
    if (ignored.isOk()) {
      ignored.value.stop();
    }
    expect(logger.info).toHaveBeenCalledWith(
      chatLogEvents.operationFallback,
      expect.objectContaining({
        chatId: "alpha",
        operation: "typingIndicator",
        reason: "adapter_send_typing_missing",
        result: "ignored",
      }),
    );
  });

  test("managed typingIndicator refreshes until stopped", async () => {
    vi.useFakeTimers();
    try {
      const handles = { opens: [], starts: [], closes: [] };
      const typing: string[] = [];
      const chat = createChat({
        adapters: {
          alpha: createRuntimeAdapter({
            id: "alpha",
            handles,
            nativeTyping: true,
            onTyping: (input) => {
              typing.push(input.conversationId);
            },
          }),
        },
        commands,
      });

      expect((await chat.start()).isOk()).toBe(true);
      const indicated = await chat.typingIndicator({
        chatId: "alpha",
        conversationId: "conversation",
        mode: "managed",
        refreshIntervalMs: 10,
        timeoutMs: 100,
      });

      expect(indicated.isOk()).toBe(true);
      expect(typing).toEqual(["conversation"]);
      await vi.advanceTimersByTimeAsync(10);
      expect(typing).toEqual(["conversation", "conversation"]);

      if (indicated.isOk()) {
        indicated.value.stop();
      }
      await vi.advanceTimersByTimeAsync(50);
      expect(typing).toEqual(["conversation", "conversation"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("typingIndicator wraps adapter failures", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          nativeTyping: true,
          typingError: new Error("typing failed"),
        }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const indicated = await chat.typingIndicator({
      chatId: "alpha",
      conversationId: "conversation",
    });

    expect(indicated.isErr()).toBe(true);
    if (indicated.isErr()) {
      expect(indicated.error).toBeInstanceOf(ChatTypingIndicatorError);
    }
  });

  test("event.typingIndicator targets the original message conversation", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const typing: string[] = [];
    let resolveTyping!: (value: unknown) => void;
    const typingHandled = new Promise((resolve) => {
      resolveTyping = resolve;
    });
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          nativeTyping: true,
          onStart: (context) => {
            startContext = context;
          },
          onTyping: (input) => {
            typing.push(`${input.conversationId}:${input.message?.messageId}`);
          },
        }),
      },
      commands,
    });

    chat.on("message", async (event) => {
      const result = await event.typingIndicator();
      resolveTyping(result);
    });

    expect((await chat.start()).isOk()).toBe(true);
    startContext?.emit({
      type: "message",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: {
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "original",
        actor: { kind: "user", actorId: "user", adapterData: {} },
        text: "incoming",
        adapterData: {},
        attachments: [],
      },
    });

    await typingHandled;
    expect(typing).toEqual(["conversation:original"]);
  });

  test("streamReply falls back to reply and event.replyStream targets the original message", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const logger = createMockLogger();
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const replies: string[] = [];
    let resolveReply!: (value: unknown) => void;
    const replyHandled = new Promise((resolve) => {
      resolveReply = resolve;
    });
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          nativeReply: true,
          onStart: (context) => {
            startContext = context;
          },
          onReply: (input) => {
            replies.push(`${input.message?.messageId}:${input.mode}:${input.text}`);
          },
        }),
      },
      commands,
      logger,
    });

    chat.on("message", async (event) => {
      const result = await event.replyStream(
        { chunks: textChunks(["stre", "amed"]) },
        { mode: "quote", fallback: "send-message" },
      );
      resolveReply(result);
    });

    expect((await chat.start()).isOk()).toBe(true);
    startContext?.emit({
      type: "message",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: {
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "original",
        actor: { kind: "user", actorId: "user", adapterData: {} },
        text: "incoming",
        adapterData: {},
        attachments: [],
      },
    });

    await replyHandled;
    expect(replies).toEqual(["original:quote:streamed"]);
    expect(logger.info).toHaveBeenCalledWith(
      chatLogEvents.operationFallback,
      expect.objectContaining({
        chatId: "alpha",
        operation: "streamReply",
        messageId: "original",
        reason: "adapter_stream_reply_missing",
      }),
    );
  });

  test("close attempts every opened runtime and aggregates failures", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles, closeError: new Error("boom") }),
        beta: createRuntimeAdapter({ id: "beta", handles }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const closed = await chat.close();

    expect(handles.closes).toEqual(["alpha", "beta"]);
    expect(closed.isErr()).toBe(true);
    if (closed.isErr()) {
      expect(closed.error).toBeInstanceOf(ChatCloseError);
      if (ChatCloseError.is(closed.error)) {
        expect(closed.error.failures).toHaveLength(1);
        expect(closed.error.failures[0]?.chatId).toBe("alpha");
      }
    }
  });
});
