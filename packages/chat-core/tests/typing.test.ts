import { describe, expect, test, vi } from "vitest";
import {
  ChatTypingIndicatorError,
  UnsupportedChatOperationError,
  chatLogEvents,
  createChat,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "../src";
import {
  commands,
  createMockLogger,
  createRuntimeAdapter,
} from "./fixtures/test-adapter";

describe("chat typing", () => {
  test("typingIndicator sends one native typing pulse", async () => {
    const typing: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
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
    const logger = createMockLogger();
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha" }) },
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
    if (unsupported.isErr()) expect(unsupported.error).toBeInstanceOf(UnsupportedChatOperationError);
    expect(ignored.isOk()).toBe(true);
    if (ignored.isOk()) ignored.value.stop();
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
      const typing: string[] = [];
      const chat = createChat({
        adapters: {
          alpha: createRuntimeAdapter({
            id: "alpha",
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

      if (indicated.isOk()) indicated.value.stop();
      await vi.advanceTimersByTimeAsync(50);
      expect(typing).toEqual(["conversation", "conversation"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("typingIndicator wraps adapter failures", async () => {
    async function exercise(adapterFailure: { typingError?: unknown; throwOnTyping?: unknown }) {
      const chat = createChat({
        adapters: {
          alpha: createRuntimeAdapter({ id: "alpha", nativeTyping: true, ...adapterFailure }),
        },
        commands,
      });

      expect((await chat.start()).isOk()).toBe(true);
      const indicated = await chat.typingIndicator({
        chatId: "alpha",
        conversationId: "conversation",
      });

      expect(indicated.isErr()).toBe(true);
      if (indicated.isErr()) expect(indicated.error).toBeInstanceOf(ChatTypingIndicatorError);
    }

    await exercise({ typingError: new Error("typing failed") });
    await exercise({ throwOnTyping: new Error("typing threw") });
  });

  test("event.typingIndicator targets the original message conversation", async () => {
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
});
