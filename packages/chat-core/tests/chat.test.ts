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
  createChat,
  defineChatAdapter,
  defineChatCommand,
  defineChatCommands,
  type ChatAdapterStartContext,
  type ChatAdapterStreamMessageInput,
  type ChatCommandRegistry,
  type ChatAdapterStreamReplyInput,
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
    attachments: false,
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
    attachments: false,
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
    attachments: false,
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
  readonly onStart?: (context: ChatAdapterStartContext<ChatCommandRegistry, TId>) => void;
  readonly onSend?: (input: {
    readonly adapterOptions: Record<never, never>;
    readonly conversationId: string;
    readonly text: string;
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
    async open() {
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

  test("routes diagnostics and supports unsubscribe", async () => {
    const handles = { opens: [], starts: [], closes: [] };
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const diagnostics: string[] = [];
    const messages: string[] = [];

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart: (context) => {
            startContext = context;
            context.diagnostic({ level: "warn", code: "TEST", message: "diagnostic" });
          },
        }),
      },
      commands,
    });

    chat.on("diagnostic", (event) => {
      diagnostics.push(`${event.chatId}:${event.code}`);
    });
    const unsubscribe = chat.on("message", (event) => {
      messages.push(event.message.text);
    });

    const started = await chat.start();
    expect(started.isOk()).toBe(true);
    expect(diagnostics).toEqual(["alpha:TEST"]);

    unsubscribe();
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
      },
    });

    expect(messages).toEqual([]);
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
    const diagnostics: string[] = [];
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
    });

    chat.on("diagnostic", (event) => {
      diagnostics.push(event.code);
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
    expect(diagnostics).toContain("CHAT_STREAM_FALLBACK_TO_SEND_MESSAGE");
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
    const diagnostics: string[] = [];
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha", handles }) },
      commands,
    });

    chat.on("diagnostic", (event) => {
      diagnostics.push(event.code);
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
    expect(diagnostics).toContain("CHAT_TYPING_INDICATOR_UNSUPPORTED_IGNORED");
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
      },
    });

    await typingHandled;
    expect(typing).toEqual(["conversation:original"]);
  });

  test("streamReply falls back to reply and event.replyStream targets the original message", async () => {
    const handles = { opens: [], starts: [], closes: [] };
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
      },
    });

    await replyHandled;
    expect(replies).toEqual(["original:quote:streamed"]);
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
