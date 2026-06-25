import { describe, expect, test, vi } from "vitest";
import { Result } from "@xmux/orchestrator";
import {
  createAccessControlMiddlewareHandler,
  type AccessControlMiddlewareContext,
  type ChatAccessPolicies,
} from "../src/orchestrator/middleware/access-control";
import {
  createTypingIndicatorMiddlewareHandler,
  type TypingIndicatorMiddlewareContext,
  type TypingIndicatorMiddlewareEvent,
} from "../src/orchestrator/middleware/typing-indicator";
import type { XmuxLogScope } from "@xmux/orchestrator";

const createLogger = (): XmuxLogScope => {
  let logger: XmuxLogScope;
  logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
};

const chats = (
  access:
    | { readonly type: "anyone" }
    | { readonly type: "allow-list"; readonly users: readonly [string, ...string[]] },
): ChatAccessPolicies => ({ telegram: { access } });

const accessContext = (
  input: {
    readonly actorUserId?: string;
    readonly event?: Partial<AccessControlMiddlewareContext["event"]>;
  } = {},
): AccessControlMiddlewareContext => ({
  handler: {
    actor: input.actorUserId === undefined ? undefined : { userId: input.actorUserId },
    logger: createLogger(),
  },
  event: {
    chatId: "telegram",
    conversation: { conversationId: "conversation-1" },
    ...input.event,
  },
  route: { name: "test-route", eventType: "command" },
});

const typingContext = (
  event: Partial<TypingIndicatorMiddlewareEvent> = {},
): TypingIndicatorMiddlewareContext => ({
  handler: { logger: createLogger() },
  event: {
    chatId: "telegram",
    conversation: { conversationId: "conversation-1" },
    ...event,
  },
  route: { name: "test-route", eventType: "command" },
});

const okNext = (onCall: () => void) => async () => {
  onCall();
  return Result.ok<void, unknown>(undefined);
};

type TypingIndicator = NonNullable<TypingIndicatorMiddlewareEvent["typingIndicator"]>;

describe("server orchestrator access-control middleware", () => {
  test("allow-list permits configured actor", async () => {
    let called = false;
    const middleware = createAccessControlMiddlewareHandler(
      chats({ type: "allow-list", users: ["user-1"] }),
    );

    const result = await middleware(
      accessContext({ actorUserId: "user-1" }),
      okNext(() => {
        called = true;
      }),
    );

    expect(result.isOk()).toBe(true);
    expect(called).toBe(true);
  });

  test("allow-list denies missing actor, skips next, and attempts reply", async () => {
    let called = false;
    const reply = vi.fn<(_: string) => Promise<void>>(() => Promise.resolve());
    const middleware = createAccessControlMiddlewareHandler(
      chats({ type: "allow-list", users: ["user-1"] }),
    );

    const result = await middleware(
      accessContext({ event: { reply } }),
      okNext(() => {
        called = true;
      }),
    );

    expect(result.isOk()).toBe(true);
    expect(called).toBe(false);
    expect(reply).toHaveBeenCalledWith("Sorry, you are not allowed to use this bot.");
  });

  test("allow-list denies unknown actor", async () => {
    let called = false;
    const middleware = createAccessControlMiddlewareHandler(
      chats({ type: "allow-list", users: ["user-1"] }),
    );

    const result = await middleware(
      accessContext({ actorUserId: "user-2" }),
      okNext(() => {
        called = true;
      }),
    );

    expect(result.isOk()).toBe(true);
    expect(called).toBe(false);
  });

  test("anyone permits request", async () => {
    let called = false;
    const middleware = createAccessControlMiddlewareHandler(chats({ type: "anyone" }));

    const result = await middleware(
      accessContext(),
      okNext(() => {
        called = true;
      }),
    );

    expect(result.isOk()).toBe(true);
    expect(called).toBe(true);
  });
});

describe("server orchestrator typing-indicator middleware", () => {
  test("fast next does not start typing", async () => {
    vi.useFakeTimers();
    try {
      const typingIndicator = vi.fn<TypingIndicator>(() =>
        Promise.resolve(Result.ok({ stop: vi.fn() })),
      );
      const middleware = createTypingIndicatorMiddlewareHandler(10);

      const result = await middleware(typingContext({ typingIndicator }), async () =>
        Result.ok<void, unknown>(undefined),
      );
      await vi.advanceTimersByTimeAsync(10);

      expect(result.isOk()).toBe(true);
      expect(typingIndicator).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("slow next starts typing and stops in finally", async () => {
    vi.useFakeTimers();
    try {
      let finishNext: () => void = () => undefined;
      let stopped = false;
      const typingIndicator = vi.fn<TypingIndicator>(() =>
        Promise.resolve(
          Result.ok({
            stop: () => {
              stopped = true;
            },
          }),
        ),
      );
      const middleware = createTypingIndicatorMiddlewareHandler(10);

      const running = middleware(typingContext({ typingIndicator }), async () => {
        await new Promise<void>((resolve) => {
          finishNext = resolve;
        });
        return Result.ok<void, unknown>(undefined);
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(typingIndicator).toHaveBeenCalledWith({ mode: "managed", fallback: "ignore" });

      finishNext();
      const result = await running;

      expect(result.isOk()).toBe(true);
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("typing stop failures do not fail request", async () => {
    vi.useFakeTimers();
    try {
      let finishNext: () => void = () => undefined;
      const typingIndicator = vi.fn<TypingIndicator>(() =>
        Promise.resolve(
          Result.ok({
            stop: () => {
              throw new Error("stop failed");
            },
          }),
        ),
      );
      const middleware = createTypingIndicatorMiddlewareHandler(10);

      const running = middleware(typingContext({ typingIndicator }), async () => {
        await new Promise<void>((resolve) => {
          finishNext = resolve;
        });
        return Result.ok<void, unknown>(undefined);
      });

      await vi.advanceTimersByTimeAsync(10);
      finishNext();
      const result = await running;

      expect(result.isOk()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("typing synchronous start throws do not fail request", async () => {
    vi.useFakeTimers();
    try {
      let finishNext: () => void = () => undefined;
      const typingIndicator = vi.fn<TypingIndicator>(() => {
        throw new Error("start failed");
      });
      const middleware = createTypingIndicatorMiddlewareHandler(10);

      const running = middleware(typingContext({ typingIndicator }), async () => {
        await new Promise<void>((resolve) => {
          finishNext = resolve;
        });
        return Result.ok<void, unknown>(undefined);
      });

      await vi.advanceTimersByTimeAsync(10);
      finishNext();
      const result = await running;

      expect(result.isOk()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("typing Result failures do not fail request", async () => {
    vi.useFakeTimers();
    try {
      let finishNext: () => void = () => undefined;
      const typingIndicator = vi.fn<TypingIndicator>(() =>
        Promise.resolve(Result.err(new Error("typing failed"))),
      );
      const middleware = createTypingIndicatorMiddlewareHandler(10);

      const running = middleware(typingContext({ typingIndicator }), async () => {
        await new Promise<void>((resolve) => {
          finishNext = resolve;
        });
        return Result.ok<void, unknown>(undefined);
      });

      await vi.advanceTimersByTimeAsync(10);
      finishNext();
      const result = await running;

      expect(result.isOk()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
