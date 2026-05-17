import { Bot, type Context, type Filter } from "grammy";
import type { TelegramBotToken } from "./config";
import type { TelegramBotOptions } from "./types";

type GrammyBotApi = Bot["api"];
type SetMyCommands = GrammyBotApi["setMyCommands"];

export type TelegramTextMessageContext = Filter<Context, "message:text">;
export type TelegramTextMessageHandler = (
  context: TelegramTextMessageContext,
) => void | Promise<void>;

export interface TelegramBotClient extends Pick<
  Bot,
  "catch" | "init" | "isRunning" | "start" | "stop"
> {
  onTextMessage(handler: TelegramTextMessageHandler): void;
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
    onTextMessage: (handler) => {
      bot.on("message:text", (context) => handler(context));
    },
    setMyCommands: (commands, signal) => bot.api.setMyCommands(commands, undefined, signal),
  };
}
