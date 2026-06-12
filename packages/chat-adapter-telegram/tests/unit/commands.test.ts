import { describe, expect, test } from "vitest";
import {
  booleanOption,
  defineChatCommand,
  defineChatCommands,
  numberOption,
  stringOption,
} from "@xmux/chat-core";
import type { TelegramTextMessageContext } from "../../src/client";
import { parseTelegramCommand } from "../../src/commands/parse";
import { telegramTextMessage } from "../fixtures/telegram-builders";

function commandContext(text: string): TelegramTextMessageContext {
  return {
    message: telegramTextMessage({
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(/\s/, 1)[0]?.length ?? 0 }],
    }),
  } as unknown as TelegramTextMessageContext;
}

describe("Telegram command parsing", () => {
  test("parses quoted named string, number, and boolean options", () => {
    const commands = defineChatCommands({
      deploy: defineChatCommand({
        description: "Deploy",
        options: {
          env: stringOption({ required: true, choices: ["prod", "staging"] as const }),
          count: numberOption({ required: true }),
          dryRun: booleanOption(),
        },
      }),
    });

    const parsed = parseTelegramCommand({
      commands,
      context: commandContext('/deploy --env "prod" --count 2 --dryRun true'),
      botUsername: "xmux_bot",
    });

    expect(parsed).toMatchObject({
      status: "command",
      command: { name: "deploy", options: { env: "prod", count: 2, dryRun: true } },
    });
  });

  test("supports Telegram positional text for a single string option", () => {
    const commands = defineChatCommands({
      echo: defineChatCommand({
        description: "Echo",
        options: { text: stringOption({ required: true }) },
      }),
    });

    const parsed = parseTelegramCommand({
      commands,
      context: commandContext("/echo hello from telegram"),
      botUsername: "xmux_bot",
    });

    expect(parsed).toMatchObject({
      status: "command",
      command: { name: "echo", options: { text: "hello from telegram" } },
    });
  });

  test("detects commands addressed to another bot", () => {
    const commands = defineChatCommands({
      echo: defineChatCommand({ description: "Echo" }),
    });

    const parsed = parseTelegramCommand({
      commands,
      context: commandContext("/echo@other_bot hello"),
      botUsername: "xmux_bot",
    });

    expect(parsed).toEqual({ status: "command_for_other_bot" });
  });

  test("reports unknown and invalid command options", () => {
    const commands = defineChatCommands({
      scale: defineChatCommand({
        description: "Scale",
        options: { replicas: numberOption({ required: true, choices: [1, 2] as const }) },
      }),
    });

    expect(
      parseTelegramCommand({
        commands,
        context: commandContext("/missing"),
        botUsername: "xmux_bot",
      }),
    ).toEqual({ status: "unknown", commandName: "missing" });

    expect(
      parseTelegramCommand({
        commands,
        context: commandContext("/scale --replicas nope"),
        botUsername: "xmux_bot",
      }),
    ).toMatchObject({
      status: "invalid",
      commandName: "scale",
      optionName: "replicas",
      reason: "number option must be numeric",
    });

    expect(
      parseTelegramCommand({
        commands,
        context: commandContext("/scale --replicas 3"),
        botUsername: "xmux_bot",
      }),
    ).toMatchObject({
      status: "invalid",
      commandName: "scale",
      optionName: "replicas",
      reason: "value must be one of: 1, 2",
    });
  });
});
