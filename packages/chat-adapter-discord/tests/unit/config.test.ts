import { describe, expect, test } from "vitest";
import {
  createSafeDiscordAllowedMentions,
  normalizeDiscordMode,
  parseDiscordAdapterConfig,
  parseDiscordApplicationId,
  parseDiscordBotToken,
} from "../../src/config";
import { DiscordConfigurationError } from "../../src/errors";

describe("Discord adapter config", () => {
  test("empty token fails", () => {
    const result = parseDiscordBotToken("  ");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(DiscordConfigurationError);
      expect(result.error.field).toBe("token");
    }
  });

  test("empty application id fails", () => {
    const result = parseDiscordApplicationId("");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(DiscordConfigurationError);
      expect(result.error.field).toBe("applicationId");
    }
  });

  test("default mode is gateway", () => {
    expect(normalizeDiscordMode()).toEqual({ type: "gateway" });
  });

  test("safe allowed mentions default is generated", () => {
    const mentions = createSafeDiscordAllowedMentions();

    expect(mentions).toEqual({ parse: [], replied_user: false });
  });

  test("normalizes runtime defaults", () => {
    const result = parseDiscordAdapterConfig({ token: "token", applicationId: "app" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.mode).toEqual({ type: "gateway" });
      expect(result.value.commandRegistration).toEqual({ scope: { type: "none" } });
      expect(result.value.defaultAllowedMentions).toEqual({ parse: [], replied_user: false });
      expect(result.value.stream).toEqual({ placeholderText: "…", editIntervalMs: 1_000 });
    }
  });
});
