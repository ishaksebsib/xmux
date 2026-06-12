import { describe, expect, test } from "vitest";
import {
  ChatAdapterOpenError,
  ChatAdapterStartError,
  ChatCloseError,
  ChatLifecycleError,
  ChatReplyError,
  ChatSendMessageError,
  ChatStreamMessageError,
  UnknownChatAdapterError,
  UnsupportedChatOperationError,
  createChat,
} from "../src";
import { ensureCanStart, ensureStarted } from "../src/lifecycle";
import { commands, createHandles, createTestChatAdapter } from "./fixtures/test-adapter";

describe("chat-core errors", () => {
  test("wrapped adapter errors preserve original causes", () => {
    const cause = new Error("sdk failed");
    const errors = [
      new ChatAdapterOpenError({ chatId: "discord", cause }),
      new ChatAdapterStartError({ chatId: "discord", cause }),
      new ChatSendMessageError({ chatId: "discord", cause }),
      new ChatReplyError({ chatId: "discord", cause }),
      new ChatStreamMessageError({ chatId: "discord", cause }),
    ];

    for (const error of errors) {
      expect(error.cause).toBe(cause);
      expect(error.message).toContain("sdk failed");
    }
  });

  test("string and non-Error causes are serialized meaningfully in messages", () => {
    const stringCause = new ChatAdapterOpenError({ chatId: "alpha", cause: "boom" });
    const objectCause = new ChatAdapterOpenError({ chatId: "alpha", cause: { reason: "bad" } });

    expect(stringCause.message).toContain("boom");
    expect(objectCause.message).toContain("[object Object]");
  });

  test("lifecycle errors have deterministic operation and state metadata", () => {
    const start = ensureCanStart({ status: "started" });
    const send = ensureStarted({ state: { status: "created" }, operation: "sendMessage" });

    expect(start.isErr()).toBe(true);
    if (start.isErr()) {
      expect(start.error).toBeInstanceOf(ChatLifecycleError);
      expect(start.error.operation).toBe("start");
      expect(start.error.currentState).toBe("started");
      expect(start.error.expectedState).toBe("created");
    }
    expect(send.isErr()).toBe(true);
    if (send.isErr()) {
      expect(send.error.operation).toBe("sendMessage");
      expect(send.error.currentState).toBe("created");
      expect(send.error.expectedState).toBe("started");
    }
  });

  test("unknown chat adapter errors are stable", async () => {
    const chat = createChat({
      adapters: { alpha: createTestChatAdapter({ id: "alpha" }) },
      commands,
    });

    const sent = await chat.sendMessage({
      chatId: "missing",
      conversationId: "c",
      text: "hello",
    } as never);

    expect(sent.isErr()).toBe(true);
    if (sent.isErr()) {
      expect(sent.error).toBeInstanceOf(UnknownChatAdapterError);
      if (UnknownChatAdapterError.is(sent.error)) {
        expect(sent.error.chatId).toBe("missing");
        expect(sent.error.availableChatIds).toEqual(["alpha"]);
      }
    }
  });

  test("unsupported operation errors are stable", () => {
    const error = new UnsupportedChatOperationError({
      chatId: "alpha",
      operation: "reply",
      mode: "thread",
    });

    expect(error.chatId).toBe("alpha");
    expect(error.operation).toBe("reply");
    expect(error.mode).toBe("thread");
    expect(error.message).toContain("reply (thread)");
  });

  test("aggregate close errors preserve individual failures", async () => {
    const handles = createHandles();
    const alphaCause = new Error("alpha close failed");
    const betaCause = "beta close failed";
    const chat = createChat({
      adapters: {
        alpha: createTestChatAdapter({ id: "alpha", handles, closeError: alphaCause }),
        beta: createTestChatAdapter({ id: "beta", handles, closeError: betaCause }),
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
        expect(closed.error.failures).toEqual([
          { chatId: "alpha", cause: alphaCause },
          { chatId: "beta", cause: betaCause },
        ]);
      }
    }
  });
});
