import { Result } from "better-result";
import type {
  ChatAdapterReplyInput,
  ChatAdapterRespondToActionInput,
  ChatAdapterSendActionInput,
  ChatAdapterSendMessageInput,
  ChatAdapterSendTypingInput,
  ChatAdapterStartContext,
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
  ChatCommandRegistry,
  ChatSentMessage,
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
  TelegramActionResponseError,
  type TelegramAdapterError,
  TelegramCommandRegistrationError,
  TelegramConfigurationError,
  TelegramReplyError,
  TelegramSendActionError,
  TelegramSendMessageError,
  TelegramSendTypingError,
  TelegramStartError,
  TelegramStreamMessageError,
  TelegramStreamReplyError,
  TelegramWebhookModeUnsupportedError,
} from "./errors";
import { registerInboundHandlers } from "./handlers/inbound";
import { registerCommands } from "./handlers/register-commands";
import { respondToAction as handleRespondToAction } from "./handlers/respond-action";
import { reply as handleReply } from "./handlers/reply";
import { sendAction as handleSendAction } from "./handlers/send-action";
import { sendMessage as handleSendMessage } from "./handlers/send-message";
import { sendTyping as handleSendTyping } from "./handlers/send-typing";
import { initializeBot, startPolling } from "./handlers/start-polling";
import { streamMessage as handleStreamMessage } from "./handlers/stream-message";
import { streamReply as handleStreamReply } from "./handlers/stream-reply";
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
  OpenedChatAdapter<
    TChatId,
    TelegramAdapterOptions,
    TelegramAdapterData,
    typeof telegramAdapterCapabilities,
    TelegramAdapterError
  >,
  TelegramConfigurationError
> {
  return Result.gen(function* () {
    const token = yield* parseTelegramBotToken(args.options.token);
    const bot = yield* Result.try({
      try: () =>
        (args.createBot ?? createTelegramBotClient)({
          token,
          options: args.options.botOptions,
        }),
      catch: (cause) => new TelegramConfigurationError({ field: "token", cause }),
    });

    return Result.ok(new TelegramRuntime({ chatId: args.chatId, bot, mode: args.mode }));
  });
}

class TelegramRuntime<TChatId extends string> implements OpenedChatAdapter<
  TChatId,
  TelegramAdapterOptions,
  TelegramAdapterData,
  typeof telegramAdapterCapabilities,
  TelegramAdapterError
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
  ): Promise<
    Result<
      void,
      TelegramCommandRegistrationError | TelegramStartError | TelegramWebhookModeUnsupportedError
    >
  > {
    if (this.#state.status === "closed" || this.#state.status === "started") {
      return Result.ok();
    }

    const mode = this.mode;
    if (mode.type === "webhook") {
      return Result.err(new TelegramWebhookModeUnsupportedError());
    }

    registerInboundHandlers({ chatId: this.id, bot: this.bot, context });

    const started = await Result.gen(async function* () {
      yield* Result.await(initializeBot({ bot: this.bot, signal: context.signal }));
      yield* Result.await(
        registerCommands({
          bot: this.bot,
          commands: context.commands,
          signal: context.signal,
        }),
      );
      const polling = yield* startPolling({ bot: this.bot, mode });
      return Result.ok(polling);
    }, this);
    if (started.isErr()) {
      return Result.err(started.error);
    }

    this.#state = {
      status: "started",
      polling: started.value.polling.catch((error: unknown) => {
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

  async sendMessage(
    input: ChatAdapterSendMessageInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramSendMessageError>> {
    return handleSendMessage({ chatId: this.id, bot: this.bot, input });
  }

  async sendAction(
    input: ChatAdapterSendActionInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramSendActionError>> {
    return handleSendAction({ chatId: this.id, bot: this.bot, input });
  }

  async respondToAction(
    input: ChatAdapterRespondToActionInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<void, TelegramActionResponseError>> {
    return handleRespondToAction({ bot: this.bot, input });
  }

  async reply(
    input: ChatAdapterReplyInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramReplyError>> {
    return handleReply({ chatId: this.id, bot: this.bot, input });
  }

  async sendTyping(
    input: ChatAdapterSendTypingInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<void, TelegramSendTypingError>> {
    return handleSendTyping({ bot: this.bot, input });
  }

  async streamMessage(
    input: ChatAdapterStreamMessageInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramStreamMessageError>> {
    return handleStreamMessage({ chatId: this.id, bot: this.bot, input });
  }

  async streamReply(
    input: ChatAdapterStreamReplyInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramStreamReplyError>> {
    return handleStreamReply({ chatId: this.id, bot: this.bot, input });
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
