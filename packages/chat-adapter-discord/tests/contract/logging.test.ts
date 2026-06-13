import { describe, expect, test } from "vitest";
import { createChat } from "@xmux/chat-core";
import { createDiscordAdapter } from "../../src";
import { type CreateDiscordBotClient } from "../../src/client";
import { discordLogEvents } from "../../src/logger";
import { createMockLogger } from "../fixtures/collect";
import { createFakeDiscordClient } from "../fixtures/fake-discord-client";

describe("Discord logging contract", () => {
  test("logs open, start, and close begin/success events", async () => {
    const fake = createFakeDiscordClient();
    const logger = createMockLogger();
    const chat = createChat({
      adapters: { discord: createTestAdapter(fake) },
      commands: {},
      logger,
    });

    expect((await chat.start()).isOk()).toBe(true);
    expect((await chat.close()).isOk()).toBe(true);

    expect(logger.debug).toHaveBeenCalledWith(
      discordLogEvents.openBegin,
      expect.objectContaining({ operation: "open", mode: "gateway" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      discordLogEvents.openSuccess,
      expect.objectContaining({ operation: "open", mode: "gateway", result: "ok" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      discordLogEvents.startBegin,
      expect.objectContaining({ operation: "start", mode: "gateway" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      discordLogEvents.startSuccess,
      expect.objectContaining({ operation: "start", mode: "gateway", result: "ok" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      discordLogEvents.closeBegin,
      expect.objectContaining({ operation: "close" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      discordLogEvents.closeSuccess,
      expect.objectContaining({ operation: "close", result: "ok" }),
    );
  });

  test("logs start failure when login fails", async () => {
    const fake = createFakeDiscordClient({ loginError: new Error("login failed") });
    const logger = createMockLogger();
    const chat = createChat({
      adapters: { discord: createTestAdapter(fake) },
      commands: {},
      logger,
    });

    const started = await chat.start();

    expect(started.isErr()).toBe(true);
    expect(logger.debug).toHaveBeenCalledWith(
      discordLogEvents.startFailure,
      expect.objectContaining({
        operation: "start",
        mode: "gateway",
        result: "error",
        error: expect.objectContaining({ message: expect.stringContaining("login failed") }),
      }),
    );
  });
});

function createTestAdapter(fake: ReturnType<typeof createFakeDiscordClient>) {
  return createDiscordAdapter<"discord">({
    token: "token",
    applicationId: "application",
    createClient: (() => fake) satisfies CreateDiscordBotClient,
  });
}
