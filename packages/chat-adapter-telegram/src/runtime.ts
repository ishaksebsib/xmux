import { Result } from "better-result";
import type { PollingOptions } from "grammy";
import type {
  ChatAdapterStartContext,
  ChatCommandRegistry,
  OpenedChatAdapter,
} from "@xmux/chat-core";
import { telegramAdapterCapabilities } from "./capabilities";
import {
  createTelegramBotClient,
  type CreateTelegramBotClient,
  type TelegramBotClient,
} from "./client";
import { parseTelegramBotToken } from "./config";
import {
  TelegramConfigurationError,
  TelegramStartError,
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
  | {
      readonly status: "started";
      readonly polling: Promise<void>;
      readonly removeAbortListener?: () => void;
    }
  | { readonly status: "closed" };

export function openTelegramRuntime<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly options: CreateTelegramAdapterOptions<TChatId>;
  readonly mode: TelegramAdapterMode;
  readonly createBot?: CreateTelegramBotClient;
}): Result<
  OpenedChatAdapter<TChatId, TelegramAdapterOptions, TelegramAdapterData>,
  TelegramConfigurationError
> {
  const token = parseTelegramBotToken(args.options.token);
  if (token.isErr()) {
    return Result.err(token.error);
  }

  const createBot = args.createBot ?? createTelegramBotClient;
  const bot = Result.try({
    try: () => createBot({ token: token.value, options: args.options.botOptions }),
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

class TelegramRuntime<TChatId extends string> implements OpenedChatAdapter<
  TChatId,
  TelegramAdapterOptions,
  TelegramAdapterData
> {
  readonly capabilities = telegramAdapterCapabilities;
  readonly id: TChatId;

  #state: TelegramRuntimeState = { status: "opened" };

  constructor(args: {
    readonly chatId: TChatId;
    readonly bot: TelegramBotClient;
    readonly mode: TelegramAdapterMode;
  }) {
    this.id = args.chatId;
    this.bot = args.bot;
    this.mode = args.mode;
  }

  private readonly bot: TelegramBotClient;
  private readonly mode: TelegramAdapterMode;

  async start<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, TelegramAdapterData>,
  ): Promise<Result<void, TelegramStartError | TelegramWebhookModeUnsupportedError>> {
    if (this.#state.status === "closed" || this.#state.status === "started") {
      return Result.ok();
    }

    const mode = this.mode;
    if (mode.type === "webhook") {
      return Result.err(new TelegramWebhookModeUnsupportedError());
    }

    this.bot.catch((error) => {
      context.emit({ type: "error", chatId: this.id, error });
    });

    const initialized = await Result.tryPromise({
      try: async () => this.bot.init(context.signal as Parameters<TelegramBotClient["init"]>[0]),
      catch: (cause) => new TelegramStartError({ operation: "init", cause }),
    });
    if (initialized.isErr()) {
      return Result.err(initialized.error);
    }

    const polling = Result.try({
      try: () => this.bot.start(createPollingOptions(mode)),
      catch: (cause) => new TelegramStartError({ operation: "polling", cause }),
    });
    if (polling.isErr()) {
      return Result.err(polling.error);
    }

    this.#state = {
      status: "started",
      polling: polling.value.catch((error: unknown) => {
        if (this.#state.status !== "closed") {
          context.emit({ type: "error", chatId: this.id, error });
        }
      }),
    };

    const removeAbortListener = bindAbortSignal({
      signal: context.signal,
      abort: () => {
        void this.close().catch((error: unknown) => {
          context.emit({ type: "error", chatId: this.id, error });
        });
      },
    });

    if (removeAbortListener !== undefined && this.#state.status === "started") {
      this.#state = { ...this.#state, removeAbortListener };
    }

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

    const previousState = this.#state;
    this.#state = { status: "closed" };

    if (previousState.status === "started") {
      previousState.removeAbortListener?.();
    }

    if (this.bot.isRunning()) {
      await this.bot.stop();
    }
  }
}

function createPollingOptions(
  mode: Extract<TelegramAdapterMode, { readonly type: "polling" }>,
): PollingOptions {
  return {
    ...(mode.dropPendingUpdates === undefined
      ? {}
      : { drop_pending_updates: mode.dropPendingUpdates }),
    ...(mode.allowedUpdates === undefined
      ? {}
      : { allowed_updates: mode.allowedUpdates as PollingOptions["allowed_updates"] }),
  };
}

function bindAbortSignal(args: {
  readonly signal?: AbortSignal;
  readonly abort: () => void;
}): (() => void) | undefined {
  if (args.signal === undefined) {
    return undefined;
  }

  if (args.signal.aborted) {
    args.abort();
    return undefined;
  }

  args.signal.addEventListener("abort", args.abort, { once: true });
  return () => {
    args.signal?.removeEventListener("abort", args.abort);
  };
}
