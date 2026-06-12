import { Result } from "better-result";
import { describe, expect, test, vi } from "vitest";
import {
  chatLogEvents,
  createChat,
  type ChatAdapterStartContext,
  type ChatAttachment,
  type ChatCommandRegistry,
} from "../src";
import {
  bytesChunks,
  commands,
  createMockLogger,
  createRuntimeAdapter,
  type Handles,
} from "./fixtures/test-adapter";

describe("chat events", () => {
  test("logs event handler failures", async () => {
    const logger = createMockLogger();
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const errors: unknown[] = [];

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
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
    emitMessage(startContext);

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
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const messages: string[] = [];
    const namedCommands: string[] = [];
    const allCommands: string[] = [];

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
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
    emitMessage(startContext);
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
      for await (const chunk of opened.value.chunks) chunks.push(chunk);
    }
    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);
    expect(openCount).toBe(1);
  });

  test("routes synchronous handler throws to error events", async () => {
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const errors: unknown[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
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
    emitMessage(startContext);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  test("routes async handler rejections to error events", async () => {
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const errors: unknown[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          onStart: (context) => {
            startContext = context;
          },
        }),
      },
      commands,
    });

    chat.on("message", async () => {
      throw new Error("handler rejected");
    });
    chat.on("error", (event) => {
      errors.push(event.error);
    });

    expect((await chat.start()).isOk()).toBe(true);
    emitMessage(startContext);

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBeInstanceOf(Error);
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
      messageId: "message",
      actor: { kind: "user", actorId: "user", adapterData: {} },
      text: "hello",
      adapterData: {},
      attachments: [],
    },
  });
}
