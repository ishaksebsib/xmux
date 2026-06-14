import { ApplicationCommandOptionType, ApplicationCommandType } from "discord-api-types/v10";
import {
  booleanOption,
  defineChatCommand,
  defineChatCommands,
  numberOption,
  stringOption,
} from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createDiscordCommandRegistration, parseDiscordCommand } from "../../src/commands";
import { createDiscordLogScope } from "../../src/logger";
import { createMockLogger } from "../fixtures/collect";

describe("Discord command conversions", () => {
  test("command registration payload maps basic options", () => {
    const commands = defineChatCommands({
      echo: defineChatCommand({
        description: "Echo text",
        options: {
          text: stringOption({ description: "Text", required: true }),
          count: numberOption({ description: "Count" }),
          loud: booleanOption({ description: "Loud" }),
        },
      }),
    });

    const payload = createDiscordCommandRegistration({ commands });

    expect(payload.isOk()).toBe(true);
    if (payload.isOk()) {
      expect(payload.value.commands).toEqual([
        {
          type: ApplicationCommandType.ChatInput,
          name: "echo",
          description: "Echo text",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "text",
              description: "Text",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Number,
              name: "count",
              description: "Count",
              required: undefined,
            },
            {
              type: ApplicationCommandOptionType.Boolean,
              name: "loud",
              description: "Loud",
              required: undefined,
            },
          ],
        },
      ]);
    }
  });

  test("camelCase option names are normalized for Discord registration", () => {
    const commands = defineChatCommands({
      new: defineChatCommand({
        description: "New session",
        options: {
          harnessId: stringOption({ description: "Harness id", required: true }),
          shortId: stringOption({ description: "Short id" }),
        },
      }),
    });

    const payload = createDiscordCommandRegistration({ commands });

    expect(payload.isOk()).toBe(true);
    if (payload.isOk()) {
      expect(payload.value.skipped).toEqual([]);
      expect(payload.value.commands[0]?.options?.map((option) => option.name)).toEqual([
        "harness_id",
        "short_id",
      ]);
    }
  });

  test("required options are ordered before optional options", () => {
    const commands = defineChatCommands({
      echo: defineChatCommand({
        description: "Echo text",
        options: {
          optional: stringOption(),
          required: stringOption({ required: true }),
        },
      }),
    });

    const payload = createDiscordCommandRegistration({ commands });

    expect(payload.isOk()).toBe(true);
    if (payload.isOk()) {
      expect(payload.value.commands[0]?.options?.map((option) => option.name)).toEqual([
        "required",
        "optional",
      ]);
    }
  });

  test("choices map correctly", () => {
    const commands = defineChatCommands({
      deploy: defineChatCommand({
        description: "Deploy",
        options: {
          environment: stringOption({ choices: ["dev", "prod"] as const }),
        },
      }),
    });

    const payload = createDiscordCommandRegistration({ commands });

    expect(payload.isOk()).toBe(true);
    if (payload.isOk()) {
      expect(payload.value.commands[0]?.options?.[0]).toMatchObject({
        choices: [
          { name: "dev", value: "dev" },
          { name: "prod", value: "prod" },
        ],
      });
    }
  });

  test("descriptions are trimmed and whitespace-only descriptions are skipped", () => {
    const logger = createMockLogger();
    const scope = createDiscordLogScope({ logger, chatId: "discord" });
    const commands = defineChatCommands({
      trim: defineChatCommand({ description: "  Trimmed  " }),
      empty: defineChatCommand({ description: "   " }),
    });

    const payload = createDiscordCommandRegistration({ commands, logger: scope });

    expect(payload.isOk()).toBe(true);
    if (payload.isOk()) {
      expect(payload.value.commands).toMatchObject([{ name: "trim", description: "Trimmed" }]);
      expect(payload.value.skipped).toEqual([
        expect.objectContaining({ commandName: "empty", code: "COMMAND_DESCRIPTION_INVALID" }),
      ]);
    }
  });

  test("invalid command names are warned and skipped", () => {
    const logger = createMockLogger();
    const scope = createDiscordLogScope({ logger, chatId: "discord" });
    const commands = defineChatCommands({
      BadName: defineChatCommand({ description: "Bad" }),
      good: defineChatCommand({ description: "Good" }),
    });

    const payload = createDiscordCommandRegistration({ commands, logger: scope });

    expect(payload.isOk()).toBe(true);
    if (payload.isOk()) {
      expect(payload.value.commands.map((command) => command.name)).toEqual(["good"]);
    }
    expect(logger.warn).toHaveBeenCalledWith(
      "xmux.discord.commands.register.warning",
      expect.objectContaining({ code: "COMMAND_NAME_INVALID", commandName: "BadName" }),
    );
  });

  test("too many choices are warned and skip the command", () => {
    const logger = createMockLogger();
    const scope = createDiscordLogScope({ logger, chatId: "discord" });
    const choices = Array.from({ length: 26 }, (_, index) => `choice-${index}`);
    const commands = defineChatCommands({
      choose: defineChatCommand({
        description: "Choose",
        options: { value: stringOption({ choices }) },
      }),
    });

    const payload = createDiscordCommandRegistration({ commands, logger: scope });

    expect(payload.isOk()).toBe(true);
    if (payload.isOk()) {
      expect(payload.value.commands).toEqual([]);
    }
    expect(logger.warn).toHaveBeenCalledWith(
      "xmux.discord.commands.register.warning",
      expect.objectContaining({ code: "COMMAND_OPTION_CHOICES_TOO_MANY" }),
    );
  });

  test("invalid choice display names and non-finite number choices are skipped", () => {
    const commands = defineChatCommands({
      bad_name: defineChatCommand({
        description: "Bad choice name",
        options: { value: stringOption({ choices: ["   "] as const }) },
      }),
      bad_number: defineChatCommand({
        description: "Bad number choice",
        options: { value: numberOption({ choices: [Number.NaN] }) },
      }),
    });

    const payload = createDiscordCommandRegistration({ commands });

    expect(payload.isOk()).toBe(true);
    if (payload.isOk()) {
      expect(payload.value.commands).toEqual([]);
      expect(payload.value.skipped.map((skip) => skip.code)).toEqual([
        "COMMAND_OPTION_CHOICE_NAME_INVALID",
        "COMMAND_OPTION_CHOICE_NUMBER_INVALID",
      ]);
    }
  });

  test("slash command options parse normalized Discord option names into typed command values", () => {
    const commands = defineChatCommands({
      new: defineChatCommand({
        description: "New session",
        options: {
          harnessId: stringOption({ required: true }),
          shortId: stringOption(),
        },
      }),
    });

    const parsed = parseDiscordCommand({
      commands,
      interaction: interactionOptions("new", { harness_id: "opencode", short_id: "abc123" }),
    });

    expect(parsed).toEqual({
      status: "command",
      command: { name: "new", options: { harnessId: "opencode", shortId: "abc123" } },
    });
  });

  test("slash command options parse into typed command values", () => {
    const commands = defineChatCommands({
      echo: defineChatCommand({
        description: "Echo",
        options: {
          text: stringOption({ required: true }),
          loud: booleanOption(),
        },
      }),
    });

    const parsed = parseDiscordCommand({
      commands,
      interaction: interactionOptions("echo", { text: "hello", loud: true }),
    });

    expect(parsed).toEqual({
      status: "command",
      command: { name: "echo", options: { text: "hello", loud: true } },
    });
  });

  test("unknown command parses as unknown", () => {
    const parsed = parseDiscordCommand({
      commands: defineChatCommands({}),
      interaction: interactionOptions("missing", {}),
    });

    expect(parsed).toEqual({ status: "unknown", commandName: "missing" });
  });

  test("missing required option parses as invalid", () => {
    const commands = defineChatCommands({
      echo: defineChatCommand({
        description: "Echo",
        options: { text: stringOption({ required: true }) },
      }),
    });

    const parsed = parseDiscordCommand({ commands, interaction: interactionOptions("echo", {}) });

    expect(parsed).toEqual({
      status: "invalid",
      commandName: "echo",
      optionName: "text",
      reason: "required option is missing",
    });
  });
});

function interactionOptions(commandName: string, values: Readonly<Record<string, unknown>>) {
  return {
    commandName,
    options: {
      get(name: string) {
        return name in values ? { value: values[name] } : null;
      },
    },
  };
}
