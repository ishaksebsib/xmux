import { Result, type Result as ResultType } from "better-result";
import { TelegramConfigurationError } from "./errors";
import type {
  CreateTelegramAdapterOptions,
  TelegramAdapterMode,
  TelegramBotOptions,
} from "./types";

declare const telegramBotTokenBrand: unique symbol;

export type TelegramBotToken = string & { readonly [telegramBotTokenBrand]: true };

export interface TelegramAdapterConfig<TChatId extends string = string> {
  readonly id: TChatId;
  readonly token: TelegramBotToken;
  readonly mode: TelegramAdapterMode;
  readonly botOptions?: TelegramBotOptions;
}

export const defaultTelegramAdapterMode = {
  type: "polling",
} as const satisfies TelegramAdapterMode;

export function normalizeTelegramMode(mode?: TelegramAdapterMode): TelegramAdapterMode {
  return mode ?? defaultTelegramAdapterMode;
}

export function parseTelegramAdapterConfig<TChatId extends string>(input: {
  readonly chatId: TChatId;
  readonly options: CreateTelegramAdapterOptions<TChatId>;
}): ResultType<TelegramAdapterConfig<TChatId>, TelegramConfigurationError> {
  return Result.gen(function* () {
    const token = yield* parseTelegramBotToken(input.options.token);
    const mode = yield* parseTelegramMode(normalizeTelegramMode(input.options.mode));

    return Result.ok({
      id: input.chatId,
      token,
      mode,
      ...(input.options.botOptions === undefined ? {} : { botOptions: input.options.botOptions }),
    });
  });
}

export function parseTelegramBotToken(
  token: string,
): Result<TelegramBotToken, TelegramConfigurationError> {
  const trimmed = token.trim();

  return trimmed.length === 0
    ? Result.err(
        new TelegramConfigurationError({
          field: "token",
          reason: "Telegram bot token must not be empty",
        }),
      )
    : Result.ok(trimmed as TelegramBotToken);
}

function parseTelegramMode(
  mode: TelegramAdapterMode,
): ResultType<TelegramAdapterMode, TelegramConfigurationError> {
  const allowedUpdates =
    mode.allowedUpdates === undefined ? undefined : Object.freeze([...mode.allowedUpdates]);

  if (mode.type === "polling") {
    return Result.ok({
      type: "polling",
      ...(mode.dropPendingUpdates === undefined
        ? {}
        : { dropPendingUpdates: mode.dropPendingUpdates }),
      ...(allowedUpdates === undefined ? {} : { allowedUpdates }),
    });
  }

  if (mode.secretToken !== undefined && mode.secretToken.trim().length === 0) {
    return Result.err(
      new TelegramConfigurationError({
        field: "mode.secretToken",
        reason: "Telegram webhook secretToken must not be empty when provided",
      }),
    );
  }

  return Result.ok({
    type: "webhook",
    ...(mode.secretToken === undefined ? {} : { secretToken: mode.secretToken.trim() }),
    ...(allowedUpdates === undefined ? {} : { allowedUpdates }),
  });
}
