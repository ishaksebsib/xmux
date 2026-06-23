import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { createXmux } from "../src";

const capabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: false,
    markdown: true,
    attachments: { receive: false, send: false, download: false },
  },
} as const;

const conversation = { chatId: "telegram", conversationId: "conversation-1" } as const;

describe("/id command", () => {
  test("replies with the command sender chat user id", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux();

    emitCommand(idCommandEvent());
    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(
      [
        "**Your chat user id**",
        "",
        "- **Chat:** `telegram`",
        "- **User ID:** `user-1`",
        "- **Name:** Ishak",
      ].join("\n"),
    );

    await xmux.shutdown();
  });

  test("omits display name when the adapter does not provide one", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux();

    emitCommand(idCommandEvent({ displayName: undefined }));
    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(
      [
        "**Your chat user id**",
        "",
        "- **Chat:** `telegram`",
        "- **User ID:** `user-1`",
      ].join("\n"),
    );

    await xmux.shutdown();
  });

  test("reports when the adapter does not provide an actor id", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux();

    emitCommand(idCommandEvent({ actor: undefined }));
    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(
      [
        "**User id unavailable**",
        "",
        "This chat adapter did not provide a user id for this command.",
      ].join("\n"),
    );

    await xmux.shutdown();
  });
});

async function initializeXmux() {
  const replies: string[] = [];
  let emitCommand: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: {
      pi: defineHarnessAdapter<"pi">({
        id: "pi",
        async open() {
          return Result.ok({
            id: "pi",
            createSession: async () => Result.err(new Error("not implemented")),
            resumeSession: async () => Result.err(new Error("not implemented")),
            listSessions: async () => Result.err(new Error("not implemented")),
            getSession: async () => Result.err(new Error("not implemented")),
            prompt: async () => Result.err(new Error("not implemented")),
            deleteSession: async () => Result.err(new Error("not implemented")),
            abort: async () => Result.err(new Error("not implemented")),
            close: async () => {},
          });
        },
      }),
    },
    chats: {
      telegram: defineChatAdapter<
        "telegram",
        Record<never, never>,
        Record<never, never>,
        typeof capabilities
      >({
        id: "telegram",
        capabilities,
        async open() {
          return Result.ok({
            id: "telegram",
            async start(context) {
              emitCommand = context.emit as (event: unknown) => void;
              return Result.ok();
            },
            async sendMessage(message) {
              return Result.ok(sentMessage(message.text));
            },
            async sendAction(input) {
              return Result.ok({
                chatId: input.chatId,
                conversationId: input.conversationId,
                messageId: "action-1",
                text: input.text,
                adapterData: {},
              });
            },
            async respondToAction() {
              return Result.ok();
            },
            async reply(message) {
              replies.push(message.text);
              return Result.ok(sentMessage(message.text));
            },
            close: async () => {},
          });
        },
      }),
    },
    config: {
      defaultWorkingDirectory: process.cwd(),
      deliveryMode: "requester_only",
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitCommand).toBeDefined();

  return { emitCommand: emitCommand as (event: unknown) => void, replies, xmux };
}

function idCommandEvent(
  input: {
    readonly actor?: { readonly kind: "user"; readonly actorId: string; readonly displayName?: string; readonly adapterData: Record<never, never> };
    readonly displayName?: string;
  } = {},
) {
  const displayName = "displayName" in input ? input.displayName : "Ishak";
  const actor =
    "actor" in input
      ? input.actor
      : {
          kind: "user" as const,
          actorId: "user-1",
          ...(displayName === undefined ? {} : { displayName }),
          adapterData: {},
        };

  return {
    type: "command",
    chatId: "telegram",
    conversation,
    ...(actor === undefined ? {} : { actor }),
    message: { chatId: "telegram", conversationId: conversation.conversationId, messageId: "message-1" },
    command: {
      name: "id",
      options: {},
    },
  };
}

function sentMessage(text: string) {
  return {
    chatId: "telegram" as const,
    conversationId: conversation.conversationId,
    messageId: "reply-1",
    text,
    adapterData: {},
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(predicate()).toBe(true);
}
