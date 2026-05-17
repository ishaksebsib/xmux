import { Result } from "better-result";
import { TelegramConfigurationError } from "./errors";
import type { TelegramAdapterMode } from "./types";

declare const telegramBotTokenBrand: unique symbol;

export type TelegramBotToken = string & { readonly [telegramBotTokenBrand]: true };

export const defaultTelegramAdapterMode = { type: "polling" } as const satisfies TelegramAdapterMode;

export function parseTelegramBotToken(token: string): Result<TelegramBotToken, TelegramConfigurationError> {
  return token.trim().length === 0
    ? Result.err(
        new TelegramConfigurationError({
          field: "token",
          reason: "Telegram bot token must not be empty",
        }),
      )
    : Result.ok(token as TelegramBotToken);
}
