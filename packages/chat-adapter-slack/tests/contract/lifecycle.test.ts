import { createChat, type ChatAdapterStartContext } from "@xmux/chat-core";
import { describe, expect, test, vi } from "vitest";
import { createSlackAdapter } from "../../src";
import type { CreateSlackBotClient } from "../../src/client";
import {
  SlackHttpModeUnsupportedError,
  SlackStartError,
  type SlackAdapterError,
} from "../../src/errors";
import { openSlackRuntime } from "../../src/runtime";
import type { CreateSlackAdapterOptions, SlackAdapterData } from "../../src/types";
import { waitForCondition } from "../fixtures/collect";
import { createFakeSlackClient } from "../fixtures/fake-slack-client";

describe("Slack lifecycle contract", () => {
  test("opens, registers Socket Mode handlers before start, starts, and closes", async () => {
    const fake = createFakeSlackClient();
    const chat = createChat({
      adapters: { slack: createTestAdapter(fake) },
      commands: {},
    });

    const started = await chat.start();

    expect(started.isOk()).toBe(true);
    expect(fake.startCalls).toHaveLength(1);
    expect(fake.handlerCountsAtStart[0]).toEqual({
      message: 1,
      appMention: 0,
      command: 1,
      action: 1,
      reactionAdded: 1,
      reactionRemoved: 1,
      error: 1,
    });
    expect(fake.callOrder.indexOf("onMessage")).toBeLessThan(fake.callOrder.indexOf("start"));
    expect(fake.callOrder.indexOf("onCommand")).toBeLessThan(fake.callOrder.indexOf("start"));
    expect(fake.callOrder.indexOf("onAction")).toBeLessThan(fake.callOrder.indexOf("start"));

    const closed = await chat.close();
    expect(closed.isOk()).toBe(true);
    expect(fake.stopCalls).toHaveLength(1);
  });

  test("runtime start and close are idempotent", async () => {
    const fake = createFakeSlackClient();
    const opened = openSlackRuntime({
      chatId: "slack",
      options: socketOptions(),
      createClient: () => fake,
    });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) return;

    const context = createStartContext();
    expect((await opened.value.start(context)).isOk()).toBe(true);
    expect((await opened.value.start(context)).isOk()).toBe(true);
    expect(fake.startCalls).toHaveLength(1);

    await opened.value.close();
    await opened.value.close();
    expect(fake.stopCalls).toHaveLength(1);
  });

  test("abort signal closes the runtime", async () => {
    const fake = createFakeSlackClient();
    const abortController = new AbortController();
    const opened = openSlackRuntime({
      chatId: "slack",
      options: socketOptions(),
      createClient: () => fake,
    });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) return;

    expect((await opened.value.start(createStartContext(abortController.signal))).isOk()).toBe(
      true,
    );
    abortController.abort();

    await waitForCondition(() => fake.stopCalls.length === 1);
  });

  test("start failure maps to SlackStartError", async () => {
    const startError = new Error("socket failed");
    const fake = createFakeSlackClient({ startError });
    const chat = createChat({
      adapters: { slack: createTestAdapter(fake) },
      commands: {},
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error.cause).toBeInstanceOf(SlackStartError);
      expect((started.error.cause as SlackStartError).cause).toBe(startError);
    }
    expect(fake.stopCalls).toHaveLength(1);
  });

  test("http mode fails with explicit typed adapter error", async () => {
    const fake = createFakeSlackClient();
    const chat = createChat({
      adapters: {
        slack: createTestAdapter(fake, {
          mode: { type: "http", signingSecret: "secret" },
        }),
      },
      commands: {},
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error.cause).toBeInstanceOf(SlackHttpModeUnsupportedError);
    }
    expect(fake.startCalls).toHaveLength(0);
  });

  test("socket errors are surfaced through chat-core error events", async () => {
    const fake = createFakeSlackClient();
    const socketError = new Error("socket failed");
    const errors: unknown[] = [];
    const chat = createChat({
      adapters: { slack: createTestAdapter(fake) },
      commands: {},
    });
    chat.on("error", (event) => {
      errors.push(event.error);
    });

    expect((await chat.start()).isOk()).toBe(true);
    await fake.emitError(socketError);

    await waitForCondition(() => errors.includes(socketError));
    expect((await chat.close()).isOk()).toBe(true);
  });
});

function socketOptions(): CreateSlackAdapterOptions<"slack"> {
  return {
    botToken: "xoxb-token",
    mode: { type: "socket", appToken: "xapp-token" },
  };
}

function createTestAdapter(
  fake: ReturnType<typeof createFakeSlackClient>,
  options: Partial<CreateSlackAdapterOptions<"slack">> = {},
) {
  return createSlackAdapter<"slack">({
    ...socketOptions(),
    ...options,
    createClient: (() => fake) satisfies CreateSlackBotClient,
  });
}

function createStartContext(
  signal?: AbortSignal,
): ChatAdapterStartContext<Record<never, never>, "slack", SlackAdapterData, SlackAdapterError> {
  return {
    commands: {},
    emit: vi.fn(),
    signal,
  };
}
