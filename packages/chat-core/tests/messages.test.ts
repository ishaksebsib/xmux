import { describe, expect, test } from "vitest";
import {
  ChatLifecycleError,
  ChatSendMessageError,
  UnknownChatAdapterError,
  createChat,
} from "../src";
import { commands, createRuntimeAdapter } from "./fixtures/test-adapter";

describe("chat messages", () => {
  test("sends messages through the selected started adapter", async () => {
    const adapterOptions: unknown[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
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

  test("sendMessage returns typed errors for unknown ids, lifecycle, and adapter returned failures", async () => {
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", sendError: new Error("send failed") }),
      },
      commands,
    });

    const beforeStart = await chat.sendMessage({
      chatId: "alpha",
      conversationId: "conversation",
      text: "hello",
    });
    expect(beforeStart.isErr()).toBe(true);
    if (beforeStart.isErr()) expect(beforeStart.error).toBeInstanceOf(ChatLifecycleError);

    expect((await chat.start()).isOk()).toBe(true);

    const unknown = await chat.sendMessage({
      chatId: "missing",
      conversationId: "conversation",
      text: "hello",
    } as never);
    expect(unknown.isErr()).toBe(true);
    if (unknown.isErr()) expect(unknown.error).toBeInstanceOf(UnknownChatAdapterError);

    const failed = await chat.sendMessage({
      chatId: "alpha",
      conversationId: "conversation",
      text: "hello",
    });
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error).toBeInstanceOf(ChatSendMessageError);
  });

  test("sendMessage wraps adapter throws", async () => {
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha", throwOnSend: new Error("boom") }) },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const failed = await chat.sendMessage({
      chatId: "alpha",
      conversationId: "conversation",
      text: "hello",
    });

    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error).toBeInstanceOf(ChatSendMessageError);
  });
});
