import { describe, expect, test } from "vitest";
import {
  ChatReplyError,
  ChatSendMessageError,
  UnsupportedChatOperationError,
  createChat,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "../src";
import { commands, createRuntimeAdapter } from "./fixtures/test-adapter";

describe("chat replies", () => {
  test("reply uses native adapter reply when available", async () => {
    const sends: string[] = [];
    const replies: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          nativeReply: true,
          onSend: (input) => sends.push(input.text),
          onReply: (input) =>
            replies.push(`${input.message?.messageId}:${input.mode}:${input.text}`),
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
    if (replied.isOk()) expect(replied.value.messageId).toBe("alpha-reply");
  });

  test("reply falls back to sendMessage for auto and conversation modes", async () => {
    const sends: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          onSend: (input) => sends.push(`${input.conversationId}:${input.text}`),
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
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha" }) },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    for (const mode of ["quote", "thread"] as const) {
      const replied = await chat.reply({
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "original",
        text: "hello",
        mode,
      });

      expect(replied.isErr()).toBe(true);
      if (replied.isErr()) expect(replied.error).toBeInstanceOf(UnsupportedChatOperationError);
    }
  });

  test("event.reply targets the original message conversation", async () => {
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
          onStart: (context) => {
            startContext = context;
          },
          onSend: (input) => sends.push(`${input.conversationId}:${input.text}`),
        }),
      },
      commands,
    });

    chat.on("message", async (event) => {
      const result = await event.reply("handled", { mode: "conversation" });
      resolveReply(result);
    });

    expect((await chat.start()).isOk()).toBe(true);
    emitMessage(startContext);

    await replyHandled;
    expect(sends).toEqual(["conversation:handled"]);
  });

  test("reply wraps adapter returned and thrown failures", async () => {
    async function exercise(adapterFailure: { replyError?: unknown; replyThrow?: unknown }) {
      const chat = createChat({
        adapters: {
          alpha: createRuntimeAdapter({ id: "alpha", nativeReply: true, ...adapterFailure }),
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

      expect(replied.isErr()).toBe(true);
      if (replied.isErr()) expect(replied.error).toBeInstanceOf(ChatReplyError);
    }

    await exercise({ replyError: new Error("reply failed") });
    await exercise({ replyThrow: new Error("reply threw") });
  });

  test("fallback send failures are reported as send-message failures", async () => {
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", sendError: new Error("send failed") }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const replied = await chat.reply({
      chatId: "alpha",
      conversationId: "conversation",
      messageId: "original",
      text: "hello",
    });

    expect(replied.isErr()).toBe(true);
    if (replied.isErr()) expect(replied.error).toBeInstanceOf(ChatSendMessageError);
  });
});

function emitMessage(
  startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined,
) {
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
