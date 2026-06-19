import { describe, expect, test } from "vitest";
import {
  defaultSlackCommandMode,
  defaultSlackMentionCommandOptions,
  normalizeSlackMode,
  parseSlackAdapterConfig,
  parseSlackAppToken,
  parseSlackBotToken,
} from "../../src/config";
import { SlackConfigurationError } from "../../src/errors";

describe("Slack adapter config", () => {
  test("empty bot token fails", () => {
    const result = parseSlackBotToken("  ");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(SlackConfigurationError);
      expect(result.error.field).toBe("botToken");
    }
  });

  test("bot token must use xoxb prefix", () => {
    const result = parseSlackBotToken("xoxp-user-token");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("botToken");
      expect(result.error.message).toContain("xoxb-");
    }
  });

  test("bot token is trimmed", () => {
    const result = parseSlackBotToken("  xoxb-token  ");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("xoxb-token");
    }
  });

  test("empty app token fails", () => {
    const result = parseSlackAppToken("  ");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("mode.appToken");
    }
  });

  test("app token must use xapp prefix", () => {
    const result = parseSlackAppToken("xoxb-bot-token");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("mode.appToken");
      expect(result.error.message).toContain("xapp-");
    }
  });

  test("default mode is socket", () => {
    expect(normalizeSlackMode()).toEqual({ type: "socket", appToken: "" });
  });

  test("default command mode is direct", () => {
    expect(defaultSlackCommandMode).toEqual({ type: "direct" });
  });

  test("mention commands are disabled by default", () => {
    expect(defaultSlackMentionCommandOptions).toEqual({ enabled: false });
  });

  test("missing app token fails when socket mode is defaulted", () => {
    const result = parseSlackAdapterConfig({ botToken: "xoxb-token" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("mode.appToken");
    }
  });

  test("http mode validates signing secret and remains configurable", () => {
    const result = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "http", signingSecret: "  secret  " },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.mode).toEqual({ type: "http", signingSecret: "secret" });
    }
  });

  test("empty http signing secret fails", () => {
    const result = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "http", signingSecret: "  " },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("mode.signingSecret");
    }
  });

  test("root command is trimmed and must start with slash", () => {
    const result = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "socket", appToken: "xapp-token" },
      commandMode: { type: "root", command: "  /xmux  " },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.commandMode).toEqual({ type: "root", command: "/xmux" });
    }

    const invalid = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "socket", appToken: "xapp-token" },
      commandMode: { type: "root", command: "xmux" },
    });

    expect(invalid.isErr()).toBe(true);
    if (invalid.isErr()) {
      expect(invalid.error.field).toBe("commandMode.command");
    }
  });

  test("mention commands can be enabled", () => {
    const result = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "socket", appToken: "xapp-token" },
      mentionCommands: { enabled: true },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.mentionCommands).toEqual({ enabled: true });
    }
  });

  test("invalid stream buffer size fails", () => {
    const result = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "socket", appToken: "xapp-token" },
      stream: { bufferSize: 0 },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.field).toBe("stream.bufferSize");
    }
  });

  test("stream buffer and segment sizes cannot exceed Slack markdown_text limit", () => {
    const buffer = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "socket", appToken: "xapp-token" },
      stream: { bufferSize: 12_001 },
    });
    const segment = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "socket", appToken: "xapp-token" },
      stream: { maxSegmentChars: 12_001 },
    });

    expect(buffer.isErr()).toBe(true);
    expect(segment.isErr()).toBe(true);
  });

  test("normalizes runtime defaults", () => {
    const result = parseSlackAdapterConfig({
      botToken: "xoxb-token",
      mode: { type: "socket", appToken: "xapp-token" },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.mode).toEqual({ type: "socket", appToken: "xapp-token" });
      expect(result.value.commandMode).toEqual({ type: "direct" });
      expect(result.value.mentionCommands).toEqual({ enabled: false });
      expect(result.value.stream).toEqual({
        bufferSize: 256,
        maxSegmentChars: 12_000,
        emptyText: "",
      });
    }
  });
});
