import { describe, expect, test, vi } from "vitest";
import {
  ChatActionResponseError,
  ChatSendActionError,
  ChatUpdateActionError,
  actionValue,
  createChat,
  defineChatAction,
  defineChatActions,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "../src";
import { commands, createRuntimeAdapter } from "./fixtures/test-adapter";

const actions = defineChatActions({
  deployment: defineChatAction({
    values: {
      approve: actionValue<{ readonly deploymentId: string }>(),
      reject: actionValue<{ readonly deploymentId: string; readonly reason?: string }>(),
    },
  }),
});

describe("chat actions", () => {
  test("sends typed action messages and binds action response helpers", async () => {
    let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
    const sentActions: unknown[] = [];
    const responses: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          onStart: (context) => {
            startContext = context;
          },
          onSendAction: (input) => {
            sentActions.push(input);
          },
          onRespondToAction: (input) => {
            responses.push(`${input.interactionId}:${input.response.kind}`);
          },
        }),
      },
      commands,
      actions,
    });

    chat.on("action", "deployment", async (event) => {
      if (event.value === "approve") {
        expect(event.payload.deploymentId).toBe("dep-1");
        await event.ack({ text: "approved" });
        await event.update({ message: "Approved ✅", buttons: [] });
      }
    });

    expect((await chat.start()).isOk()).toBe(true);
    const sent = await chat.sendAction({
      chatId: "alpha",
      conversationId: "conversation",
      text: "Deploy?",
      buttons: [
        [
          {
            id: "approve",
            label: "Approve",
            actionId: "deployment",
            value: "approve",
            payload: { deploymentId: "dep-1" },
          },
        ],
      ],
    });

    expect(sent.isOk()).toBe(true);
    expect(sentActions).toHaveLength(1);

    emitDeploymentAction(startContext);

    await vi.waitFor(() => {
      expect(responses).toEqual(["interaction-1:ack", "interaction-1:update"]);
    });
  });

  test("updateAction preserves adapter runtime this binding", async () => {
    const updates: unknown[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          onUpdateAction: (input) => {
            updates.push(input);
          },
        }),
      },
      commands,
      actions,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const updated = await chat.updateAction({
      chatId: "alpha",
      conversationId: "conversation",
      messageId: "action-message",
      text: "Ready",
      buttons: [],
    });

    expect(updated.isOk()).toBe(true);
    if (updated.isOk()) expect(updated.value.messageId).toBe("action-message");
    expect(updates).toHaveLength(1);
  });

  test("updateAction wraps adapter returned and thrown failures", async () => {
    async function exercise(adapterFailure: {
      updateActionError?: unknown;
      updateActionThrow?: unknown;
    }) {
      const chat = createChat({
        adapters: { alpha: createRuntimeAdapter({ id: "alpha", ...adapterFailure }) },
        commands,
        actions,
      });

      expect((await chat.start()).isOk()).toBe(true);
      const updated = await chat.updateAction({
        chatId: "alpha",
        conversationId: "conversation",
        messageId: "action-message",
        text: "Ready",
        buttons: [],
      });

      expect(updated.isErr()).toBe(true);
      if (updated.isErr()) expect(updated.error).toBeInstanceOf(ChatUpdateActionError);
    }

    await exercise({ updateActionError: new Error("update action failed") });
    await exercise({ updateActionThrow: new Error("update action threw") });
  });

  test("sendAction wraps adapter returned and thrown failures", async () => {
    async function exercise(adapterFailure: {
      sendActionError?: unknown;
      sendActionThrow?: unknown;
    }) {
      const chat = createChat({
        adapters: { alpha: createRuntimeAdapter({ id: "alpha", ...adapterFailure }) },
        commands,
        actions,
      });

      expect((await chat.start()).isOk()).toBe(true);
      const sent = await chat.sendAction({
        chatId: "alpha",
        conversationId: "conversation",
        text: "Deploy?",
        buttons: [],
      });

      expect(sent.isErr()).toBe(true);
      if (sent.isErr()) expect(sent.error).toBeInstanceOf(ChatSendActionError);
    }

    await exercise({ sendActionError: new Error("send action failed") });
    await exercise({ sendActionThrow: new Error("send action threw") });
  });

  test("respondToAction wraps adapter returned and thrown failures", async () => {
    async function exercise(adapterFailure: {
      respondToActionError?: unknown;
      respondToActionThrow?: unknown;
    }) {
      let startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined;
      const errors: unknown[] = [];
      const chat = createChat({
        adapters: {
          alpha: createRuntimeAdapter({
            id: "alpha",
            ...adapterFailure,
            onStart: (context) => {
              startContext = context;
            },
          }),
        },
        commands,
        actions,
      });

      chat.on("action", "deployment", async (event) => {
        const result = await event.ack({ text: "approved" });
        if (result.isErr()) errors.push(result.error);
      });

      expect((await chat.start()).isOk()).toBe(true);
      emitDeploymentAction(startContext);

      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(errors[0]).toBeInstanceOf(ChatActionResponseError);
    }

    await exercise({ respondToActionError: new Error("response failed") });
    await exercise({ respondToActionThrow: new Error("response threw") });
  });
});

function emitDeploymentAction(
  startContext: ChatAdapterStartContext<ChatCommandRegistry, "alpha"> | undefined,
) {
  startContext?.emit({
    type: "action",
    chatId: "alpha",
    conversation: { chatId: "alpha", conversationId: "conversation" },
    message: { chatId: "alpha", conversationId: "conversation", messageId: "message" },
    interactionId: "interaction-1",
    actionId: "deployment",
    value: "approve",
    payload: { deploymentId: "dep-1" },
  });
}
