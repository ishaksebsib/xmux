import { Result } from "better-result";
import type { TelegramBotClient } from "../client";
import { encodeTelegramPollingOptions } from "../conversions/polling";
import { TelegramStartError } from "../errors";
import type { TelegramAdapterMode } from "../types";

export function initializeBot(args: {
  readonly bot: TelegramBotClient;
  readonly signal?: AbortSignal;
}): Promise<Result<void, TelegramStartError>> {
  return Result.tryPromise({
    try: async () => args.bot.init(args.signal),
    catch: (cause) => new TelegramStartError({ operation: "init", cause }),
  });
}

export function startPolling(args: {
  readonly bot: TelegramBotClient;
  readonly mode: Extract<TelegramAdapterMode, { readonly type: "polling" }>;
}): Result<{ readonly polling: Promise<void> }, TelegramStartError> {
  return Result.try({
    try: () => args.bot.start(encodeTelegramPollingOptions(args.mode)),
    catch: (cause) => new TelegramStartError({ operation: "polling", cause }),
  }).map((polling) => ({ polling }));
}
