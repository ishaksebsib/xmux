import { Result } from "better-result";
import type { TelegramBotClient } from "../client";
import { encodeTelegramPollingOptions } from "../conversions/polling";
import { TelegramStartError } from "../errors";
import type { TelegramAdapterMode } from "../types";

export async function initializeBot(args: {
  readonly bot: TelegramBotClient;
  readonly signal?: AbortSignal;
}): Promise<Result<void, TelegramStartError>> {
  const initialized = await Result.tryPromise({
    try: async () => args.bot.init(args.signal),
    catch: (cause) => new TelegramStartError({ operation: "init", cause }),
  });
  if (initialized.isErr()) {
    return Result.err(initialized.error);
  }

  return Result.ok();
}

export function startPolling(args: {
  readonly bot: TelegramBotClient;
  readonly mode: Extract<TelegramAdapterMode, { readonly type: "polling" }>;
}): Result<{ readonly polling: Promise<void> }, TelegramStartError> {
  const polling = Result.try({
    try: () => args.bot.start(encodeTelegramPollingOptions(args.mode)),
    catch: (cause) => new TelegramStartError({ operation: "polling", cause }),
  });
  if (polling.isErr()) {
    return Result.err(polling.error);
  }

  return Result.ok({ polling: polling.value });
}
