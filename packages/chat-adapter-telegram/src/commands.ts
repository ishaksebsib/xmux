import type { ChatAdapterDiagnosticInput, ChatCommandRegistry } from "@xmux/chat-core";
import type { TelegramBotClient } from "./client";

type TelegramCommandInput = Parameters<TelegramBotClient["setMyCommands"]>[0][number];

const telegramCommandNamePattern = /^[a-z0-9_]{1,32}$/;

export function createTelegramCommandRegistration<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly commands: TCommands;
  readonly diagnostic: (diagnostic: ChatAdapterDiagnosticInput<TChatId>) => void;
}): readonly TelegramCommandInput[] {
  const telegramCommands: TelegramCommandInput[] = [];
  let sawOptions = false;
  let sawChoices = false;

  for (const [name, command] of Object.entries(args.commands)) {
    if (!telegramCommandNamePattern.test(name)) {
      args.diagnostic({
        level: "warn",
        code: "COMMAND_NAME_INVALID",
        message: `Telegram command "${name}" was not registered because command names must be 1-32 lowercase letters, digits, or underscores.`,
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
    args.diagnostic({
      level: "warn",
      code: "COMMAND_OPTIONS_NOT_SUPPORTED",
      message:
        "Telegram registered command names/descriptions only. Options will be parsed from message text.",
    });
  }

  if (sawChoices) {
    args.diagnostic({
      level: "warn",
      code: "COMMAND_CHOICES_NOT_SUPPORTED",
      message:
        "Telegram does not register command choices. Choices will be validated after parsing message text.",
    });
  }

  return telegramCommands;
}
