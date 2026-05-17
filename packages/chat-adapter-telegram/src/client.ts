import { Bot } from "grammy";
import type { TelegramBotToken } from "./config";
import type { TelegramBotOptions } from "./types";

export type TelegramBotClient = Pick<Bot, "catch" | "init" | "isRunning" | "start" | "stop">;

export type CreateTelegramBotClient = (args: {
  readonly token: TelegramBotToken;
  readonly options?: TelegramBotOptions;
}) => TelegramBotClient;

export function createTelegramBotClient(args: {
  readonly token: TelegramBotToken;
  readonly options?: TelegramBotOptions;
}): TelegramBotClient {
  return new Bot(args.token, args.options);
}
