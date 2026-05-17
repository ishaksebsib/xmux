import { describe, expect, test } from "vitest";
import {
  TelegramConfigurationError,
  TelegramWebhookModeUnsupportedError,
  createTelegramAdapter,
  type TelegramAdapterData,
  type TelegramAdapterOptions,
} from "../src";
import type { ChatAdapterDefinition, ChatAdapterStartContext } from "@xmux/chat-core";

function createStartContext<TChatId extends string>(
  chatId: TChatId,
): ChatAdapterStartContext<Record<never, never>, TChatId, TelegramAdapterData> {
  return {
    commands: {},
    emit: () => undefined,
    diagnostic: () => undefined,
    signal: undefined,
  };
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

    const started = await opened.value.start(createStartContext("telegram"));

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error).toBeInstanceOf(TelegramWebhookModeUnsupportedError);
    }
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
