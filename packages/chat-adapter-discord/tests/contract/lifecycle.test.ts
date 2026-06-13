import { describe, expect, test, vi } from "vitest";
import { createChat, type ChatAdapterStartContext } from "@xmux/chat-core";
import { createDiscordAdapter } from "../../src";
import { type CreateDiscordBotClient } from "../../src/client";
import type { CreateDiscordAdapterOptions, DiscordAdapterData } from "../../src/types";
import {
  DiscordStartError,
  DiscordWebhookModeUnsupportedError,
  type DiscordAdapterError,
} from "../../src/errors";
import { openDiscordRuntime } from "../../src/runtime";
import { waitForCondition } from "../fixtures/collect";
import { createFakeDiscordClient } from "../fixtures/fake-discord-client";

describe("Discord lifecycle contract", () => {
  test("opens, registers gateway handlers before login, starts, and closes", async () => {
    const fake = createFakeDiscordClient();
    const chat = createChat({
      adapters: {
        discord: createTestAdapter(fake, {
          mode: { type: "gateway", observeMessages: true, observeReactions: true },
        }),
      },
      commands: {},
    });

    const started = await chat.start();

    expect(started.isOk()).toBe(true);
    expect(fake.loginCalls).toHaveLength(1);
    expect(fake.handlerCountsAtLogin[0]).toEqual({
      ready: 1,
      error: 1,
      messageCreate: 1,
      interactionCreate: 1,
      reactionAdd: 1,
      reactionRemove: 1,
    });
    expect(fake.callOrder.indexOf("onReady")).toBeLessThan(fake.callOrder.indexOf("login"));
    expect(fake.callOrder.indexOf("onInteractionCreate")).toBeLessThan(
      fake.callOrder.indexOf("login"),
    );

    const closed = await chat.close();
    expect(closed.isOk()).toBe(true);
    expect(fake.destroyCount).toBe(1);
  });

  test("runtime start and close are idempotent", async () => {
    const fake = createFakeDiscordClient();
    const opened = openDiscordRuntime({
      chatId: "discord",
      options: { token: "token", applicationId: "application" },
      mode: { type: "gateway" },
      createClient: () => fake,
    });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) return;

    const context = createStartContext();
    expect((await opened.value.start(context)).isOk()).toBe(true);
    expect((await opened.value.start(context)).isOk()).toBe(true);
    expect(fake.loginCalls).toHaveLength(1);

    await opened.value.close();
    await opened.value.close();
    expect(fake.destroyCount).toBe(1);
  });

  test("abort signal closes the runtime", async () => {
    const fake = createFakeDiscordClient();
    const abortController = new AbortController();
    const opened = openDiscordRuntime({
      chatId: "discord",
      options: { token: "token", applicationId: "application" },
      mode: { type: "gateway" },
      createClient: () => fake,
    });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) return;

    expect((await opened.value.start(createStartContext(abortController.signal))).isOk()).toBe(
      true,
    );
    abortController.abort();

    await waitForCondition(() => fake.destroyCount === 1);
  });

  test("login failure maps to DiscordStartError", async () => {
    const loginError = new Error("login failed");
    const fake = createFakeDiscordClient({ loginError });
    const chat = createChat({
      adapters: { discord: createTestAdapter(fake) },
      commands: {},
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error.cause).toBeInstanceOf(DiscordStartError);
      expect((started.error.cause as DiscordStartError).cause).toBe(loginError);
    }
    expect(fake.destroyCount).toBe(1);
  });

  test("webhook mode fails with explicit typed adapter error", async () => {
    const fake = createFakeDiscordClient();
    const chat = createChat({
      adapters: {
        discord: createTestAdapter(fake, {
          mode: { type: "webhook", publicKey: "public-key" },
        }),
      },
      commands: {},
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error.cause).toBeInstanceOf(DiscordWebhookModeUnsupportedError);
    }
    expect(fake.loginCalls).toHaveLength(0);
  });

  test("gateway errors are surfaced through chat-core error events", async () => {
    const fake = createFakeDiscordClient();
    const gatewayError = new Error("gateway failed");
    const errors: unknown[] = [];
    const chat = createChat({
      adapters: { discord: createTestAdapter(fake) },
      commands: {},
    });
    chat.on("error", (event) => {
      errors.push(event.error);
    });

    expect((await chat.start()).isOk()).toBe(true);
    fake.emitError(gatewayError);

    await waitForCondition(() => errors.includes(gatewayError));
    expect((await chat.close()).isOk()).toBe(true);
  });
});

function createTestAdapter(
  fake: ReturnType<typeof createFakeDiscordClient>,
  options: Partial<CreateDiscordAdapterOptions<"discord">> = {},
) {
  return createDiscordAdapter<"discord">({
    token: "token",
    applicationId: "application",
    ...options,
    createClient: (() => fake) satisfies CreateDiscordBotClient,
  } as CreateDiscordAdapterOptions<"discord"> & {
    readonly createClient: CreateDiscordBotClient;
  });
}

function createStartContext(
  signal?: AbortSignal,
): ChatAdapterStartContext<
  Record<never, never>,
  "discord",
  DiscordAdapterData,
  DiscordAdapterError
> {
  return {
    commands: {},
    emit: vi.fn(),
    signal,
  };
}
