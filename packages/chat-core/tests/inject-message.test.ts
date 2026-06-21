import { describe, expect, test, vi } from "vitest";
import { Result } from "better-result";
import { createChat } from "../src";
import { commands, createRuntimeAdapter } from "./fixtures/test-adapter";

describe("chat.injectMessage", () => {
  test("injected messages receive bound reply and replyStream helpers", async () => {
    const replies: unknown[] = [];
    const streamReplies: unknown[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          nativeReply: true,
          nativeStream: true,
          onReply: (input) => replies.push(input),
          onStreamReply: (input) => streamReplies.push(input),
        }),
      },
      commands,
    });

    chat.on("message", async (event) => {
      await event.reply("reply text", { mode: "quote" });
      await event.replyStream(
        { chunks: toAsync([{ type: "completed", text: "stream text" }]), format: "plain" },
        { mode: "thread", fallback: "error" },
      );
    });

    expect((await chat.start()).isOk()).toBe(true);
    const injected = await chat.injectMessage({
      chatId: "alpha",
      conversationId: "conversation",
      messageId: "injected-1",
      actor: { kind: "user", actorId: "user-1", adapterData: {} },
      text: "hello",
      adapterData: {},
    });

    expect(injected.isOk()).toBe(true);
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    await vi.waitFor(() => expect(streamReplies).toHaveLength(1));
    expect(replies[0]).toMatchObject({ message: { messageId: "injected-1" }, text: "reply text", mode: "quote" });
    expect(streamReplies[0]).toMatchObject({ message: { messageId: "injected-1" }, mode: "thread" });
  });

  test("injected messages receive bound typingIndicator helper", async () => {
    const typing: unknown[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          nativeTyping: true,
          onTyping: (input) => typing.push(input),
        }),
      },
      commands,
    });

    chat.on("message", async (event) => {
      const result = await event.typingIndicator({ mode: "pulse" });
      expect(result.isOk()).toBe(true);
    });

    expect((await chat.start()).isOk()).toBe(true);
    const injected = await chat.injectMessage({
      chatId: "alpha",
      conversationId: "conversation",
      messageId: "injected-typing",
      actor: { kind: "user", actorId: "user-1", adapterData: {} },
      text: "hello",
      adapterData: {},
    });

    expect(injected.isOk()).toBe(true);
    await vi.waitFor(() => expect(typing).toHaveLength(1));
    expect(typing[0]).toMatchObject({ conversationId: "conversation", message: { messageId: "injected-typing" } });
  });
});

async function* toAsync<T>(values: readonly T[]): AsyncIterable<T> {
  yield* values;
}
