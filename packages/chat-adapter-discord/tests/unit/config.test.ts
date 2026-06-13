import { AllowedMentionsTypes } from "discord-api-types/v10";
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

  test("token is trimmed", () => {
    const result = parseDiscordBotToken("  token  ");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("token");
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

  test("application id is trimmed", () => {
    const result = parseDiscordApplicationId("  application  ");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("application");
    }
  });

  test("default mode is gateway", () => {
    expect(normalizeDiscordMode()).toEqual({ type: "gateway" });
  });

  test("safe allowed mentions default is generated", () => {
    const mentions = createSafeDiscordAllowedMentions();

    expect(mentions).toEqual({ parse: [], replied_user: false });
  });

  test("empty guild id fails", () => {
    const result = parseDiscordAdapterConfig({
      token: "token",
      applicationId: "app",
      commandRegistration: { scope: { type: "guild", guildId: "  " } },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("commandRegistration.scope.guildId");
    }
  });

  test("guild id is trimmed and registration defaults to upsert", () => {
    const result = parseDiscordAdapterConfig({
      token: "token",
      applicationId: "app",
      commandRegistration: { scope: { type: "guild", guildId: "  guild  " } },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk() && result.value.commandRegistration.scope.type === "guild") {
      const registration = result.value.commandRegistration;
      expect("guildId" in registration.scope ? registration.scope.guildId : undefined).toBe(
        "guild",
      );
      expect("strategy" in registration ? registration.strategy : undefined).toBe("upsert");
    }
  });

  test("invalid stream interval fails", () => {
    const result = parseDiscordAdapterConfig({
      token: "token",
      applicationId: "app",
      stream: { editIntervalMs: 0 },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("stream.editIntervalMs");
    }
  });

  test("custom allowed mentions are preserved", () => {
    const allowedMentions = { parse: [AllowedMentionsTypes.User], replied_user: true };
    const result = parseDiscordAdapterConfig({
      token: "token",
      applicationId: "app",
      defaultAllowedMentions: allowedMentions,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.defaultAllowedMentions).toBe(allowedMentions);
    }
  });

  test("webhook mode empty public key fails", () => {
    const result = parseDiscordAdapterConfig({
      token: "token",
      applicationId: "app",
      mode: { type: "webhook", publicKey: "  " },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("mode.publicKey");
    }
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
