import { Result } from "better-result";
import type { ChatCommandRegistry } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import type { DiscordApplicationId } from "../config";
import { createDiscordCommandRegistration } from "../commands";
import { DiscordCommandRegistrationError } from "../errors";
import { discordLogEvents, type DiscordLogScope } from "../logger";
import type { DiscordCommandRegistrationMode } from "../types";

export async function registerCommands<TCommands extends ChatCommandRegistry>(args: {
  readonly client: DiscordBotClient;
  readonly applicationId: DiscordApplicationId;
  readonly registration: DiscordCommandRegistrationMode;
  readonly commands: TCommands;
  readonly logger?: DiscordLogScope;
  readonly signal?: AbortSignal;
}): Promise<Result<void, DiscordCommandRegistrationError>> {
  const commandCount = Object.keys(args.commands).length;

  if (args.registration.scope.type === "none") {
    if (commandCount > 0) {
      args.logger?.warn(discordLogEvents.commandsRegisterWarning, {
        operation: "registerCommands",
        reason: "registration_disabled",
        commandCount,
      });
    }
    return Result.ok();
  }

  if (commandCount === 0) {
    return Result.ok();
  }

  const registration = args.registration as Extract<
    DiscordCommandRegistrationMode,
    { readonly scope: { readonly type: "global" } | { readonly type: "guild" } }
  >;
  const scope = registration.scope;
  const strategy = registration.strategy ?? "upsert";
  const payload = createDiscordCommandRegistration({
    commands: args.commands,
    logger: args.logger,
  });

  return Result.gen(async function* () {
    const registration = yield* payload;

    if (registration.commands.length === 0) {
      return Result.err(
        new DiscordCommandRegistrationError({
          reason: "Discord command registration produced no valid commands",
        }),
      );
    }

    if (strategy === "bulk-overwrite" && registration.skipped.length > 0) {
      return Result.err(
        new DiscordCommandRegistrationError({
          reason:
            "Discord bulk command overwrite refused because one or more commands were skipped during validation",
        }),
      );
    }

    yield* Result.await(
      Result.tryPromise({
        try: async () => {
          await args.client.registerCommands({
            applicationId: args.applicationId,
            scope,
            commands: registration.commands,
            strategy,
            signal: args.signal,
          });
        },
        catch: (cause) => new DiscordCommandRegistrationError({ cause }),
      }),
    );

    return Result.ok();
  });
}
