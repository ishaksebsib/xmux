import { describe, expect, test, vi } from "vitest";
import {
  actionValue,
  chatLogEvents,
  createChat,
  defineChatAction,
  defineChatActions,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "../src";
import { textChunks } from "./fixtures/collect";
import { createMockLogger, createThrowingLogger } from "./fixtures/logger";
import { commands, createTestChatAdapter } from "./fixtures/test-adapter";

describe("chat logging", () => {
  test("logs safe structured metadata with component, operation, ids, lengths, and results", async () => {
    const logger = createMockLogger();
    const chat = createChat({
      adapters: { alpha: createTestChatAdapter({ id: "alpha" }) },
      commands,
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    expect((await chat.sendMessage({ chatId: "alpha", conversationId: "conversation", text: "secret text" })).isOk()).toBe(true);
    expect((await chat.reply({ chatId: "alpha", conversationId: "conversation", messageId: "message", text: "reply secret" })).isOk()).toBe(true);

    expect(logger.debug).toHaveBeenCalledWith(
      chatLogEvents.startBegin,
      expect.objectContaining({ component: "@xmux/chat-core", operation: "start" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      chatLogEvents.operationBegin,
      expect.objectContaining({
        component: "@xmux/chat-core",
        chatId: "alpha",
        operation: "sendMessage",
        conversationId: "conversation",
        textLength: "secret text".length,
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      chatLogEvents.operationBegin,
      expect.objectContaining({
        component: "@xmux/chat-core",
        chatId: "alpha",
        operation: "reply",
        conversationId: "conversation",
        messageId: "message",
        textLength: "reply secret".length,
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      chatLogEvents.operationSuccess,
      expect.objectContaining({ operation: "sendMessage", result: "ok" }),
    );
  });

  test("does not log message text, stream chunks, action payloads, attachment bytes, or adapter secrets", async () => {
    const logger = createMockLogger();
    const actions = defineChatActions({
      deployment: defineChatAction({
        values: { approve: actionValue<{ readonly token: string }>() },
      }),
    });
    const chat = createChat({
      adapters: { alpha: createTestChatAdapter({ id: "alpha" }) },
      commands,
      actions,
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    await chat.sendMessage({ chatId: "alpha", conversationId: "conversation", text: "raw-message-secret" });
    await chat.streamMessage({ chatId: "alpha", conversationId: "conversation", content: { chunks: textChunks(["stream-secret"]) } });
    await chat.sendAction({
      chatId: "alpha",
      conversationId: "conversation",
      text: "action-secret-text",
      buttons: [[{ id: "approve", label: "Approve", actionId: "deployment", value: "approve", payload: { token: "payload-secret" } }]],
    });

    const logs = JSON.stringify([
      vi.mocked(logger.trace).mock.calls,
      vi.mocked(logger.debug).mock.calls,
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.error).mock.calls,
    ]);
    expect(logs).not.toContain("raw-message-secret");
    expect(logs).not.toContain("stream-secret");
    expect(logs).not.toContain("action-secret-text");
    expect(logs).not.toContain("payload-secret");
    expect(logs).not.toContain("attachment-bytes-secret");
    expect(logs).not.toContain("adapter-token-secret");
  });

  test("respondToAction logs only ids and response kind, not response text", async () => {
    const logger = createMockLogger();
    const actions = defineChatActions({
      deployment: defineChatAction({ values: { approve: actionValue() } }),
    });
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const chat = createChat({
      adapters: {
        alpha: createTestChatAdapter({
          id: "alpha",
          onStart: (context) => {
            startContext = context;
          },
        }),
      },
      commands,
      actions,
      logger,
    });
    const actionHandled = vi.fn();
    chat.on("action", "deployment", async (event) => {
      await event.ack({ text: "ack-secret" });
      actionHandled();
    });

    expect((await chat.start()).isOk()).toBe(true);
    startContext?.emit({
      type: "action",
      chatId: "alpha",
      conversation: { chatId: "alpha", conversationId: "conversation" },
      message: { chatId: "alpha", conversationId: "conversation", messageId: "message" },
      interactionId: "interaction",
      actionId: "deployment",
      value: "approve",
    });

    await vi.waitFor(() => expect(actionHandled).toHaveBeenCalledOnce());
    expect(logger.debug).toHaveBeenCalledWith(
      chatLogEvents.operationBegin,
      expect.objectContaining({
        operation: "respondToAction",
        conversationId: "conversation",
        messageId: "message",
        interactionId: "interaction",
        responseKind: "ack",
      }),
    );
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain("ack-secret");
  });

  test("logger failures do not affect chat operations", async () => {
    const logger = createThrowingLogger();
    const chat = createChat({
      adapters: { alpha: createTestChatAdapter({ id: "alpha" }) },
      commands,
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    expect((await chat.sendMessage({ chatId: "alpha", conversationId: "conversation", text: "hello" })).isOk()).toBe(true);
    expect((await chat.close()).isOk()).toBe(true);
  });
});
