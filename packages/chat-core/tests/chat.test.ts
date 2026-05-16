import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  ChatAdapterOpenError,
  ChatAdapterStartError,
  ChatCloseError,
  ChatLifecycleError,
  ChatSendMessageError,
  UnknownChatAdapterError,
  UnsupportedChatOperationError,
  createChat,
  defineChatAdapter,
  defineChatCommand,
  defineChatCommands,
  type ChatAdapterStartContext,
} from "../src";

const commands = defineChatCommands({
  start: defineChatCommand({ description: "Start" }),
});

type Handles = {
  readonly opens: string[];
  readonly starts: string[];
  readonly closes: string[];
};

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
  readonly replyError?: unknown;
  readonly throwOnReply?: unknown;
  readonly onStart?: (context: ChatAdapterStartContext<typeof commands, TId>) => void;
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
}) {
  return defineChatAdapter<TId, Record<never, never>, Record<never, never>>({
    id: args.id,
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
          args.onStart?.(context as unknown as ChatAdapterStartContext<typeof commands, TId>);
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
            seenCommands.push(context.commands.start.description);
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
    let startContext: ChatAdapterStartContext<typeof commands, "alpha"> | undefined;
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
    let startContext: ChatAdapterStartContext<typeof commands, "alpha"> | undefined;
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
    let startContext: ChatAdapterStartContext<typeof commands, "alpha"> | undefined;
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
    let startContext: ChatAdapterStartContext<typeof commands, "alpha"> | undefined;
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
