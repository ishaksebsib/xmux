import type { ChatCommandRegistry } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";

type TelegramCommandInput = Parameters<TelegramBotClient["setMyCommands"]>[0]["commands"][number];

const telegramCommandNamePattern = /^[a-z0-9_]{1,32}$/;

export function createTelegramCommandRegistration<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
}): readonly TelegramCommandInput[] {
  const telegramCommands: TelegramCommandInput[] = [];
  let sawOptions = false;
  let sawChoices = false;

  for (const [name, command] of Object.entries(args.commands)) {
    if (!telegramCommandNamePattern.test(name)) {
      continue;
    }

    const options = command.options ?? {};
    const optionValues = Object.values(options);
    sawOptions ||= optionValues.length > 0;
    sawChoices ||= optionValues.some((option) => option.choices !== undefined);

    telegramCommands.push({ command: name, description: command.description });
  }

  void sawOptions;
  void sawChoices;

  return telegramCommands;
}
