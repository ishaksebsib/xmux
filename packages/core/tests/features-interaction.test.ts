import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import {
  defineHarnessAdapter,
  type HarnessInteractionResponse,
  type HarnessPromptEvent,
} from "@xmux/harness-core";
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

describe("interaction commands", () => {
  test("records interaction.requested events on the active run", async () => {
    const { xmux } = await initializeXmux({ promptEvents: permissionEvents("permission-1") });
    await bindSession({ xmux });

    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    const run = xmux.ctx.services.promptRuns.get(sessionRef);
    expect(run?.pendingInteractions).toEqual([
      expect.objectContaining({
        requestId: "permission-1",
        kind: "permission",
        prompt: "Run npm test?",
        status: "pending",
        ordinal: 1,
      }),
    ]);

    await prompt.close();
    await xmux.shutdown();
  });

  test("/allow responds to the current permission with allow_once without a confirmation reply", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux({
      promptEvents: permissionEvents("permission-1"),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(allowCommandEvent());

    await eventually(() => respondCalls.length === 1);

    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-1", decision: "allow_once" },
    ]);
    expect(replies).toEqual([]);
    expect(xmux.ctx.services.promptRuns.get(sessionRef)?.pendingInteractions).toEqual([]);

    await prompt.close();
    await xmux.shutdown();
  });

  test("/allow always responds with allow_always without a confirmation reply", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux({
      promptEvents: permissionEvents("permission-1"),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(allowCommandEvent("always"));

    await eventually(() => respondCalls.length === 1);

    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-1", decision: "allow_always" },
    ]);
    expect(replies).toEqual([]);

    await prompt.close();
    await xmux.shutdown();
  });

  test("/reject rejects a permission interaction", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux({
      promptEvents: permissionEvents("permission-1"),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(rejectCommandEvent());

    await eventually(() => replies.length === 1);

    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-1", decision: "reject" },
    ]);
    expect(replies[0]).toBe("✗ Permission rejected");
    expect(replies[0]).not.toContain("permission-1");

    await prompt.close();
    await xmux.shutdown();
  });

  test("/reject rejects a question interaction", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux({
      promptEvents: questionEvents("question-1"),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(rejectCommandEvent());

    await eventually(() => replies.length === 1);

    expect(respondCalls).toEqual([{ kind: "question", requestId: "question-1", reject: true }]);
    expect(replies[0]).toBe("✗ Question rejected");
    expect(replies[0]).not.toContain("question-1");

    await prompt.close();
    await xmux.shutdown();
  });

  test("/allow with no active session replies no active session", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux();

    emitCommand(allowCommandEvent());

    await eventually(() => replies.length === 1);

    expect(respondCalls).toEqual([]);
    expect(replies[0]).toBe(
      "**No active session**\n\nThere is no active session with a pending request.\n\nUse `/new <harnessId>` or `/resume` to continue.",
    );

    await xmux.shutdown();
  });

  test("/allow with no active run replies no active generation", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(allowCommandEvent());

    await eventually(() => replies.length === 1);

    expect(respondCalls).toEqual([]);
    expect(replies[0]).toBe(
      "**No active generation**\n\nThere is no running generation with a pending request.",
    );

    await xmux.shutdown();
  });

  test("/allow with no pending interaction replies no pending request", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux({
      promptEvents: noInteractionEvents(),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 1 });

    emitCommand(allowCommandEvent());

    await eventually(() => replies.length === 1);

    expect(respondCalls).toEqual([]);
    expect(replies[0]).toBe(
      "**No pending request**\n\nThere is no permission request waiting for `/allow` or `/reject`.",
    );

    await prompt.close();
    await xmux.shutdown();
  });

  test("/allow on a question interaction does not require or request an internal id", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux({
      promptEvents: questionEvents("question-1"),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(allowCommandEvent());

    await eventually(() => replies.length === 1);

    expect(respondCalls).toEqual([]);
    expect(replies[0]).toContain("**Cannot respond to current request**");
    expect(replies[0]).toContain("`/reject`");
    expect(replies[0]).not.toContain("question-1");

    await prompt.close();
    await xmux.shutdown();
  });

  test("multiple pending interactions resolve FIFO", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux({
      promptEvents: twoPermissionEvents(),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 3 });

    emitCommand(allowCommandEvent());
    await eventually(() => respondCalls.length === 1);
    emitCommand(rejectCommandEvent());
    await eventually(() => replies.length === 1);

    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-1", decision: "allow_once" },
      { kind: "permission", requestId: "permission-2", decision: "reject" },
    ]);
    expect(replies[0]).toBe("✗ Permission rejected");
    expect(replies.join("\n")).not.toContain("permission-1");
    expect(replies.join("\n")).not.toContain("permission-2");

    await prompt.close();
    await xmux.shutdown();
  });

  test("adapter error keeps the interaction retryable", async () => {
    const { emitCommand, replies, respondCalls, xmux } = await initializeXmux({
      promptEvents: permissionEvents("permission-1"),
      respondErrors: [new Error("adapter failed")],
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(allowCommandEvent());
    await eventually(() => replies.length === 1);
    emitCommand(allowCommandEvent());
    await eventually(() => respondCalls.length === 2);

    expect(replies[0]).toContain("**Failed to respond to permission request**");
    expect(replies[0]).toContain("adapter failed");
    expect(replies).toHaveLength(1);
    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-1", decision: "allow_once" },
      { kind: "permission", requestId: "permission-1", decision: "allow_once" },
    ]);

    await prompt.close();
    await xmux.shutdown();
  });

  test("invalid /allow usage replies with usage", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux();

    emitCommand(invalidCommandEvent("allow"));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("**Invalid `/allow` command**");
    expect(replies[0]).toContain("Use `/allow` to allow once");
    expect(replies[0]).toContain("`/allow always`");
    expect(replies[0]).not.toContain("Invalid command option");
    expect(replies[0]).not.toContain("**/allow : allow current permission request**");

    await xmux.shutdown();
  });

  test("Allow button responds allow_once and clears the message buttons", async () => {
    const { emitCommand, replies, respondCalls, actionResponses, xmux } = await initializeXmux({
      promptEvents: permissionEvents("permission-1"),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(interactionActionEvent({ value: "allow" }));

    await eventually(() => actionResponses.some((response) => response.kind === "update"));

    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-1", decision: "allow_once" },
    ]);
    expect(replies).toEqual([]);
    expect(xmux.ctx.services.promptRuns.get(sessionRef)?.pendingInteractions).toEqual([]);

    const update = actionResponses.find((response) => response.kind === "update");
    expect(update?.text).toBe("✓ Permission allowed");
    expect(update?.buttons).toEqual([]);

    await prompt.close();
    await xmux.shutdown();
  });

  test("Allow always button responds allow_always", async () => {
    const { emitCommand, respondCalls, actionResponses, xmux } = await initializeXmux({
      promptEvents: permissionEvents("permission-1"),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(interactionActionEvent({ value: "always" }));

    await eventually(() => actionResponses.some((response) => response.kind === "update"));

    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-1", decision: "allow_always" },
    ]);
    const update = actionResponses.find((response) => response.kind === "update");
    expect(update?.text).toContain("✓ Permission allowed");
    expect(update?.buttons).toEqual([]);

    await prompt.close();
    await xmux.shutdown();
  });

  test("Reject button responds reject and marks the message rejected", async () => {
    const { emitCommand, respondCalls, actionResponses, xmux } = await initializeXmux({
      promptEvents: permissionEvents("permission-1"),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 2 });

    emitCommand(interactionActionEvent({ value: "reject" }));

    await eventually(() => actionResponses.some((response) => response.kind === "update"));

    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-1", decision: "reject" },
    ]);
    const update = actionResponses.find((response) => response.kind === "update");
    expect(update?.text).toBe("✗ Permission rejected");
    expect(update?.buttons).toEqual([]);

    await prompt.close();
    await xmux.shutdown();
  });

  test("button resolves its own interaction by ordinal", async () => {
    const { emitCommand, respondCalls, actionResponses, xmux } = await initializeXmux({
      promptEvents: twoPermissionEvents(),
    });
    await bindSession({ xmux });
    const prompt = await startPromptAndConsume({ xmux, eventsToConsume: 3 });

    emitCommand(interactionActionEvent({ value: "reject", ordinal: 2 }));

    await eventually(() => actionResponses.some((response) => response.kind === "update"));

    expect(respondCalls).toEqual([
      { kind: "permission", requestId: "permission-2", decision: "reject" },
    ]);
    expect(
      xmux.ctx.services.promptRuns
        .get(sessionRef)
        ?.pendingInteractions.map((interaction) => interaction.requestId),
    ).toEqual(["permission-1"]);

    await prompt.close();
    await xmux.shutdown();
  });

  test("stale button clears its buttons when nothing is pending", async () => {
    const { emitCommand, respondCalls, actionResponses, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(interactionActionEvent({ value: "allow" }));

    await eventually(() => actionResponses.some((response) => response.kind === "update"));

    expect(respondCalls).toEqual([]);
    const update = actionResponses.find((response) => response.kind === "update");
    expect(update?.text).toContain("no longer pending");
    expect(update?.buttons).toEqual([]);

    await xmux.shutdown();
  });
});

interface InitializeXmuxInput {
  readonly promptEvents?: AsyncIterable<HarnessPromptEvent<"pi">>;
  readonly respondErrors?: unknown[];
}

interface CapturedActionResponse {
  readonly kind: "ack" | "reply" | "update";
  readonly text?: string;
  readonly buttons?: readonly (readonly { readonly value?: string }[])[];
}

async function initializeXmux(input: InitializeXmuxInput = {}) {
  const replies: string[] = [];
  const respondCalls: HarnessInteractionResponse[] = [];
  const actionResponses: CapturedActionResponse[] = [];
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
            async prompt() {
              return Result.ok(input.promptEvents ?? noInteractionEvents());
            },
            async deleteSession() {
              return Result.err(new Error("not implemented"));
            },
            async abort() {
              return Result.err(new Error("not implemented"));
            },
            async respondInteraction(request) {
              respondCalls.push(request.response);
              const error = input.respondErrors?.shift();
              return error === undefined ? Result.ok() : Result.err(error);
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
            async respondToAction(request) {
              const response = request.response;
              actionResponses.push({
                kind: response.kind,
                ...(response.kind === "ack" || response.kind === "reply"
                  ? {}
                  : {
                      ...(response.message === undefined
                        ? {}
                        : { text: normalizeActionText(response.message) }),
                      ...(response.buttons === undefined ? {} : { buttons: response.buttons }),
                    }),
              } as CapturedActionResponse);
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
    replies,
    respondCalls,
    actionResponses,
    emitCommand: emitCommand as (event: unknown) => void,
    xmux,
  };
}

function normalizeActionText(message: { readonly text: string } | string): string {
  return typeof message === "string" ? message : message.text;
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

async function startPromptAndConsume(input: {
  readonly xmux: Awaited<ReturnType<typeof initializeXmux>>["xmux"];
  readonly eventsToConsume: number;
}) {
  const prompted = await promptSessionForThread({
    ctx: createHandlerContext({
      app: input.xmux.ctx,
      chatId: "telegram",
      actor: { userId: "user-1", displayName: "Ishak" },
    }),
    thread,
    text: "please continue",
  });

  expect(prompted.isOk()).toBe(true);
  const value = prompted.unwrap("prompted");
  const iterator = value.events[Symbol.asyncIterator]();

  for (let index = 0; index < input.eventsToConsume; index += 1) {
    const event = await iterator.next();
    expect(event.done).not.toBe(true);
  }

  return {
    async close() {
      await iterator.return?.();
      value.release();
    },
  };
}

function allowCommandEvent(mode?: "always") {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    command: {
      name: "allow",
      options: mode === undefined ? {} : { mode },
    },
  };
}

function rejectCommandEvent() {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    command: {
      name: "reject",
      options: {},
    },
  };
}

function interactionActionEvent(input: {
  readonly value: "allow" | "always" | "reject";
  readonly ordinal?: number;
}) {
  const payload = String(input.ordinal ?? 1);
  return {
    type: "action",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "1" },
    interactionId: `interaction-${input.value}-${payload}`,
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    actionId: "i",
    value: input.value,
    payload,
  };
}

function invalidCommandEvent(commandName: "allow" | "reject") {
  return {
    type: "command.invalid",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    commandName,
    reason: "Invalid command option",
    optionName: "mode",
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

async function* noInteractionEvents(): AsyncIterable<HarnessPromptEvent<"pi">> {
  yield { type: "run", phase: "started", ref: sessionRef };
  await new Promise<never>(() => {});
}

async function* permissionEvents(requestId: string): AsyncIterable<HarnessPromptEvent<"pi">> {
  yield { type: "run", phase: "started", ref: sessionRef };
  yield {
    type: "interaction",
    kind: "permission",
    phase: "requested",
    requestId,
    prompt: "Run npm test?",
    ref: sessionRef,
  };
  await new Promise<never>(() => {});
}

async function* twoPermissionEvents(): AsyncIterable<HarnessPromptEvent<"pi">> {
  yield { type: "run", phase: "started", ref: sessionRef };
  yield {
    type: "interaction",
    kind: "permission",
    phase: "requested",
    requestId: "permission-1",
    prompt: "Run npm test?",
    ref: sessionRef,
  };
  yield {
    type: "interaction",
    kind: "permission",
    phase: "requested",
    requestId: "permission-2",
    prompt: "Run pnpm lint?",
    ref: sessionRef,
  };
  await new Promise<never>(() => {});
}

async function* questionEvents(requestId: string): AsyncIterable<HarnessPromptEvent<"pi">> {
  yield { type: "run", phase: "started", ref: sessionRef };
  yield {
    type: "interaction",
    kind: "question",
    phase: "requested",
    requestId,
    prompt: "Pick an option?",
    ref: sessionRef,
  };
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
