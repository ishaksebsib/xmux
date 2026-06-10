import { Result } from "better-result";
import { describe, expect, test, vi } from "vitest";
import { defineChatAdapter, type ChatAttachment } from "@xmux/chat-core";
import { defineHarnessAdapter, type HarnessPromptEvent } from "@xmux/harness-core";
import { createHandlerContext, createXmux } from "../src";
import {
  handlePromptMessage,
  promptSessionForThread,
  PromptResponseError,
  type PromptMessageEvent,
} from "../src/features/prompt";
import type { PromptAttachmentsConfig } from "../src";
import { createSessionRecord, createThreadBinding, type Store } from "../src/store";

const fallbackCapabilities = {
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

const streamingCapabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: false,
    markdown: true,
    attachments: { receive: false, send: false, download: false },
    stream: { send: false, reply: true, strategy: "native" },
  },
} as const;

type PiPromptEvent = HarnessPromptEvent<"pi">;

const thread = { chatId: "telegram", threadId: "conversation-1" } as const;
const sessionRef = { harnessId: "pi", sessionId: "session-1" } as const;

describe("prompt messages", () => {
  test("ignores bot, system, and blank messages", async () => {
    const { emitMessage, promptInputs, replies, xmux } = await initializeFallbackXmux();

    emitMessage(messageEvent({ text: "from bot", actorKind: "bot", messageId: "bot" }));
    emitMessage(messageEvent({ text: "from system", actorKind: "system", messageId: "system" }));
    emitMessage(messageEvent({ text: "   ", actorKind: "user", messageId: "blank" }));

    await delay(20);

    expect(promptInputs).toHaveLength(0);
    expect(replies).toHaveLength(0);

    await xmux.shutdown();
  });

  test("replies when no active session is bound to the thread", async () => {
    const { emitMessage, replies, xmux } = await initializeFallbackXmux();

    emitMessage(messageEvent({ text: "hello" }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(
      "**No active session**\n\nCreate or resume a session before sending a prompt.\n\nUse `/new <harnessId>` or `/resume` to continue conversation.",
    );

    await xmux.shutdown();
  });

  test("replies when a thread binding points at a missing session record", async () => {
    const { emitMessage, replies, xmux } = await initializeFallbackXmux();
    await xmux.ctx.store.threadBindings.bind(
      createThreadBinding({ thread, sessionRef, now: new Date().toISOString() }),
    );

    emitMessage(messageEvent({ text: "hello" }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("**Failed to route prompt**");
    expect(replies[0]).toContain("Session record not found");

    await xmux.shutdown();
  });

  test("replies when the bound session is closed and does not call the harness", async () => {
    const { emitMessage, promptInputs, replies, xmux } = await initializeFallbackXmux();
    await bindSession({ xmux, status: "closed" });

    emitMessage(messageEvent({ text: "hello" }));

    await eventually(() => replies.length === 1);

    expect(promptInputs).toHaveLength(0);
    expect(replies[0]).toBe(
      "**Session is closed**\n\nStart a new session with `/new <harnessId>`.",
    );

    await xmux.shutdown();
  });

  test("prompts the active session with text content and falls back to a collected reply", async () => {
    const { emitMessage, promptInputs, replies, xmux } = await initializeFallbackXmux({
      events: [
        { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "Hel" },
        { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "lo" },
        completedEvent(),
      ],
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "please help" }));

    await eventually(() => replies.length === 1);

    expect(promptInputs).toHaveLength(1);
    expect(promptInputs[0]).toMatchObject({
      ref: sessionRef,
      content: [{ type: "text", text: "please help" }],
    });
    expect(replies[0]).toBe("Hello");

    await xmux.shutdown();
  });

  test("prompts the active session with image attachment content", async () => {
    const attachment = imageAttachment({
      attachmentId: "image-1",
      filename: "photo.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const { emitMessage, promptInputs, replies, xmux } = await initializeFallbackXmux({
      events: [completedEvent()],
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "describe this", attachments: [attachment] }));

    await eventually(() => promptInputs.length === 1);

    expect(attachment.open).toHaveBeenCalledWith({
      maxBytes: 10 * 1024 * 1024,
      signal: expect.any(AbortSignal),
    });
    expect(promptInputs[0]).toMatchObject({
      ref: sessionRef,
      content: [
        { type: "text", text: "describe this" },
        {
          type: "image",
          data: Buffer.from([1, 2, 3]).toString("base64"),
          mimeType: "image/png",
          name: "photo.png",
        },
      ],
    });

    await xmux.shutdown();
  });

  test("attachment-only messages are routed as prompts", async () => {
    const attachment = imageAttachment({
      attachmentId: "image-only",
      mimeType: "image/jpeg",
      bytes: new Uint8Array([4, 5]),
    });
    const { emitMessage, promptInputs, xmux } = await initializeFallbackXmux({
      events: [completedEvent()],
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "", attachments: [attachment] }));

    await eventually(() => promptInputs.length === 1);

    expect(promptInputs[0]).toMatchObject({
      content: [
        {
          type: "image",
          data: Buffer.from([4, 5]).toString("base64"),
          mimeType: "image/jpeg",
        },
      ],
    });

    await xmux.shutdown();
  });

  test("replies when prompt attachments are disabled", async () => {
    const attachment = imageAttachment({
      attachmentId: "disabled-image",
      mimeType: "image/png",
      bytes: new Uint8Array([1]),
    });
    const { emitMessage, promptInputs, replies, xmux } = await initializeFallbackXmux({
      promptAttachments: { enabled: false },
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "describe", attachments: [attachment] }));

    await eventually(() => replies.length === 1);

    expect(promptInputs).toHaveLength(0);
    expect(attachment.open).not.toHaveBeenCalled();
    expect(replies[0]).toContain("**Attachment unsupported**");
    expect(replies[0]).toContain("Attachments are disabled");

    await xmux.shutdown();
  });

  test("sends permission requests as a separate button message", async () => {
    const { emitMessage, replies, actionMessages, xmux } = await initializeFallbackXmux({
      events: [
        { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "Need access." },
        {
          type: "interaction",
          kind: "permission",
          phase: "requested",
          ref: sessionRef,
          requestId: "per_internal_1",
          prompt: "external_directory: /home/pro/dev/forks/pi/*",
          permission: {
            name: "external_directory",
            patterns: ["/home/pro/dev/forks/pi/*"],
            allowAlways: true,
          },
        },
        { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "Continuing." },
        completedEvent(),
      ],
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "go" }));

    await eventually(() => replies.length === 2 && actionMessages.length === 1);

    expect(replies[0]).toBe("Need access.");
    expect(replies[1]).toBe("Continuing.");

    expect(actionMessages[0]?.text).toBe(
      [
        "⚠️ **Permission requested**",
        "",
        "**Request**",
        "`external_directory`",
        "",
        "**Scope**",
        "- `/home/pro/dev/forks/pi/*`",
      ].join("\n"),
    );
    expect(actionMessages[0]?.text).not.toContain("/allow");
    expect(actionMessages[0]?.text).not.toContain("per_internal_1");
    expect(actionMessages[0]?.buttons).toEqual([
      [
        expect.objectContaining({ actionId: "i", value: "allow", payload: "1" }),
        expect.objectContaining({ actionId: "i", value: "always", payload: "1" }),
        expect.objectContaining({ actionId: "i", value: "reject", payload: "1" }),
      ],
    ]);

    await xmux.shutdown();
  });

  test("delivers harness text deltas through native replyStream", async () => {
    const { emitMessage, promptInputs, streams, xmux } = await initializeStreamingXmux({
      events: [
        { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "stream" },
        { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "ed" },
        completedEvent(),
      ],
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "go" }));

    await eventually(() => streams.length === 1);

    expect(promptInputs).toHaveLength(1);
    expect(streams[0]).toBe("streamed");

    await xmux.shutdown();
  });

  test("prompt setup failures become failed-to-prompt responses", async () => {
    const { emitMessage, replies, xmux } = await initializeFallbackXmux({
      promptError: new Error("adapter unavailable"),
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "hello" }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("**Failed to prompt session**");
    expect(replies[0]).toContain("adapter unavailable");

    await xmux.shutdown();
  });

  test("stream reply errors cancel and release the active run", async () => {
    const { promptInputs, xmux } = await initializeFallbackXmux();
    await bindSession({ xmux });

    const handled = await handlePromptMessage({
      ctx: createHandlerContext({
        app: xmux.ctx,
        chatId: "telegram",
        actor: { userId: "user-1", displayName: "Ishak" },
      }),
      event: promptMessageEvent({
        text: "hello",
        replyStream: async () => Result.err(new Error("stream down")),
      }),
    });

    expect(handled.isErr()).toBe(true);
    if (handled.isErr()) {
      expect(PromptResponseError.is(handled.error)).toBe(true);
      expect(handled.error.message).toContain("stream down");
    }
    expect((promptInputs[0] as { readonly signal: AbortSignal }).signal.aborted).toBe(true);
    expect(xmux.ctx.services.promptRuns.get(sessionRef)).toBeUndefined();

    await xmux.shutdown();
  });

  test("releases the session lease after failed and aborted streams", async () => {
    let promptCount = 0;
    const { emitMessage, promptInputs, replies, xmux } = await initializeFallbackXmux({
      onPrompt: () => {
        promptCount += 1;
        return promptCount === 1
          ? toAsync([
              { type: "run", phase: "failed", ref: sessionRef, reason: "error", error: "boom" },
            ])
          : promptCount === 2
            ? toAsync([{ type: "run", phase: "aborted", ref: sessionRef, reason: "aborted" }])
            : toAsync([
                { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "after" },
                completedEvent(),
              ]);
      },
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "one", messageId: "m1" }));
    await eventually(() => replies.length === 1);

    emitMessage(messageEvent({ text: "two", messageId: "m2" }));
    await eventually(() => replies.length === 2);

    emitMessage(messageEvent({ text: "three", messageId: "m3" }));
    await eventually(() => replies.length === 3);

    expect(promptInputs).toHaveLength(3);
    expect(replies[0]).toBe("**Prompt failed**\n\nboom");
    expect(replies[1]).toBe("**Prompt aborted**");
    expect(replies[2]).toBe("after");

    await xmux.shutdown();
  });

  test("releases the session lease after a thrown harness stream", async () => {
    let promptCount = 0;
    const { emitMessage, promptInputs, replies, xmux } = await initializeFallbackXmux({
      onPrompt: () => {
        promptCount += 1;
        return promptCount === 1
          ? throwingEvents(new Error("stream exploded"))
          : toAsync([
              { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "after" },
              completedEvent(),
            ]);
      },
    });
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "one", messageId: "m1" }));
    await eventually(() => replies.length === 1);

    emitMessage(messageEvent({ text: "two", messageId: "m2" }));
    await eventually(() => replies.length === 2);

    expect(promptInputs).toHaveLength(2);
    expect(replies[0]).toBe("**Prompt failed**\n\nstream exploded");
    expect(replies[1]).toBe("after");
    expect(xmux.ctx.services.promptRuns.get(sessionRef)).toBeUndefined();

    await xmux.shutdown();
  });

  test("records pending interactions from prompt events", async () => {
    const { xmux } = await initializeFallbackXmux({
      onPrompt: () => pendingInteractionEvents(),
    });
    await bindSession({ xmux });

    const prompted = await promptSessionForThread({
      ctx: createHandlerContext({
        app: xmux.ctx,
        chatId: "telegram",
        actor: { userId: "user-1", displayName: "Ishak" },
      }),
      thread,
      text: "needs permission",
    });

    expect(prompted.isOk()).toBe(true);
    const stream = prompted.unwrap("prompted").events[Symbol.asyncIterator]();

    expect((await stream.next()).value).toMatchObject({ type: "run", phase: "started" });
    expect((await stream.next()).value).toMatchObject({
      type: "interaction",
      phase: "requested",
      requestId: "permission-1",
    });

    const run = xmux.ctx.services.promptRuns.get(sessionRef);
    expect(run?.pendingInteractions).toEqual([
      expect.objectContaining({
        requestId: "permission-1",
        kind: "permission",
        prompt: "Run npm test?",
        ordinal: 1,
        status: "pending",
      }),
    ]);
    expect(run?.currentInteraction()?.requestId).toBe("permission-1");

    await stream.return?.();
    prompted.unwrap("prompted").release();
    expect(xmux.ctx.services.promptRuns.get(sessionRef)).toBeUndefined();

    await xmux.shutdown();
  });

  test("clears pending interactions when they are answered or rejected", async () => {
    const { xmux } = await initializeFallbackXmux({
      onPrompt: () => resolvedInteractionEvents(),
    });
    await bindSession({ xmux });

    const prompted = await promptSessionForThread({
      ctx: createHandlerContext({
        app: xmux.ctx,
        chatId: "telegram",
        actor: { userId: "user-1", displayName: "Ishak" },
      }),
      thread,
      text: "needs permission",
    });

    expect(prompted.isOk()).toBe(true);
    await collectAsync(prompted.unwrap("prompted").events);

    expect(xmux.ctx.services.promptRuns.get(sessionRef)).toBeUndefined();

    await xmux.shutdown();
  });

  test("keeps one active prompt per session and releases after completion", async () => {
    let finishFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let promptCount = 0;
    const { emitMessage, promptInputs, replies, xmux } = await initializeFallbackXmux({
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
    await bindSession({ xmux });

    emitMessage(messageEvent({ text: "one", messageId: "m1" }));
    await eventually(() => promptInputs.length === 1);

    emitMessage(messageEvent({ text: "two", messageId: "m2" }));
    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(
      "**Session is busy**\n\nWait for the current response to finish, then send another message.",
    );
    expect(promptInputs).toHaveLength(1);

    finishFirst();
    await eventually(() => replies.length === 2);

    emitMessage(messageEvent({ text: "three", messageId: "m3" }));
    await eventually(() => promptInputs.length === 2 && replies.length === 3);

    expect(replies).toContain("first");
    expect(replies).toContain("second");

    await xmux.shutdown();
  });
});

interface InitializeXmuxInput {
  readonly events?: readonly PiPromptEvent[];
  readonly promptAttachments?: PromptAttachmentsConfig;
  readonly promptError?: unknown;
  readonly onPrompt?: () => AsyncIterable<PiPromptEvent>;
}

async function initializeFallbackXmux(input: InitializeXmuxInput = {}) {
  const replies: string[] = [];
  const actionMessages: { readonly text: string; readonly buttons: unknown }[] = [];
  const promptInputs: unknown[] = [];
  let emitMessage: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: createHarnesses({ input, promptInputs }),
    chats: {
      telegram: defineChatAdapter<
        "telegram",
        Record<never, never>,
        Record<never, never>,
        typeof fallbackCapabilities
      >({
        id: "telegram",
        capabilities: fallbackCapabilities,
        async open() {
          return Result.ok({
            id: "telegram",
            async start(context) {
              emitMessage = context.emit as (event: unknown) => void;
              return Result.ok();
            },
            async sendMessage(message) {
              return Result.ok(sentMessage({ text: message.text, format: message.format }));
            },
            async sendAction(input) {
              actionMessages.push({ text: input.text, buttons: input.buttons });
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
      prompt: { attachments: input.promptAttachments },
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitMessage).toBeDefined();

  return {
    replies,
    actionMessages,
    promptInputs,
    emitMessage: emitMessage as (event: unknown) => void,
    xmux,
  };
}

async function initializeStreamingXmux(input: InitializeXmuxInput = {}) {
  const streams: string[] = [];
  const promptInputs: unknown[] = [];
  let emitMessage: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: createHarnesses({ input, promptInputs }),
    chats: {
      telegram: defineChatAdapter<
        "telegram",
        Record<never, never>,
        Record<never, never>,
        typeof streamingCapabilities
      >({
        id: "telegram",
        capabilities: streamingCapabilities,
        async open() {
          return Result.ok({
            id: "telegram",
            async start(context) {
              emitMessage = context.emit as (event: unknown) => void;
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
              return Result.ok(sentMessage({ text: message.text, format: message.format }));
            },
            async streamReply(message) {
              const text = await collectChatStream(message.content.chunks);
              streams.push(text);
              return Result.ok(sentMessage({ text, format: message.content.format }));
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
      prompt: { attachments: input.promptAttachments },
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitMessage).toBeDefined();

  return { streams, promptInputs, emitMessage: emitMessage as (event: unknown) => void, xmux };
}

function createHarnesses(input: {
  readonly input: InitializeXmuxInput;
  readonly promptInputs: unknown[];
}) {
  return {
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
            input.promptInputs.push(promptInput);
            if (input.input.promptError !== undefined) {
              return Result.err(input.input.promptError);
            }

            return Result.ok(
              input.input.onPrompt?.() ?? toAsync(input.input.events ?? defaultPromptEvents()),
            );
          },
          deleteSession: async () => Result.err(new Error("not implemented")),
          abort: async () => Result.err(new Error("not implemented")),
          close: async () => {},
        });
      },
    }),
  };
}

async function bindSession(input: {
  readonly xmux: { readonly ctx: { readonly store: Store } };
  readonly status?: "open" | "closed";
}) {
  const now = new Date().toISOString();
  const record = {
    ...createSessionRecord({
      ref: sessionRef,
      origin: thread,
      requester: { userId: "user-1" },
      cwd: process.cwd(),
      deliveryMode: "requester_only",
      now,
    }),
    status: input.status ?? "open",
    ...(input.status === "closed" ? { closedAt: now } : {}),
  };

  expect((await input.xmux.ctx.store.sessions.create(record)).isOk()).toBe(true);
  expect(
    (
      await input.xmux.ctx.store.threadBindings.bind(
        createThreadBinding({ thread, sessionRef, now }),
      )
    ).isOk(),
  ).toBe(true);
}

function promptMessageEvent(input: {
  readonly text: string;
  readonly replyStream: PromptMessageEvent<"telegram">["replyStream"];
}): PromptMessageEvent<"telegram"> {
  return {
    ...(messageEvent({ text: input.text }) as ReturnType<typeof messageEvent>),
    reply: async () => Result.ok({}),
    replyStream: input.replyStream,
  } as PromptMessageEvent<"telegram">;
}

function messageEvent(input: {
  readonly text: string;
  readonly actorKind?: "user" | "bot" | "system";
  readonly attachments?: readonly ChatAttachment[];
  readonly messageId?: string;
}) {
  const actor =
    input.actorKind === "system"
      ? { kind: "system", actorId: "system", adapterData: {} }
      : {
          kind: input.actorKind ?? "user",
          actorId: input.actorKind === "bot" ? "bot-1" : "user-1",
          displayName: input.actorKind === "bot" ? "Bot" : "Ishak",
          adapterData: {},
        };

  return {
    type: "message",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: {
      chatId: "telegram",
      conversationId: thread.threadId,
      messageId: input.messageId ?? "message-1",
      actor,
      text: input.text,
      adapterData: {},
      attachments: input.attachments ?? [],
    },
  };
}

function imageAttachment(input: {
  readonly attachmentId: string;
  readonly bytes: Uint8Array;
  readonly filename?: string;
  readonly mimeType: string;
  readonly sizeBytes?: number;
}): ChatAttachment {
  return {
    attachmentId: input.attachmentId,
    kind: "image",
    disposition: "inline",
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes ?? input.bytes.byteLength,
    adapterData: {},
    open: vi.fn(async () =>
      Result.ok({
        chunks: toAsync([input.bytes]),
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
      }),
    ),
  };
}

function defaultPromptEvents(): readonly PiPromptEvent[] {
  return [
    { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "ok" },
    completedEvent(),
  ];
}

function completedEvent(): PiPromptEvent {
  return { type: "run", phase: "completed", ref: sessionRef, reason: "stop" };
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

async function collectChatStream(
  chunks: AsyncIterable<{ readonly type: string; readonly delta?: string; readonly text?: string }>,
) {
  let text = "";

  for await (const chunk of chunks) {
    if (chunk.type === "delta") {
      text += chunk.delta ?? "";
      continue;
    }

    if (chunk.text !== undefined) {
      text = chunk.text;
    }
  }

  return text;
}

async function* controlledEvents(input: {
  readonly text: string;
  readonly waitFor: Promise<void>;
}): AsyncIterable<PiPromptEvent> {
  yield { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: input.text };
  await input.waitFor;
  yield { type: "run", phase: "completed", ref: sessionRef, reason: "stop" };
}

async function* throwingEvents(error: unknown): AsyncIterable<PiPromptEvent> {
  if (Date.now() < 0) yield completedEvent();
  throw error;
}

async function* pendingInteractionEvents(): AsyncIterable<PiPromptEvent> {
  yield {
    type: "interaction",
    kind: "permission",
    phase: "requested",
    requestId: "permission-1",
    prompt: "Run npm test?",
    ref: sessionRef,
  };
  await new Promise<never>(() => {});
}

async function* resolvedInteractionEvents(): AsyncIterable<PiPromptEvent> {
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
    phase: "answered",
    requestId: "permission-1",
    ref: sessionRef,
  };
  yield completedEvent();
}

async function collectAsync<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

async function* toAsync<T>(values: readonly T[]): AsyncIterable<T> {
  yield* values;
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }

    await delay(5);
  }

  expect(predicate()).toBe(true);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
