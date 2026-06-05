import { Result } from "better-result";
import type { ChatAdapterDiagnosticInput, ChatCommandRegistry } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { createTelegramCommandRegistration } from "../commands";
import { TelegramCommandRegistrationError } from "../errors";

export async function registerCommands<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly bot: TelegramBotClient;
  readonly commands: TCommands;
  readonly diagnostic: (diagnostic: ChatAdapterDiagnosticInput<TChatId>) => void;
  readonly signal?: AbortSignal;
}): Promise<Result<void, TelegramCommandRegistrationError>> {
  return Result.tryPromise({
    try: async () => {
      const commands = createTelegramCommandRegistration({
        commands: args.commands,
        diagnostic: args.diagnostic,
      });

      if (commands.length > 0) {
        await args.bot.setMyCommands({ commands, signal: args.signal });
      }
    },
    catch: (cause) => new TelegramCommandRegistrationError({ cause }),
  });
}
