import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter, type HarnessPromptEvent } from "@xmux/harness-core";
import { createHandlerContext, createXmux } from "../src";
import { promptSessionForThread } from "../src/features/prompt";
import { createSessionRecord, createThreadBinding } from "../src/store";

const capabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: false,
    markdown: true,
    attachments: false,
  },
} as const;

const thread = { chatId: "telegram", threadId: "conversation-1" } as const;
const sessionRef = { harnessId: "pi", sessionId: "session-1" } as const;

describe("/cancel command", () => {
  test("reports no active session when the thread is not attached", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux();

    emitCommand(cancelCommandEvent());

    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(
      "**No active session**\n\nThere is no active session to cancel.\n\nUse `/new <harnessId>` or `/resume` to continue.",
    );

    await xmux.shutdown();
  });

  test("reports no generation running when the active session has no prompt run", async () => {
    const { abortCalls, emitCommand, replies, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(cancelCommandEvent());

    await eventually(() => replies.length === 1);

    expect(abortCalls).toEqual([]);
    expect(replies[0]).toBe("**No generation is running**");

    await xmux.shutdown();
  });

  test("cancels an active run and calls harness abort", async () => {
    const { abortCalls, emitCommand, replies, xmux } = await initializeXmux();
    await bindSession({ xmux });
    await startPrompt(xmux, "please work");

    emitCommand(cancelCommandEvent());

    await eventually(() => replies.length === 1);

    expect(abortCalls).toEqual(["pi:session-1"]);
    expect(replies[0]).toBe("**Generation cancelled**");
    expect(xmux.ctx.services.promptRuns.get(sessionRef)).toBeUndefined();

    await xmux.shutdown();
  });

  test("aborts the prompt signal passed to the harness stream", async () => {
    const { emitCommand, promptSignals, replies, xmux } = await initializeXmux();
    await bindSession({ xmux });
    await startPrompt(xmux, "please work");

    expect(promptSignals).toHaveLength(1);
    expect(promptSignals[0]?.aborted).toBe(false);

    emitCommand(cancelCommandEvent());

    await eventually(() => replies.length === 1);

    expect(promptSignals[0]?.aborted).toBe(true);

    await xmux.shutdown();
  });

  test("allows a new prompt to start after cancellation", async () => {
    const { emitCommand, promptInputs, replies, xmux } = await initializeXmux();
    await bindSession({ xmux });
    await startPrompt(xmux, "first");

    emitCommand(cancelCommandEvent());

    await eventually(() => replies.length === 1);

    const second = await startPrompt(xmux, "second");

    expect(second.isOk()).toBe(true);
    expect(promptInputs).toHaveLength(2);
    expect(xmux.ctx.services.promptRuns.get(sessionRef)).toBeDefined();

    second.unwrap("second prompt").release();
    await xmux.shutdown();
  });

  test("surfaces harness abort errors without leaving the run stuck", async () => {
    const { emitCommand, promptSignals, replies, xmux } = await initializeXmux({
      abortError: new Error("abort failed"),
    });
    await bindSession({ xmux });
    await startPrompt(xmux, "please work");

    emitCommand(cancelCommandEvent());

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("**Failed to cancel generation**");
    expect(replies[0]).toContain("abort failed");
    expect(promptSignals[0]?.aborted).toBe(true);
    expect(xmux.ctx.services.promptRuns.get(sessionRef)).toBeUndefined();

    await xmux.shutdown();
  });
});

interface InitializeXmuxInput {
  readonly abortError?: unknown;
}

async function initializeXmux(options: InitializeXmuxInput = {}) {
  const abortCalls: string[] = [];
  const promptInputs: unknown[] = [];
  const promptSignals: AbortSignal[] = [];
  const replies: string[] = [];
  let emitCommand: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: {
      pi: defineHarnessAdapter<"pi">({
        id: "pi",
        async open() {
          return Result.ok({
            id: "pi",
            async createSession() {
              return Result.err(new Error("not implemented"));
            },
            async resumeSession() {
              return Result.err(new Error("not implemented"));
            },
            async listSessions() {
              return Result.err(new Error("not implemented"));
            },
            async getSession() {
              return Result.err(new Error("not implemented"));
            },
            async prompt(promptInput) {
              promptInputs.push(promptInput);
              promptSignals.push(promptInput.signal as AbortSignal);
              return Result.ok(pendingPromptEvents());
            },
            async deleteSession() {
              return Result.err(new Error("not implemented"));
            },
            async abort(input) {
              abortCalls.push(`${input.ref.harnessId}:${input.ref.sessionId}`);
              return options.abortError !== undefined
                ? Result.err(options.abortError)
                : Result.ok(undefined);
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
            async sendMessage(message) {
              return Result.ok(sentMessage({ text: message.text, format: message.format }));
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
              return Result.ok(sentMessage({ text: message.text, format: message.format }));
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
    abortCalls,
    promptInputs,
    promptSignals,
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

async function startPrompt(xmux: Awaited<ReturnType<typeof initializeXmux>>["xmux"], text: string) {
  return promptSessionForThread({
    ctx: createHandlerContext({
      app: xmux.ctx,
      chatId: "telegram",
      actor: { userId: "user-1", displayName: "Ishak" },
    }),
    thread,
    text,
  });
}

function cancelCommandEvent() {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    command: {
      name: "cancel",
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

async function* pendingPromptEvents(): AsyncIterable<HarnessPromptEvent<"pi">> {
  yield { type: "run", phase: "started", ref: sessionRef };
  await new Promise<never>(() => {});
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
