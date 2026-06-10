import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { createXmux } from "../src";
import { createSessionRecord, createThreadBinding } from "../src/store";

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

const thread = { chatId: "telegram", threadId: "conversation-1" } as const;
const sessionRef = { harnessId: "opencode", sessionId: "session-1" } as const;

describe("/exit command", () => {
  test("exits the active session without deleting session metadata or touching the harness", async () => {
    const { emitCommand, harnessCalls, replies, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(exitCommandEvent());

    await eventually(() => replies.length === 1);

    expect(harnessCalls).toEqual([]);
    expect(replies[0]).toContain("**Exited session**");
    expect(replies[0]).toContain("- Harness: `opencode`");
    expect(replies[0]).toContain("- Session ID: `session-1`");
    expect(replies[0]).toContain("- Title: Fix bug");
    expect(replies[0]).toContain("Create or resume a session to continue conversation.");

    const binding = await xmux.ctx.store.threadBindings.get(thread);
    expect(binding.unwrap("expected binding lookup to succeed")).toBeNull();

    const session = await xmux.ctx.store.sessions.get(sessionRef);
    expect(session.unwrap("expected session lookup to succeed")).toMatchObject({
      ref: sessionRef,
      title: "Fix bug",
      status: "open",
    });

    await xmux.shutdown();
  });

  test("reports no active session when the thread is not attached", async () => {
    const { emitCommand, harnessCalls, replies, xmux } = await initializeXmux();

    emitCommand(exitCommandEvent());

    await eventually(() => replies.length === 1);

    expect(harnessCalls).toEqual([]);
    expect(replies[0]).toBe(
      "**No active session**\n\nYou are not currently in a session.\n\nUse `/new <harnessId>` or `/resume` to continue conversation.",
    );

    await xmux.shutdown();
  });

  test("clears a stale binding when the session record is missing", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux();
    const now = new Date().toISOString();
    await xmux.ctx.store.threadBindings.bind(createThreadBinding({ thread, sessionRef, now }));

    emitCommand(exitCommandEvent());

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("**Exited session**");
    expect(replies[0]).toContain("- Session ID: `session-1`");
    expect(replies[0]).not.toContain("- Title:");

    const binding = await xmux.ctx.store.threadBindings.get(thread);
    expect(binding.unwrap("expected binding lookup to succeed")).toBeNull();

    await xmux.shutdown();
  });
});

async function initializeXmux() {
  const replies: string[] = [];
  const harnessCalls: string[] = [];
  let emitCommand: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: {
      opencode: defineHarnessAdapter<"opencode">({
        id: "opencode",
        async open() {
          return Result.ok({
            id: "opencode",
            async createSession() {
              harnessCalls.push("createSession");
              return Result.err(new Error("not implemented"));
            },
            async resumeSession() {
              harnessCalls.push("resumeSession");
              return Result.err(new Error("not implemented"));
            },
            async listSessions() {
              harnessCalls.push("listSessions");
              return Result.err(new Error("not implemented"));
            },
            async getSession() {
              harnessCalls.push("getSession");
              return Result.err(new Error("not implemented"));
            },
            async prompt() {
              harnessCalls.push("prompt");
              return Result.err(new Error("not implemented"));
            },
            async deleteSession() {
              harnessCalls.push("deleteSession");
              return Result.err(new Error("not implemented"));
            },
            async abort() {
              harnessCalls.push("abort");
              return Result.err(new Error("not implemented"));
            },
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
            async sendMessage(input) {
              return Result.ok(sentMessage({ text: input.text, format: input.format }));
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
            async reply(input) {
              replies.push(input.text);
              return Result.ok(sentMessage({ text: input.text, format: input.format }));
            },
            close: async () => {},
          });
        },
      }),
    },
    config: {
      userName: "xmux",
      defaultWorkingDirectory: process.cwd(),
      deliveryMode: "requester_only",
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitCommand).toBeDefined();

  return {
    harnessCalls,
    replies,
    emitCommand: emitCommand as (event: unknown) => void,
    xmux,
  };
}

async function bindSession(input: {
  readonly xmux: Awaited<ReturnType<typeof initializeXmux>>["xmux"];
}) {
  const now = new Date().toISOString();
  const record = createSessionRecord({
    ref: sessionRef,
    origin: thread,
    requester: { userId: "user-1" },
    cwd: process.cwd(),
    deliveryMode: "requester_only",
    title: "Fix bug",
    now,
  });

  expect((await input.xmux.ctx.store.sessions.create(record)).isOk()).toBe(true);
  expect(
    (
      await input.xmux.ctx.store.threadBindings.bind(
        createThreadBinding({ thread, sessionRef, now }),
      )
    ).isOk(),
  ).toBe(true);
}

function exitCommandEvent() {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    command: {
      name: "exit",
      options: {},
    },
  };
}

function sentMessage(input: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
}) {
  return {
    chatId: "telegram" as const,
    conversationId: thread.threadId,
    messageId: "reply-1",
    text: input.text,
    format: input.format,
    adapterData: {},
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(predicate()).toBe(true);
}
