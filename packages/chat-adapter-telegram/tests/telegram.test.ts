import { describe, expect, test, vi } from "vitest";
import {
  TelegramConfigurationError,
  TelegramStartError,
  TelegramWebhookModeUnsupportedError,
  createTelegramAdapter,
  type TelegramAdapterData,
  type TelegramAdapterOptions,
} from "../src";
import { openTelegramRuntime } from "../src/runtime";
import type { ChatAdapterDefinition, ChatAdapterStartContext } from "@xmux/chat-core";

function createStartContext<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly signal?: AbortSignal;
  readonly errors?: unknown[];
}): ChatAdapterStartContext<Record<never, never>, TChatId, TelegramAdapterData> {
  return {
    commands: {},
    emit: (event) => {
      if (event.type === "error") {
        args.errors?.push(event.error);
      }
    },
    diagnostic: () => undefined,
    signal: args.signal,
  };
}

type CreateBotClient = NonNullable<Parameters<typeof openTelegramRuntime<"telegram">>[0]["createBot"]>;

type FakeTelegramBot = ReturnType<CreateBotClient> & {
  readonly initMock: ReturnType<typeof vi.fn>;
  readonly startMock: ReturnType<typeof vi.fn>;
  readonly stopMock: ReturnType<typeof vi.fn>;
  readonly catchMock: ReturnType<typeof vi.fn>;
  readonly rejectPolling: (cause: unknown) => void;
};

function createFakeTelegramBot(
  args: {
    readonly initError?: unknown;
    readonly startError?: unknown;
  } = {},
): FakeTelegramBot {
  let running = false;
  let rejectPolling: (cause: unknown) => void = () => undefined;
  let resolvePolling: () => void = () => undefined;

  const polling = new Promise<void>((resolve, reject) => {
    resolvePolling = resolve;
    rejectPolling = reject;
  });
  const initMock = vi.fn(async () => {
    if (args.initError !== undefined) {
      throw args.initError;
    }
  });
  const startMock = vi.fn(() => {
    if (args.startError !== undefined) {
      throw args.startError;
    }

    running = true;
    return polling;
  });
  const stopMock = vi.fn(async () => {
    running = false;
    resolvePolling();
  });
  const catchMock = vi.fn();

  return {
    catch: catchMock,
    init: initMock,
    isRunning: () => running,
    start: startMock,
    stop: stopMock,
    initMock,
    startMock,
    stopMock,
    catchMock,
    rejectPolling,
  } as FakeTelegramBot;
}

function createRuntimeWithFakeBot(args: {
  readonly bot: FakeTelegramBot;
  readonly mode?: Parameters<typeof openTelegramRuntime<"telegram">>[0]["mode"];
}) {
  return openTelegramRuntime({
    chatId: "telegram",
    options: { token: "123:test" },
    mode: args.mode ?? { type: "polling" },
    createBot: () => args.bot,
  });
}

describe("createTelegramAdapter", () => {
  test("preserves the default and custom adapter ids", () => {
    const defaultAdapter = createTelegramAdapter({ token: "123:test" });
    const customAdapter = createTelegramAdapter({ id: "support", token: "123:test" });

    expect(defaultAdapter.id).toBe("telegram");
    expect(customAdapter.id).toBe("support");
  });

  test("returns typed adapter definitions", () => {
    const adapter = createTelegramAdapter({ id: "telegram", token: "123:test" });

    expect(adapter).toSatisfy(
      (_adapter: ChatAdapterDefinition<"telegram", TelegramAdapterOptions, TelegramAdapterData>) =>
        true,
    );
  });

  test("open rejects an empty token", async () => {
    const adapter = createTelegramAdapter({ token: " " });

    const opened = await adapter.open({});

    expect(opened.isErr()).toBe(true);
    if (opened.isErr()) {
      expect(opened.error).toBeInstanceOf(TelegramConfigurationError);
    }
  });

  test("open returns a runtime with capabilities", async () => {
    const adapter = createTelegramAdapter({ token: "123:test" });

    const opened = await adapter.open({});

    expect(opened.isOk()).toBe(true);
    if (opened.isOk()) {
      expect(opened.value.id).toBe("telegram");
      expect(opened.value.capabilities?.messages.send).toBe(true);
      expect(opened.value.capabilities?.commands?.registration).toBe("dynamic");
    }
  });

  test("webhook mode is explicit but unsupported in this phase", async () => {
    const adapter = createTelegramAdapter({
      token: "123:test",
      mode: { type: "webhook", secretToken: "secret" },
    });
    const opened = await adapter.open({});
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram" }));

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error).toBeInstanceOf(TelegramWebhookModeUnsupportedError);
    }
  });

  test("polling start initializes grammY and starts polling", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({
      bot,
      mode: {
        type: "polling",
        dropPendingUpdates: true,
        allowedUpdates: ["message"],
      },
    });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram" }));

    expect(started.isOk()).toBe(true);
    expect(bot.catchMock).toHaveBeenCalledTimes(1);
    expect(bot.initMock).toHaveBeenCalledTimes(1);
    expect(bot.startMock).toHaveBeenCalledWith({
      drop_pending_updates: true,
      allowed_updates: ["message"],
    });
  });

  test("polling start returns typed init failures", async () => {
    const bot = createFakeTelegramBot({ initError: new Error("init failed") });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram" }));

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error).toBeInstanceOf(TelegramStartError);
      if (TelegramStartError.is(started.error)) {
        expect(started.error.message).toContain("init failed");
      }
    }
  });

  test("abort signal stops polling", async () => {
    const bot = createFakeTelegramBot();
    const abortController = new AbortController();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(
      createStartContext({ chatId: "telegram", signal: abortController.signal }),
    );
    expect(started.isOk()).toBe(true);

    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bot.stopMock).toHaveBeenCalledTimes(1);
  });

  test("polling failures are emitted as runtime errors", async () => {
    const bot = createFakeTelegramBot();
    const errors: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", errors }));
    expect(started.isOk()).toBe(true);

    const cause = new Error("polling failed");
    bot.rejectPolling(cause);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toEqual([cause]);
  });

  test("close is safe to call more than once", async () => {
    const adapter = createTelegramAdapter({ token: "123:test" });
    const opened = await adapter.open({});
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    await expect(opened.value.close()).resolves.toBeUndefined();
    await expect(opened.value.close()).resolves.toBeUndefined();
  });
});
