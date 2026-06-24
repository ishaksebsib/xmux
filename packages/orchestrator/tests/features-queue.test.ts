import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter, type HarnessPromptEvent } from "@xmux/harness-core";
import { createHandlerContext, createXmux } from "../src";
import {
  handleQueueAction,
  handleQueueCommand,
  type HandleQueueActionInput,
  type HandleQueueCommandInput,
} from "../src/features/queue";
import { createSessionRecord, createThreadBinding, type Store } from "../src/store";

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
const sessionRef = { harnessId: "pi", sessionId: "session-1" } as const;

type PiPromptEvent = HarnessPromptEvent<"pi">;

describe("prompt queue", () => {
  test("adds a busy prompt to the queue and auto-sends it after the active prompt settles", async () => {
    let finishFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let promptCount = 0;
    const { actionMessages, ctx, emitMessage, promptInputs, replies, updates, xmux } =
      await initializeXmux({
        onPrompt: () => {
          promptCount += 1;
          return promptCount === 1
            ? controlledEvents({ text: "first", waitFor: firstCanFinish })
            : toAsync([
                { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "second" },
                completedEvent(),
              ]);
        },
      });
    await bindSession(xmux.ctx.store);

    emitMessage(messageEvent({ text: "one", messageId: "m1" }));
    await eventually(() => promptInputs.length === 1);

    emitMessage(messageEvent({ text: "two", messageId: "m2" }));
    await eventually(() => actionMessages.length === 1);

    const offerId = firstPayload(actionMessages[0]?.buttons, "add");
    const added = await handleQueueAction({
      ctx,
      event: queueActionEvent({ value: "add", payload: offerId, updates }),
    });

    expect(added.isOk()).toBe(true);
    expect(updates[0]?.text).toContain("**Queued** · 1/1");
    expect(promptInputs).toHaveLength(1);

    finishFirst();

    await eventually(() => promptInputs.length === 2 && replies.length === 2);
    expect(promptInputs[1]).toMatchObject({ content: [{ type: "text", text: "two" }] });
    expect(replies).toEqual(["first", "second"]);

    const staleRemove = await handleQueueAction({
      ctx,
      event: queueActionEvent({ value: "remove", payload: offerId, updates }),
    });
    expect(staleRemove.isOk()).toBe(true);
    expect(updates.at(-1)?.text).toContain("**Already sent**");

    await xmux.shutdown();
  });

  test("/queue lists, adds, and removes prompts for the active session", async () => {
    const { ctx, replies, xmux } = await initializeXmux();
    await bindSession(xmux.ctx.store);

    const added = await handleQueueCommand({
      ctx,
      event: queueCommandEvent({ action: "add", value: "queued from command", replies }),
    });
    expect(added.isOk()).toBe(true);
    expect(replies.at(-1)).toContain("**Queued** · 1/1");

    const listed = await handleQueueCommand({
      ctx,
      event: queueCommandEvent({ action: "list", replies }),
    });
    expect(listed.isOk()).toBe(true);
    expect(replies.at(-1)).toContain("**Prompt queue** · 1");
    expect(replies.at(-1)).toContain("1/1 — `queued from command`");

    const removed = await handleQueueCommand({
      ctx,
      event: queueCommandEvent({ action: "remove", value: "1", replies }),
    });
    expect(removed.isOk()).toBe(true);
    expect(replies.at(-1)).toContain("**Removed**");

    await xmux.shutdown();
  });

  test("interrupt and send cancels the active prompt and injects the offered prompt", async () => {
    let finishFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let promptCount = 0;
    let abortCount = 0;
    const { actionMessages, ctx, emitMessage, promptInputs, updates, xmux } = await initializeXmux({
      onAbort: () => {
        abortCount += 1;
        finishFirst();
      },
      onPrompt: () => {
        promptCount += 1;
        return promptCount === 1
          ? controlledEvents({ text: "first", waitFor: firstCanFinish })
          : toAsync([
              {
                type: "content",
                phase: "delta",
                kind: "text",
                ref: sessionRef,
                delta: "interrupt",
              },
              completedEvent(),
            ]);
      },
    });
    await bindSession(xmux.ctx.store);

    emitMessage(messageEvent({ text: "one", messageId: "m1" }));
    await eventually(() => promptInputs.length === 1);

    emitMessage(messageEvent({ text: "two", messageId: "m2" }));
    await eventually(() => actionMessages.length === 1);

    const offerId = firstPayload(actionMessages[0]?.buttons, "interrupt");
    const interrupted = await handleQueueAction({
      ctx,
      event: queueActionEvent({ value: "interrupt", payload: offerId, updates }),
    });

    expect(interrupted.isOk()).toBe(true);
    await eventually(() => promptInputs.length === 2);
    expect(abortCount).toBe(1);
    expect(promptInputs[1]).toMatchObject({ content: [{ type: "text", text: "two" }] });
    expect(updates.at(-1)?.text).toContain("**Interrupted**");

    await xmux.shutdown();
  });
});

interface InitializeXmuxInput {
  readonly onPrompt?: () => AsyncIterable<PiPromptEvent>;
  readonly onAbort?: () => void;
}

async function initializeXmux(input: InitializeXmuxInput = {}) {
  const actionMessages: { readonly text: string; readonly buttons: unknown }[] = [];
  const promptInputs: unknown[] = [];
  const replies: string[] = [];
  const updates: { readonly text: string }[] = [];
  let emitMessage: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: {
      pi: defineHarnessAdapter<"pi">({
        id: "pi",
        async open() {
          return Result.ok({
            id: "pi",
            async createSession() {
              return Result.ok({ sessionId: "session-1", adapterData: {} });
            },
            resumeSession: async () => Result.err(new Error("not implemented")),
            listSessions: async () => Result.err(new Error("not implemented")),
            getSession: async () => Result.err(new Error("not implemented")),
            async prompt(promptInput) {
              promptInputs.push(promptInput);
              return Result.ok(input.onPrompt?.() ?? toAsync([completedEvent()]));
            },
            deleteSession: async () => Result.err(new Error("not implemented")),
            abort: async () => {
              input.onAbort?.();
              return Result.ok();
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
              emitMessage = context.emit as (event: unknown) => void;
              return Result.ok();
            },
            async sendMessage(message) {
              return Result.ok(sentMessage(message.text));
            },
            async sendAction(action) {
              actionMessages.push({ text: action.text, buttons: action.buttons });
              return Result.ok(sentMessage(action.text, "action-1"));
            },
            async updateAction(action) {
              updates.push({ text: action.text });
              return Result.ok(sentMessage(action.text, action.message.messageId));
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
  const ctx = createHandlerContext({
    app: xmux.ctx,
    chatId: "telegram",
    actor: { userId: "user-1", displayName: "Ishak" },
  });

  return {
    actionMessages,
    ctx,
    emitMessage: emitMessage as (event: unknown) => void,
    promptInputs,
    replies,
    updates,
    xmux,
  };
}

async function bindSession(store: Store) {
  const now = new Date().toISOString();
  expect(
    (
      await store.sessions.create(
        createSessionRecord({
          ref: sessionRef,
          origin: thread,
          requester: { userId: "user-1" },
          cwd: process.cwd(),
          now,
        }),
      )
    ).isOk(),
  ).toBe(true);
  expect(
    (await store.threadBindings.bind(createThreadBinding({ thread, sessionRef, now }))).isOk(),
  ).toBe(true);
}

function messageEvent(input: { readonly text: string; readonly messageId: string }) {
  return {
    type: "message",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: {
      chatId: "telegram",
      conversationId: thread.threadId,
      messageId: input.messageId,
      actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
      text: input.text,
      format: "plain",
      attachments: [],
      adapterData: {},
    },
  };
}

function queueActionEvent(input: {
  readonly value: "add" | "interrupt" | "remove";
  readonly payload: string;
  readonly updates: { readonly text: string }[];
}): HandleQueueActionInput<Record<"pi", never>, Record<"telegram", never>>["event"] {
  return {
    type: "action",
    actionId: "q",
    value: input.value,
    payload: input.payload,
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "action-1" },
    interactionId: "interaction-1",
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    ack: async () => Result.ok(),
    reply: async () => Result.ok(sentMessage("")),
    update: async (update) => {
      const text =
        typeof update?.message === "string" ? update.message : (update?.message?.text ?? "");
      input.updates.push({ text });
      return Result.ok(sentMessage(text));
    },
  } as HandleQueueActionInput<Record<"pi", never>, Record<"telegram", never>>["event"];
}

function queueCommandEvent(input: {
  readonly action?: "list" | "add" | "remove";
  readonly value?: string;
  readonly replies: string[];
}): HandleQueueCommandInput<Record<"pi", never>, Record<"telegram", never>>["event"] {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "command-1" },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    command: { name: "queue", options: { action: input.action, value: input.value } },
    reply: async (message: string | { readonly text: string }) => {
      const text = typeof message === "string" ? message : message.text;
      input.replies.push(text);
      return Result.ok(sentMessage(text));
    },
  } as HandleQueueCommandInput<Record<"pi", never>, Record<"telegram", never>>["event"];
}

function firstPayload(buttons: unknown, value: string): string {
  if (!Array.isArray(buttons)) throw new Error("missing buttons");
  for (const row of buttons) {
    if (!Array.isArray(row)) continue;
    for (const button of row) {
      if (
        typeof button === "object" &&
        button !== null &&
        "value" in button &&
        button.value === value &&
        "payload" in button &&
        typeof button.payload === "string"
      ) {
        return button.payload;
      }
    }
  }
  throw new Error(`missing ${value} payload`);
}

function completedEvent(): PiPromptEvent {
  return { type: "run", phase: "completed", ref: sessionRef, reason: "stop" };
}

function sentMessage(text: string, messageId = "reply-1") {
  return {
    chatId: "telegram" as const,
    conversationId: thread.threadId,
    messageId,
    text,
    adapterData: {},
  };
}

async function* controlledEvents(input: {
  readonly text: string;
  readonly waitFor: Promise<void>;
}): AsyncIterable<PiPromptEvent> {
  yield { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: input.text };
  await input.waitFor;
  yield completedEvent();
}

async function* toAsync<T>(values: readonly T[]): AsyncIterable<T> {
  yield* values;
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(predicate()).toBe(true);
}
