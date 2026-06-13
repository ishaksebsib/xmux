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

    expect(payload).toEqual([
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

    expect(payload[0]?.options?.[0]).toMatchObject({
      choices: [
        { name: "dev", value: "dev" },
        { name: "prod", value: "prod" },
      ],
    });
  });

  test("invalid command names are warned and skipped", () => {
    const logger = createMockLogger();
    const scope = createDiscordLogScope({ logger, chatId: "discord" });
    const commands = defineChatCommands({
      BadName: defineChatCommand({ description: "Bad" }),
      good: defineChatCommand({ description: "Good" }),
    });

    const payload = createDiscordCommandRegistration({ commands, logger: scope });

    expect(payload.map((command) => command.name)).toEqual(["good"]);
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

    expect(payload).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "xmux.discord.commands.register.warning",
      expect.objectContaining({ code: "COMMAND_OPTION_CHOICES_TOO_MANY" }),
    );
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
