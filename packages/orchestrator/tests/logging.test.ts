import { defineChatAdapter, type ChatAdapterCapabilities } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { Result } from "better-result";
import { describe, expect, test, vi } from "vitest";
import {
  createXmux,
  createXmuxResult,
  runXmuxHandler,
  xmuxLogEvents,
  XmuxMiddlewareExecutionError,
  type XmuxLogger,
} from "../src";
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
} as const satisfies ChatAdapterCapabilities;

const thread = { chatId: "telegram", threadId: "conversation-1" } as const;
const sessionRef = { harnessId: "pi", sessionId: "session-1" } as const;

describe("orchestrator logging", () => {
  test("emits config, initialize, and shutdown lifecycle logs", async () => {
    const configLogger = createMockLogger();
    const invalid = createXmuxResult({
      harnesses: createHarnesses(),
      chats: createChats({ replies: [], setEmit: () => {} }),
      logger: configLogger,
      config: {
        defaultWorkingDirectory: process.cwd(),
        deliveryMode: "invalid" as never,
      },
    });

    expect(invalid.isErr()).toBe(true);
    expect(configLogger.error).toHaveBeenCalledWith(
      xmuxLogEvents.configFailure,
      expect.objectContaining({
        component: "@xmux/orchestrator",
        packageName: "@xmux/orchestrator",
        result: "error",
        error: expect.objectContaining({ tag: "XmuxConfigurationError" }),
      }),
    );

    const logger = createMockLogger();
    const xmux = createXmux({
      harnesses: createHarnesses(),
      chats: createChats({ replies: [], setEmit: () => {} }),
      logger,
      config: validConfig(),
    });

    expect((await xmux.initialize()).isOk()).toBe(true);
    expect((await xmux.shutdown()).isOk()).toBe(true);

    expectLog(logger, "debug", xmuxLogEvents.initializeBegin);
    expectLog(logger, "debug", xmuxLogEvents.initializeSuccess, { result: "ok" });
    expectLog(logger, "debug", xmuxLogEvents.shutdownBegin);
    expectLog(logger, "debug", xmuxLogEvents.shutdownSuccess, { result: "ok" });
  });

  test("correlates route, harness, and chat logs with request context", async () => {
    const logger = createMockLogger();
    const replies: string[] = [];
    let emit: ((event: unknown) => void) | undefined;
    const xmux = createXmux({
      harnesses: createHarnesses(),
      chats: createChats({ replies, setEmit: (next) => (emit = next) }),
      logger,
      config: validConfig(),
    });
    expect((await xmux.initialize()).isOk()).toBe(true);

    emit?.(newCommandEvent());
    await eventually(() => replies.length === 1);

    const routeSuccess = findLog(logger, xmuxLogEvents.routeSuccess, (metadata) =>
      matches(metadata, { routeName: "new", eventType: "command", chatId: "telegram" }),
    );
    expect(routeSuccess).toBeDefined();
    const requestId = metadataOf(routeSuccess).requestId;
    expect(typeof requestId).toBe("string");

    expect(
      findLog(logger, "xmux.harness.operation.begin", (metadata) =>
        matches(metadata, {
          requestId,
          routeName: "new",
          eventType: "command",
          chatId: "telegram",
          conversationId: "conversation-1",
          operation: "createSession",
        }),
      ),
    ).toBeDefined();

    expect(
      findLog(logger, "xmux.chat.operation.begin", (metadata) =>
        matches(metadata, {
          requestId,
          routeName: "new",
          eventType: "command",
          chatId: "telegram",
          conversationId: "conversation-1",
        }),
      ),
    ).toBeDefined();

    expect(countLogs(logger, "xmux.harness.operation.begin")).toBe(1);
    await xmux.shutdown();
  });

  test("logs route failures and converts thrown handlers to middleware execution errors", async () => {
    const logger = createMockLogger();
    const xmux = createXmux({
      harnesses: createHarnesses(),
      chats: createChats({ replies: [], setEmit: () => {} }),
      logger,
      config: validConfig(),
    });

    const handled = await runXmuxHandler({
      app: xmux.ctx,
      event: messageEvent({ text: "hello" }),
      middleware: [],
      routeName: "throwing-route",
      handler: async () => {
        throw new Error("boom");
      },
    });

    expect(handled.isErr()).toBe(true);
    if (handled.isErr()) {
      expect(XmuxMiddlewareExecutionError.is(handled.error)).toBe(true);
    }

    expectLog(logger, "error", xmuxLogEvents.routeFailure, {
      routeName: "throwing-route",
      result: "error",
    });

    await xmux.shutdown();
  });

  test("does not leak raw prompt payloads into logs", async () => {
    const logger = createMockLogger();
    const replies: string[] = [];
    let emit: ((event: unknown) => void) | undefined;
    const xmux = createXmux({
      harnesses: createHarnesses(),
      chats: createChats({ replies, setEmit: (next) => (emit = next) }),
      logger,
      config: validConfig(),
    });
    expect((await xmux.initialize()).isOk()).toBe(true);
    await bindOpenSession(xmux);

    emit?.(messageEvent({ text: "super-secret prompt text" }));
    await eventually(() => replies.length === 1);

    expect(JSON.stringify(allCalls(logger))).not.toContain("super-secret prompt text");
    await xmux.shutdown();
  });

  test("throwing caller loggers do not affect lifecycle or routes", async () => {
    const logger = createThrowingLogger();
    const replies: string[] = [];
    let emit: ((event: unknown) => void) | undefined;
    const xmux = createXmux({
      harnesses: createHarnesses(),
      chats: createChats({ replies, setEmit: (next) => (emit = next) }),
      logger,
      config: validConfig(),
    });

    expect((await xmux.initialize()).isOk()).toBe(true);
    emit?.(newCommandEvent());
    await eventually(() => replies.length === 1);
    expect((await xmux.shutdown()).isOk()).toBe(true);
  });
});

function createHarnesses() {
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
          async prompt() {
            return Result.ok(
              toAsync([
                { type: "run", phase: "completed", ref: sessionRef, reason: "stop" } as const,
              ]),
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

function createChats(input: {
  readonly replies: string[];
  readonly setEmit: (emit: (event: unknown) => void) => void;
}) {
  return {
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
            input.setEmit(context.emit as (event: unknown) => void);
            return Result.ok();
          },
          async sendMessage(message) {
            input.replies.push(message.text);
            return Result.ok(sentMessage(message.text));
          },
          async sendAction(action) {
            input.replies.push(action.text);
            return Result.ok(sentMessage(action.text));
          },
          async respondToAction() {
            return Result.ok();
          },
          async reply(message) {
            input.replies.push(message.text);
            return Result.ok(sentMessage(message.text));
          },
          close: async () => {},
        });
      },
    }),
  };
}

function validConfig() {
  return {
    defaultWorkingDirectory: process.cwd(),
    deliveryMode: "requester_only" as const,
  };
}

async function bindOpenSession(xmux: { readonly ctx: { readonly store: Store } }) {
  const now = new Date().toISOString();
  expect(
    (
      await xmux.ctx.store.sessions.create(
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
    (
      await xmux.ctx.store.threadBindings.bind(createThreadBinding({ thread, sessionRef, now }))
    ).isOk(),
  ).toBe(true);
}

function newCommandEvent() {
  return {
    type: "command" as const,
    chatId: "telegram" as const,
    conversation: { chatId: "telegram" as const, conversationId: "conversation-1" },
    actor: { kind: "user" as const, actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: {
      chatId: "telegram" as const,
      conversationId: "conversation-1",
      messageId: "message-1",
    },
    command: {
      name: "new" as const,
      options: { harnessId: "pi", title: "Fix bug" },
    },
  };
}

function messageEvent(input: { readonly text: string }) {
  return {
    type: "message" as const,
    chatId: "telegram" as const,
    conversation: { chatId: "telegram" as const, conversationId: "conversation-1" },
    message: {
      chatId: "telegram" as const,
      conversationId: "conversation-1",
      messageId: "message-1",
      actor: { kind: "user" as const, actorId: "user-1", displayName: "Ishak", adapterData: {} },
      text: input.text,
      adapterData: {},
      attachments: [],
    },
  };
}

function sentMessage(text: string) {
  return {
    chatId: "telegram" as const,
    conversationId: "conversation-1",
    messageId: "reply-1",
    text,
    adapterData: {},
  };
}

type LoggerFn = (message?: unknown, ...optionalParams: unknown[]) => void;
type LoggerMock = ReturnType<typeof vi.fn<LoggerFn>>;
type MockXmuxLogger = XmuxLogger & {
  readonly trace: LoggerMock;
  readonly debug: LoggerMock;
  readonly info: LoggerMock;
  readonly warn: LoggerMock;
  readonly error: LoggerMock;
};

function createMockLogger(): MockXmuxLogger {
  return {
    trace: vi.fn<LoggerFn>(),
    debug: vi.fn<LoggerFn>(),
    info: vi.fn<LoggerFn>(),
    warn: vi.fn<LoggerFn>(),
    error: vi.fn<LoggerFn>(),
  };
}

function createThrowingLogger(): XmuxLogger {
  const fail = vi.fn<LoggerFn>(() => {
    throw new Error("logger failed");
  });

  return { trace: fail, debug: fail, info: fail, warn: fail, error: fail };
}

function expectLog(
  logger: MockXmuxLogger,
  level: keyof Pick<MockXmuxLogger, "debug" | "error" | "info" | "trace" | "warn">,
  event: string,
  metadata?: Record<string, unknown>,
) {
  expect(logger[level]).toHaveBeenCalledWith(
    event,
    metadata === undefined ? expect.any(Object) : expect.objectContaining(metadata),
  );
}

function findLog(
  logger: MockXmuxLogger,
  event: string,
  predicate: (metadata: Record<string, unknown>) => boolean = () => true,
) {
  return allCalls(logger).find((call) => call[0] === event && predicate(metadataOf(call)));
}

function countLogs(logger: MockXmuxLogger, event: string): number {
  return allCalls(logger).filter((call) => call[0] === event).length;
}

function allCalls(logger: MockXmuxLogger): unknown[][] {
  return [
    ...logger.trace.mock.calls,
    ...logger.debug.mock.calls,
    ...logger.info.mock.calls,
    ...logger.warn.mock.calls,
    ...logger.error.mock.calls,
  ];
}

function metadataOf(call: unknown[] | undefined): Record<string, unknown> {
  const metadata = call?.[1];
  return typeof metadata === "object" && metadata !== null
    ? (metadata as Record<string, unknown>)
    : {};
}

function matches(metadata: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => metadata[key] === value);
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await delay(5);
  }

  expect(predicate()).toBe(true);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* toAsync<T>(values: readonly T[]): AsyncIterable<T> {
  yield* values;
}
