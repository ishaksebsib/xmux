import { describe, expect, test } from "vitest";
import {
  ChatAdapterOpenError,
  ChatAdapterStartError,
  ChatCloseError,
  ChatLifecycleError,
  chatLogEvents,
  safeStatusReason,
  createChat,
  type ChatLogger,
} from "../src";
import {
  commands,
  createHandles,
  createMockLogger,
  createRuntimeAdapter,
} from "./fixtures/test-adapter";

describe("chat lifecycle", () => {
  test("reports configured adapter status before start", () => {
    const handles = createHandles();
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles }),
        beta: createRuntimeAdapter({ id: "beta", handles }),
      },
      commands,
    });

    expect(chat.status()).toEqual({
      lifecycle: "created",
      adapters: [
        { id: "alpha", state: "configured" },
        { id: "beta", state: "configured" },
      ],
    });
    expect(handles.opens).toEqual([]);
  });

  test("reports active adapter status after start", async () => {
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha" }),
        beta: createRuntimeAdapter({ id: "beta" }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);

    expect(chat.status()).toEqual({
      lifecycle: "started",
      adapters: [
        { id: "alpha", state: "active" },
        { id: "beta", state: "active" },
      ],
    });
  });

  test("reports stopped adapter status after close", async () => {
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha" }) },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    expect((await chat.close()).isOk()).toBe(true);

    expect(chat.status()).toEqual({
      lifecycle: "closed",
      adapters: [{ id: "alpha", state: "stopped" }],
    });
  });

  test("reports failing adapter open status with a safe reason", async () => {
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          throwOnOpen: new Error("secret-token-should-not-leak"),
        }),
      },
      commands,
    });

    expect((await chat.start()).isErr()).toBe(true);

    expect(chat.status()).toEqual({
      lifecycle: "created",
      adapters: [{ id: "alpha", state: "failed", reason: "ChatAdapterOpenError" }],
    });
    expect(JSON.stringify(chat.status())).not.toContain("secret-token-should-not-leak");
  });

  test("classifies authentication failures without exposing raw messages", () => {
    const reason = safeStatusReason({
      _tag: "ChatAdapterStartError",
      chatId: "telegram",
      cause: {
        _tag: "TelegramStartError",
        operation: "init",
        cause: new Error("401 Unauthorized: secret-token-should-not-leak"),
      },
    });

    expect(reason).toBe("authentication_failed");
    expect(reason).not.toContain("secret-token-should-not-leak");
  });

  test("reports failing adapter start status with a safe reason after startup cleanup", async () => {
    const handles = createHandles();
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles }),
        beta: createRuntimeAdapter({
          id: "beta",
          handles,
          throwOnStart: new Error("start-secret-should-not-leak"),
        }),
      },
      commands,
    });

    expect((await chat.start()).isErr()).toBe(true);

    expect(chat.status()).toEqual({
      lifecycle: "created",
      adapters: [
        { id: "alpha", state: "stopped" },
        { id: "beta", state: "failed", reason: "startup_failed" },
      ],
    });
    expect(JSON.stringify(chat.status())).not.toContain("start-secret-should-not-leak");
  });

  test("opens and starts each adapter with commands and emits ready", async () => {
    const handles = createHandles();
    const ready: string[] = [];
    const seenCommands: string[] = [];

    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          onStart: (context) => {
            seenCommands.push(context.commands.start?.description ?? "missing");
          },
        }),
        beta: createRuntimeAdapter({ id: "beta", handles }),
      },
      commands,
    });

    chat.on("ready", (event) => {
      ready.push(event.chatId);
    });

    const started = await chat.start();

    expect(started.isOk()).toBe(true);
    expect(handles.opens).toEqual(["alpha", "beta"]);
    expect(handles.starts).toEqual(["alpha", "beta"]);
    expect(seenCommands).toEqual(["Start"]);
    expect(ready).toEqual(["alpha", "beta"]);
  });

  test("passes injected logger to adapter open and start contexts", async () => {
    const logger = createMockLogger();
    let openLogger: ChatLogger | undefined;
    let startLogger: ChatLogger | undefined;
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          onOpen: (context) => {
            openLogger = context.logger;
          },
          onStart: (context) => {
            startLogger = context.logger;
          },
        }),
      },
      commands,
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    expect(openLogger).toBe(logger);
    expect(startLogger).toBe(logger);
  });

  test("wraps returned and thrown adapter open failures", async () => {
    const returned = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha", openError: new Error("returned") }) },
      commands,
    });
    const thrown = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha", throwOnOpen: new Error("thrown") }) },
      commands,
    });

    for (const started of [await returned.start(), await thrown.start()]) {
      expect(started.isErr()).toBe(true);
      if (started.isErr()) expect(started.error).toBeInstanceOf(ChatAdapterOpenError);
    }
  });

  test("wraps returned and thrown adapter start failures and cleans opened runtimes", async () => {
    const returnedHandles = createHandles();
    const thrownHandles = createHandles();
    const returned = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles: returnedHandles }),
        beta: createRuntimeAdapter({
          id: "beta",
          handles: returnedHandles,
          startError: new Error("returned"),
        }),
      },
      commands,
    });
    const thrown = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles: thrownHandles }),
        beta: createRuntimeAdapter({
          id: "beta",
          handles: thrownHandles,
          throwOnStart: new Error("thrown"),
        }),
      },
      commands,
    });

    for (const started of [await returned.start(), await thrown.start()]) {
      expect(started.isErr()).toBe(true);
      if (started.isErr()) expect(started.error).toBeInstanceOf(ChatAdapterStartError);
    }
    expect(returnedHandles.closes).toEqual(["alpha", "beta"]);
    expect(thrownHandles.closes).toEqual(["alpha", "beta"]);
  });

  test("logs startup cleanup close failures as warnings", async () => {
    const handles = createHandles();
    const logger = createMockLogger();
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          handles,
          closeError: new Error("cleanup failed"),
        }),
        beta: createRuntimeAdapter({ id: "beta", handles, throwOnStart: new Error("boom") }),
      },
      commands,
      logger,
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    expect(handles.closes).toEqual(["alpha", "beta"]);
    expect(logger.warn).toHaveBeenCalledWith(
      chatLogEvents.adapterCloseFailure,
      expect.objectContaining({
        chatId: "alpha",
        operation: "closeAdapter",
        reason: "startup_cleanup",
        error: expect.objectContaining({
          cause: expect.objectContaining({ message: "cleanup failed" }),
        }),
      }),
    );
  });

  test("returns lifecycle errors for invalid transitions", async () => {
    const chat = createChat({
      adapters: { alpha: createRuntimeAdapter({ id: "alpha" }) },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const secondStart = await chat.start();

    expect(secondStart.isErr()).toBe(true);
    if (secondStart.isErr()) {
      expect(secondStart.error).toBeInstanceOf(ChatLifecycleError);
      if (ChatLifecycleError.is(secondStart.error)) {
        expect(secondStart.error.operation).toBe("start");
      }
    }
  });

  test("close attempts every opened runtime and aggregates failures", async () => {
    const handles = createHandles();
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({ id: "alpha", handles, closeError: new Error("boom") }),
        beta: createRuntimeAdapter({ id: "beta", handles }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    const closed = await chat.close();

    expect(handles.closes).toEqual(["alpha", "beta"]);
    expect(closed.isErr()).toBe(true);
    if (closed.isErr()) {
      expect(closed.error).toBeInstanceOf(ChatCloseError);
      if (ChatCloseError.is(closed.error)) {
        expect(closed.error.failures).toHaveLength(1);
        expect(closed.error.failures[0]?.chatId).toBe("alpha");
      }
    }
  });
});
