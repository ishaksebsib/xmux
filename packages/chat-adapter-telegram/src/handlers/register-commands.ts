import { Result } from "better-result";
import type { ChatCommandRegistry } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { createTelegramCommandRegistration } from "../commands";
import { TelegramCommandRegistrationError } from "../errors";
import type { TelegramLogScope } from "../logger";

export async function registerCommands<TCommands extends ChatCommandRegistry>(args: {
  readonly bot: TelegramBotClient;
  readonly commands: TCommands;
  readonly logger?: TelegramLogScope;
  readonly signal?: AbortSignal;
}): Promise<Result<void, TelegramCommandRegistrationError>> {
  return Result.tryPromise({
    try: async () => {
      const commands = createTelegramCommandRegistration({
        commands: args.commands,
        logger: args.logger,
      });

      if (commands.length > 0) {
        await args.bot.setMyCommands({ commands, signal: args.signal });
      }
    },
    catch: (cause) => new TelegramCommandRegistrationError({ cause }),
  });
}
