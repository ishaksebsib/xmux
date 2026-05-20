import { autoRetry } from "@grammyjs/auto-retry";
import { streamApi, type MessageDraftPiece } from "@grammyjs/stream";
import { Bot, type Context, type Filter } from "grammy";
import type { Message, UserFromGetMe } from "grammy/types";
import type { TelegramBotToken } from "./config";
import type { TelegramBotOptions } from "./types";

type GrammyBotApi = Bot["api"];
type BotCatch = Bot["catch"];
type BotInit = Bot["init"];
type BotStart = Bot["start"];
type SendMessage = GrammyBotApi["sendMessage"];
type SetMyCommands = GrammyBotApi["setMyCommands"];

export type TelegramSentTextMessage = Awaited<ReturnType<SendMessage>>;
export type TelegramStreamedTextMessages = Message.TextMessage[];

export type TelegramTextMessageContext = Filter<Context, "message:text">;

export type TelegramTextMessageHandler = (
  context: TelegramTextMessageContext,
) => void | Promise<void>;

export interface TelegramBotClient {
  catch(handler: Parameters<BotCatch>[0]): ReturnType<BotCatch>;
  getBotInfo(): UserFromGetMe;
  init(signal?: AbortSignal): ReturnType<BotInit>;
  isRunning(): boolean;
  onTextMessage(handler: TelegramTextMessageHandler): void;
  sendMessage(args: {
    readonly chatId: Parameters<SendMessage>[0];
    readonly text: Parameters<SendMessage>[1];
    readonly options?: Parameters<SendMessage>[2];
    readonly signal?: AbortSignal;
  }): ReturnType<SendMessage>;
  setMyCommands(args: {
    readonly commands: Parameters<SetMyCommands>[0];
    readonly signal?: AbortSignal;
  }): ReturnType<SetMyCommands>;
  start(options?: Parameters<BotStart>[0]): ReturnType<BotStart>;
  streamMessage(args: {
    readonly chatId: number;
    readonly draftIdOffset: number;
    readonly stream: Iterable<MessageDraftPiece> | AsyncIterable<MessageDraftPiece>;
    readonly draftOptions?: Parameters<ReturnType<typeof streamApi>["streamMessage"]>[3];
    readonly messageOptions?: Parameters<ReturnType<typeof streamApi>["streamMessage"]>[4];
    readonly signal?: AbortSignal;
  }): Promise<TelegramStreamedTextMessages>;
  stop(): ReturnType<Bot["stop"]>;
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
  bot.api.config.use(autoRetry());
  const stream = streamApi(bot.api.raw);

  return {
    catch: bot.catch.bind(bot),
    getBotInfo: () => bot.botInfo,
    init: (signal) => bot.init(signal as Parameters<BotInit>[0]),
    isRunning: bot.isRunning.bind(bot),
    onTextMessage: (handler) => {
      bot.on("message:text", handler);
    },
    sendMessage: (input) =>
      bot.api.sendMessage(
        input.chatId,
        input.text,
        input.options,
        input.signal as Parameters<SendMessage>[3],
      ),
    setMyCommands: (input) =>
      bot.api.setMyCommands(
        input.commands,
        undefined,
        input.signal as Parameters<SetMyCommands>[2],
      ),
    start: bot.start.bind(bot),
    stop: bot.stop.bind(bot),
    streamMessage: (input) =>
      stream.streamMessage(
        input.chatId,
        input.draftIdOffset,
        input.stream,
        input.draftOptions,
        input.messageOptions,
        input.signal as Parameters<typeof stream.streamMessage>[5],
      ),
  };
}
