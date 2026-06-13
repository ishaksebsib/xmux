import { Result } from "better-result";
import {
  serializeChatLogError,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "@xmux/chat-core";
import type {
  DiscordBotClient,
  DiscordInteractionHandler,
  DiscordMessageHandler,
  DiscordReactionHandler,
} from "../client";
import { DiscordInboundDecodeError, type DiscordAdapterError } from "../errors";
import { discordLogEvents, type DiscordLogScope } from "../logger";
import type { DiscordAdapterData, DiscordAdapterMode } from "../types";

export function registerInboundHandlers<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    DiscordAdapterData,
    DiscordAdapterError
  >;
  readonly logger: DiscordLogScope;
  readonly mode: DiscordAdapterMode;
}): void {
  args.client.onInteractionCreate(createIgnoredInteractionHandler(args));

  if (args.mode.type === "gateway" && args.mode.observeMessages) {
    args.client.onMessageCreate(createIgnoredMessageHandler(args));
  }

  if (args.mode.type === "gateway" && args.mode.observeReactions) {
    const reactionHandler = createIgnoredReactionHandler(args);
    args.client.onReactionAdd(reactionHandler);
    args.client.onReactionRemove(reactionHandler);
  }
}

function createIgnoredMessageHandler<TCommands extends ChatCommandRegistry, TChatId extends string>(
  args: RegisterHandlerArgs<TCommands, TChatId>,
): DiscordMessageHandler {
  return () => {
    runGatewayHandler({
      ...args,
      eventType: "messageCreate",
      handle: async () => {
        args.logger.debug(discordLogEvents.inboundIgnored, {
          eventType: "messageCreate",
          reason: "not_implemented",
        });
      },
    });
  };
}

function createIgnoredInteractionHandler<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: RegisterHandlerArgs<TCommands, TChatId>): DiscordInteractionHandler {
  return () => {
    runGatewayHandler({
      ...args,
      eventType: "interactionCreate",
      handle: async () => {
        args.logger.debug(discordLogEvents.inboundIgnored, {
          eventType: "interactionCreate",
          reason: "not_implemented",
        });
      },
    });
  };
}

function createIgnoredReactionHandler<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: RegisterHandlerArgs<TCommands, TChatId>): DiscordReactionHandler {
  return () => {
    runGatewayHandler({
      ...args,
      eventType: "messageReaction",
      handle: async () => {
        args.logger.debug(discordLogEvents.inboundIgnored, {
          eventType: "messageReaction",
          reason: "not_implemented",
        });
      },
    });
  };
}

type RegisterHandlerArgs<TCommands extends ChatCommandRegistry, TChatId extends string> = {
  readonly chatId: TChatId;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    DiscordAdapterData,
    DiscordAdapterError
  >;
  readonly logger: DiscordLogScope;
};

function runGatewayHandler<TCommands extends ChatCommandRegistry, TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    DiscordAdapterData,
    DiscordAdapterError
  >;
  readonly logger: DiscordLogScope;
  readonly eventType: string;
  readonly handle: () => Promise<void>;
}): void {
  void Result.tryPromise({
    try: args.handle,
    catch: (cause) => new DiscordInboundDecodeError({ eventType: args.eventType, cause }),
  }).then((result) => {
    if (result.isOk()) {
      return;
    }

    args.logger.error(discordLogEvents.backgroundFailure, {
      operation: "inbound",
      eventType: args.eventType,
      error: serializeChatLogError(result.error),
    });
    args.context.emit({ type: "error", chatId: args.chatId, error: result.error });
  });
}
