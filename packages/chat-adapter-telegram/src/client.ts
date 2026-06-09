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
type EditMessageText = GrammyBotApi["editMessageText"];
type SendMessage = GrammyBotApi["sendMessage"];
type SendChatAction = GrammyBotApi["sendChatAction"];
type AnswerCallbackQuery = GrammyBotApi["answerCallbackQuery"];
type SetMyCommands = GrammyBotApi["setMyCommands"];
type GetFile = GrammyBotApi["getFile"];

export type TelegramEditedTextMessage = Awaited<ReturnType<EditMessageText>>;
export type TelegramSentTextMessage = Awaited<ReturnType<SendMessage>>;
export type TelegramStreamedTextMessages = Message.TextMessage[];

export type TelegramMessageContext = Filter<Context, "message">;
export type TelegramTextMessageContext = Filter<Context, "message:text">;
export type TelegramCallbackQueryDataContext = Filter<Context, "callback_query:data">;

export type TelegramMessageHandler = (context: TelegramMessageContext) => void | Promise<void>;
export type TelegramTextMessageHandler = (
  context: TelegramTextMessageContext,
) => void | Promise<void>;
export type TelegramCallbackQueryDataHandler = (
  context: TelegramCallbackQueryDataContext,
) => void | Promise<void>;

export interface TelegramBotClient {
  catch(handler: Parameters<BotCatch>[0]): ReturnType<BotCatch>;
  answerCallbackQuery(args: {
    readonly callbackQueryId: Parameters<AnswerCallbackQuery>[0];
    readonly options?: Parameters<AnswerCallbackQuery>[1];
    readonly signal?: AbortSignal;
  }): ReturnType<AnswerCallbackQuery>;
  editMessageText(args: {
    readonly chatId: Parameters<EditMessageText>[0];
    readonly messageId: Parameters<EditMessageText>[1];
    readonly text: Parameters<EditMessageText>[2];
    readonly options?: Parameters<EditMessageText>[3];
    readonly signal?: AbortSignal;
  }): ReturnType<EditMessageText>;
  downloadFile(args: { readonly filePath: string; readonly signal?: AbortSignal }): Promise<Response>;
  getBotInfo(): UserFromGetMe;
  getFile(args: {
    readonly fileId: Parameters<GetFile>[0];
    readonly signal?: AbortSignal;
  }): ReturnType<GetFile>;
  init(signal?: AbortSignal): ReturnType<BotInit>;
  isRunning(): boolean;
  onCallbackQueryData(handler: TelegramCallbackQueryDataHandler): void;
  onMessage(handler: TelegramMessageHandler): void;
  sendMessage(args: {
    readonly chatId: Parameters<SendMessage>[0];
    readonly text: Parameters<SendMessage>[1];
    readonly options?: Parameters<SendMessage>[2];
    readonly signal?: AbortSignal;
  }): ReturnType<SendMessage>;
  sendChatAction(args: {
    readonly chatId: Parameters<SendChatAction>[0];
    readonly action: Parameters<SendChatAction>[1];
    readonly options?: Parameters<SendChatAction>[2];
    readonly signal?: AbortSignal;
  }): ReturnType<SendChatAction>;
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
    answerCallbackQuery: (input) =>
      bot.api.answerCallbackQuery(
        input.callbackQueryId,
        input.options,
        input.signal as Parameters<AnswerCallbackQuery>[2],
      ),
    editMessageText: (input) =>
      bot.api.editMessageText(
        input.chatId,
        input.messageId,
        input.text,
        input.options,
        input.signal as Parameters<EditMessageText>[4],
      ),
    downloadFile: (input) =>
      fetch(`https://api.telegram.org/file/bot${args.token}/${input.filePath}`, {
        signal: input.signal,
      }),
    getBotInfo: () => bot.botInfo,
    getFile: (input) =>
      bot.api.getFile(input.fileId, input.signal as Parameters<GetFile>[1]),
    init: (signal) => bot.init(signal as Parameters<BotInit>[0]),
    isRunning: bot.isRunning.bind(bot),
    onCallbackQueryData: (handler) => {
      bot.on("callback_query:data", handler);
    },
    onMessage: (handler) => {
      bot.on("message", handler);
    },
    sendMessage: (input) =>
      bot.api.sendMessage(
        input.chatId,
        input.text,
        input.options,
        input.signal as Parameters<SendMessage>[3],
      ),
    sendChatAction: (input) =>
      bot.api.sendChatAction(
        input.chatId,
        input.action,
        input.options,
        input.signal as Parameters<SendChatAction>[3],
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
