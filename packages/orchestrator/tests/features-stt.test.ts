import { Result } from "better-result";
import { afterEach, describe, expect, test, vi } from "vitest";
import { defineChatAdapter, type ChatAttachment } from "@xmux/chat-core";
import { defineHarnessAdapter, type HarnessPromptEvent } from "@xmux/harness-core";
import { createHandlerContext, createXmux, type Config } from "../src";
import {
  handleSttAction,
  handleSttAudioMessage,
  type HandleSttActionInput,
} from "../src/features/stt";
import { createSessionRecord, createThreadBinding, type Store } from "../src/store";
import type { PromptMessageEvent } from "../src/features/prompt";

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

describe("STT voice messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("replies when STT is disabled and does not call the harness", async () => {
    const { ctx, promptInputs, replies, xmux } = await initializeXmux();
    const event = promptMessageEvent({ text: "", attachment: audioAttachment("voice-1"), replies });

    const attachment = event.message.attachments[0];
    if (attachment === undefined) throw new Error("missing attachment");
    const handled = await handleSttAudioMessage({ ctx, event, attachment });

    expect(handled.isOk()).toBe(true);
    expect(promptInputs).toHaveLength(0);
    expect(replies[0]).toBe(
      "**STT is not enabled**\n\nConfigure `stt` in xmux config to transcribe voice messages.",
    );

    await xmux.shutdown();
  });

  test("transcribes audio, asks for confirmation, and sends transcript as a prompt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ text: "hello from voice" }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const { actionMessages, ctx, promptInputs, replies, updates, xmux } = await initializeXmux({
      stt: { enabled: true, model: "whisper-test", baseUrl: "http://stt.local/v1" },
    });
    await bindSession(xmux.ctx.store);

    const attachment = audioAttachment("voice-2");
    const event = promptMessageEvent({ text: "caption", attachment });

    const started = await handleSttAudioMessage({ ctx, event, attachment });

    expect(started.isOk()).toBe(true);
    expect(actionMessages[0]?.text).toContain("🎙️ **Transcribing...**");
    expect(attachment.open).toHaveBeenCalledWith({
      maxBytes: 25 * 1024 * 1024,
      signal: expect.any(AbortSignal),
    });

    await eventually(() => actionMessages.length === 2);

    expect(actionMessages[1]?.text).toBe("✅ **Transcription ready**\n\nhello from voice");
    const runId = firstPayload(actionMessages[1]?.buttons);

    const sent = await handleSttAction({
      ctx,
      event: sttActionEvent({ value: "send", runId, updates, replies }),
    });

    expect(sent.isOk()).toBe(true);
    expect(promptInputs).toHaveLength(1);
    expect(promptInputs[0]).toMatchObject({
      ref: sessionRef,
      content: [{ type: "text", text: "caption\n\nVoice transcription:\nhello from voice" }],
    });
    expect(updates.at(-1)?.text).toBe("**Transcription sent**");
    expect(replies).toContain("ok");

    await xmux.shutdown();
  });

  test("cancel aborts an in-flight transcription", async () => {
    let capturedSignal: AbortSignal | undefined;
    const { actionMessages, ctx, replies, updates, xmux } = await initializeXmux({
      stt: { enabled: true, model: "whisper-test", baseUrl: "http://stt.local/v1" },
    });
    const attachment = audioAttachment("voice-3", async (_input) => {
      capturedSignal = _input?.signal;
      return await new Promise<never>(() => {});
    });
    const event = promptMessageEvent({ text: "", attachment });

    const started = await handleSttAudioMessage({ ctx, event, attachment });
    expect(started.isOk()).toBe(true);

    const runId = firstPayload(actionMessages[0]?.buttons);
    const cancelled = await handleSttAction({
      ctx,
      event: sttActionEvent({ value: "cancel", runId, updates, replies }),
    });

    expect(cancelled.isOk()).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
    expect(updates[0]?.text).toBe("**Transcription cancelled**");

    await xmux.shutdown();
  });
});

async function initializeXmux(input: { readonly stt?: Config["stt"] } = {}) {
  const actionMessages: { readonly text: string; readonly buttons: unknown }[] = [];
  const promptInputs: unknown[] = [];
  const replies: string[] = [];
  const updates: { readonly text: string }[] = [];

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
              return Result.ok(
                toAsync<PiPromptEvent>([
                  { type: "content", phase: "delta", kind: "text", ref: sessionRef, delta: "ok" },
                  { type: "run", phase: "completed", ref: sessionRef, reason: "stop" },
                ]),
              );
            },
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
            start: async () => Result.ok(),
            async sendMessage(message) {
              return Result.ok(sentMessage(message.text));
            },
            async sendAction(action) {
              actionMessages.push({ text: action.text, buttons: action.buttons });
              return Result.ok(sentMessage(action.text));
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
      userName: "xmux",
      defaultWorkingDirectory: process.cwd(),
      deliveryMode: "requester_only",
      stt: input.stt,
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  const ctx = createHandlerContext({
    app: xmux.ctx,
    chatId: "telegram",
    actor: { userId: "user-1", displayName: "Ishak" },
  });
  return { actionMessages, ctx, promptInputs, replies, updates, xmux };
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
          deliveryMode: "requester_only",
          now,
        }),
      )
    ).isOk(),
  ).toBe(true);
  expect(
    (await store.threadBindings.bind(createThreadBinding({ thread, sessionRef, now }))).isOk(),
  ).toBe(true);
}

function promptMessageEvent(input: {
  readonly text: string;
  readonly attachment: ChatAttachment;
  readonly replies?: string[];
}): PromptMessageEvent<"telegram"> {
  return {
    type: "message",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: {
      chatId: "telegram",
      conversationId: thread.threadId,
      messageId: "message-1",
      actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
      text: input.text,
      format: "plain",
      attachments: [input.attachment],
      adapterData: {},
    },
    reply: async (message) => {
      const text = typeof message === "string" ? message : message.text;
      input.replies?.push(text);
      return Result.ok(sentMessage(text));
    },
    replyStream: async () => Result.ok(sentMessage("")),
  };
}

function sttActionEvent(input: {
  readonly value: "cancel" | "send";
  readonly runId: string;
  readonly updates: { readonly text: string }[];
  readonly replies: string[];
}): HandleSttActionInput<Record<"pi", never>, Record<"telegram", never>>["event"] {
  return {
    type: "action",
    actionId: "stt",
    value: input.value,
    payload: input.runId,
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "action-1" },
    interactionId: "interaction-1",
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    ack: async () => Result.ok(),
    reply: async (message) => {
      input.replies.push(typeof message === "string" ? message : message.text);
      return Result.ok(sentMessage(typeof message === "string" ? message : message.text));
    },
    update: async (update) => {
      const text =
        typeof update?.message === "string" ? update.message : (update?.message?.text ?? "");
      input.updates.push({ text });
      return Result.ok(sentMessage(text));
    },
  } as HandleSttActionInput<Record<"pi", never>, Record<"telegram", never>>["event"];
}

function audioAttachment(attachmentId: string, open?: ChatAttachment["open"]): ChatAttachment {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    attachmentId,
    kind: "audio",
    filename: "voice.ogg",
    mimeType: "audio/ogg",
    sizeBytes: bytes.byteLength,
    adapterData: {},
    open: vi.fn(
      open ??
        (async () =>
          Result.ok({ chunks: toAsync([bytes]), filename: "voice.ogg", mimeType: "audio/ogg" })),
    ),
  };
}

function firstPayload(buttons: unknown): string {
  const row = Array.isArray(buttons) ? buttons[0] : undefined;
  const button = Array.isArray(row) ? row[0] : undefined;
  if (
    typeof button === "object" &&
    button !== null &&
    "payload" in button &&
    typeof button.payload === "string"
  ) {
    return button.payload;
  }
  throw new Error("missing payload");
}

function sentMessage(text: string) {
  return {
    chatId: "telegram" as const,
    conversationId: thread.threadId,
    messageId: "reply-1",
    text,
    adapterData: {},
  };
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
