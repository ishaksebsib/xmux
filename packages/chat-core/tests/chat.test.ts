import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  ChatCloseError,
  ChatLifecycleError,
  ChatSendMessageError,
  UnknownChatAdapterError,
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
  readonly sendError?: unknown;
  readonly throwOnSend?: unknown;
  readonly onStart?: (context: ChatAdapterStartContext<typeof commands, TId>) => void;
  readonly onSend?: (input: { readonly adapterOptions: Record<never, never> }) => void;
}) {
  return defineChatAdapter<TId, Record<never, never>, Record<never, never>>({
    id: args.id,
    async open() {
      args.handles.opens.push(args.id);

      return Result.ok({
        id: args.id,
        async start(context) {
          args.handles.starts.push(args.id);
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
