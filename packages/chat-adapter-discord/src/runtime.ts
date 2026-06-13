import { Result } from "better-result";
import { startChatLogTimer, type OpenedChatAdapter } from "@xmux/chat-core";
import { discordAdapterCapabilities } from "./capabilities";
import { parseDiscordApplicationId, parseDiscordBotToken } from "./config";
import { createDiscordLogScope, logChatResult, discordLogEvents, type ChatLogger } from "./logger";
import {
  DiscordNotImplementedError,
  DiscordWebhookModeUnsupportedError,
  type DiscordAdapterError,
} from "./errors";
import type {
  CreateDiscordAdapterOptions,
  DiscordAdapterData,
  DiscordAdapterMode,
  DiscordAdapterOptions,
} from "./types";

type DiscordOpenedAdapter<TChatId extends string> = OpenedChatAdapter<
  TChatId,
  DiscordAdapterOptions,
  DiscordAdapterData,
  typeof discordAdapterCapabilities,
  DiscordAdapterError
>;

export function openDiscordRuntime<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly options: CreateDiscordAdapterOptions<TChatId>;
  readonly mode: DiscordAdapterMode;
  readonly logger?: ChatLogger;
}): Result<DiscordOpenedAdapter<TChatId>, DiscordAdapterError> {
  const logger = createDiscordLogScope({
    logger: args.logger,
    chatId: args.chatId,
    mode: args.mode.type,
  });
  const startedAt = startChatLogTimer();
  const metadata = { operation: "open", mode: args.mode.type } as const;

  logger.debug(discordLogEvents.openBegin, metadata);

  const result: Result<DiscordOpenedAdapter<TChatId>, DiscordAdapterError> = Result.gen(
    function* () {
      yield* parseDiscordBotToken(args.options.token);
      yield* parseDiscordApplicationId(args.options.applicationId);

      if (args.mode.type === "webhook") {
        return Result.err<DiscordOpenedAdapter<TChatId>, DiscordAdapterError>(
          new DiscordWebhookModeUnsupportedError(),
        );
      }

      return Result.err<DiscordOpenedAdapter<TChatId>, DiscordAdapterError>(
        new DiscordNotImplementedError({ operation: "gateway runtime" }),
      );
    },
  );

  logChatResult({
    logger,
    result,
    startedAt,
    metadata,
    successEvent: discordLogEvents.openSuccess,
    failureEvent: discordLogEvents.openFailure,
  });

  return result;
}
