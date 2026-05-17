import { Result } from "better-result";
import { Bot } from "grammy";
import type {
  ChatAdapterStartContext,
  ChatCommandRegistry,
  OpenedChatAdapter,
} from "@xmux/chat-core";
import { telegramAdapterCapabilities } from "./capabilities";
import { parseTelegramBotToken } from "./config";
import {
  TelegramConfigurationError,
  TelegramWebhookModeUnsupportedError,
} from "./errors";
import type {
  CreateTelegramAdapterOptions,
  TelegramAdapterData,
  TelegramAdapterMode,
  TelegramAdapterOptions,
} from "./types";

type TelegramRuntimeState =
  | { readonly status: "opened" }
  | { readonly status: "started" }
  | { readonly status: "closed" };

export function openTelegramRuntime<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly options: CreateTelegramAdapterOptions<TChatId>;
  readonly mode: TelegramAdapterMode;
}): Result<OpenedChatAdapter<TChatId, TelegramAdapterOptions, TelegramAdapterData>, TelegramConfigurationError> {
  const token = parseTelegramBotToken(args.options.token);
  if (token.isErr()) {
    return Result.err(token.error);
  }

  const bot = Result.try({
    try: () => new Bot(token.value, args.options.botOptions),
    catch: (cause) =>
      new TelegramConfigurationError({
        field: "token",
        cause,
      }),
  });
  if (bot.isErr()) {
    return Result.err(bot.error);
  }

  return Result.ok(new TelegramRuntime({ chatId: args.chatId, bot: bot.value, mode: args.mode }));
}

class TelegramRuntime<TChatId extends string>
  implements OpenedChatAdapter<TChatId, TelegramAdapterOptions, TelegramAdapterData>
{
  readonly capabilities = telegramAdapterCapabilities;
  readonly id: TChatId;

  #state: TelegramRuntimeState = { status: "opened" };

  constructor(args: {
    readonly chatId: TChatId;
    readonly bot: Bot;
    readonly mode: TelegramAdapterMode;
  }) {
    this.id = args.chatId;
    this.bot = args.bot;
    this.mode = args.mode;
  }

  private readonly bot: Bot;
  private readonly mode: TelegramAdapterMode;

  async start<TCommands extends ChatCommandRegistry>(
    _context: ChatAdapterStartContext<TCommands, TChatId, TelegramAdapterData>,
  ): Promise<Result<void, TelegramWebhookModeUnsupportedError>> {
    if (this.#state.status === "closed") {
      return Result.ok();
    }

    if (this.mode.type === "webhook") {
      return Result.err(new TelegramWebhookModeUnsupportedError());
    }

    this.#state = { status: "started" };
    return Result.ok();
  }

  async sendMessage(): Promise<Result<never, Error>> {
    return Result.err(new Error("Telegram adapter sendMessage is not implemented yet"));
  }

  async reply(): Promise<Result<never, Error>> {
    return Result.err(new Error("Telegram adapter reply is not implemented yet"));
  }

  async close(): Promise<void> {
    if (this.#state.status === "closed") {
      return;
    }

    this.#state = { status: "closed" };
    if (this.bot.isRunning()) {
      await this.bot.stop();
    }
  }
}
