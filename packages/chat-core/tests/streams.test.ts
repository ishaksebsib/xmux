import { describe, expect, test } from "vitest";
import {
  ChatStreamMessageError,
  ChatStreamReplyError,
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
  textChunks,
} from "./fixtures/test-adapter";

describe("chat streams", () => {
  test("streamMessage uses adapter streaming when available", async () => {
    const streams: string[] = [];
    const sends: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          nativeStream: true,
          onSend: (input) => sends.push(input.text),
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
    const sends: string[] = [];
    const logger = createMockLogger();
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          onSend: (input) => sends.push(input.text),
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
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha" }) },
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
    if (streamed.isErr()) expect(streamed.error).toBeInstanceOf(UnsupportedChatOperationError);
  });

  test("streamMessage wraps adapter returned and thrown failures", async () => {
    async function exercise(adapterFailure: {
      streamMessageError?: unknown;
      streamMessageThrow?: unknown;
    }) {
      const chat = createChat({
        adapters: { alpha: createRuntimeAdapter({ id: "alpha", nativeStream: true, ...adapterFailure }) },
        commands,
      });

      expect((await chat.start()).isOk()).toBe(true);
      const streamed = await chat.streamMessage({
        chatId: "alpha",
        conversationId: "conversation",
        content: { chunks: textChunks(["hello"]) },
      });

      expect(streamed.isErr()).toBe(true);
      if (streamed.isErr()) expect(streamed.error).toBeInstanceOf(ChatStreamMessageError);
    }

    await exercise({ streamMessageError: new Error("stream failed") });
    await exercise({ streamMessageThrow: new Error("stream threw") });
  });

  test("streamReply falls back to reply and event.replyStream targets the original message", async () => {
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
          nativeReply: true,
          onStart: (context) => {
            startContext = context;
          },
          onReply: (input) => replies.push(`${input.message?.messageId}:${input.mode}:${input.text}`),
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
    emitMessage(startContext);

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

  test("streamReply wraps adapter returned and thrown failures", async () => {
    async function exercise(adapterFailure: { streamReplyError?: unknown; streamReplyThrow?: unknown }) {
      const chat = createChat({
        adapters: { alpha: createRuntimeAdapter({ id: "alpha", nativeStream: true, ...adapterFailure }) },
        commands,
      });

      expect((await chat.start()).isOk()).toBe(true);
      const streamed = await chat.streamReply({
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "original",
        content: { chunks: textChunks(["hello"]) },
      });

      expect(streamed.isErr()).toBe(true);
      if (streamed.isErr()) expect(streamed.error).toBeInstanceOf(ChatStreamReplyError);
    }

    await exercise({ streamReplyError: new Error("stream reply failed") });
    await exercise({ streamReplyThrow: new Error("stream reply threw") });
  });
});

function emitMessage(startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined) {
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
}
