import { Bot } from "grammy";
import type { TelegramBotToken } from "./config";
import type { TelegramBotOptions } from "./types";

type GrammyBotApi = Bot["api"];
type SetMyCommands = GrammyBotApi["setMyCommands"];

export interface TelegramBotClient extends Pick<
  Bot,
  "catch" | "init" | "isRunning" | "start" | "stop"
> {
  setMyCommands(
    commands: Parameters<SetMyCommands>[0],
    signal?: Parameters<SetMyCommands>[2],
  ): ReturnType<SetMyCommands>;
}

export type CreateTelegramBotClient = (args: {
  readonly token: TelegramBotToken;
  readonly options?: TelegramBotOptions;
}) => TelegramBotClient;

export function createTelegramBotClient(args: {
  readonly token: TelegramBotToken;
  readonly options?: TelegramBotOptions;
}): TelegramBotClient {
  const bot = new Bot(args.token, args.options);

  return {
    catch: bot.catch.bind(bot),
    init: bot.init.bind(bot),
    isRunning: bot.isRunning.bind(bot),
    start: bot.start.bind(bot),
    stop: bot.stop.bind(bot),
    setMyCommands: (commands, signal) => bot.api.setMyCommands(commands, undefined, signal),
  };
}
