import type { ChatCommandRegistry } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { telegramLogEvents, type TelegramLogScope } from "../logger";

type TelegramCommandInput = Parameters<TelegramBotClient["setMyCommands"]>[0]["commands"][number];

const telegramCommandNamePattern = /^[a-z0-9_]{1,32}$/;

export function createTelegramCommandRegistration<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly logger?: TelegramLogScope;
}): readonly TelegramCommandInput[] {
  const telegramCommands: TelegramCommandInput[] = [];
  let sawOptions = false;
  let sawChoices = false;

  for (const [name, command] of Object.entries(args.commands)) {
    if (!telegramCommandNamePattern.test(name)) {
      args.logger?.warn(telegramLogEvents.commandsRegisterWarning, {
        operation: "registerCommands",
        code: "COMMAND_NAME_INVALID",
        commandName: name,
        reason: "command_name_invalid",
      });
      continue;
    }

    const options = command.options ?? {};
    const optionValues = Object.values(options);
    sawOptions ||= optionValues.length > 0;
    sawChoices ||= optionValues.some((option) => option.choices !== undefined);

    telegramCommands.push({ command: name, description: command.description });
  }

  if (sawOptions) {
    args.logger?.warn(telegramLogEvents.commandsRegisterWarning, {
      operation: "registerCommands",
      code: "COMMAND_OPTIONS_NOT_SUPPORTED",
      reason: "telegram_registered_commands_do_not_support_options",
    });
  }

  if (sawChoices) {
    args.logger?.warn(telegramLogEvents.commandsRegisterWarning, {
      operation: "registerCommands",
      code: "COMMAND_CHOICES_NOT_SUPPORTED",
      reason: "telegram_registered_commands_do_not_support_choices",
    });
  }

  return telegramCommands;
}
