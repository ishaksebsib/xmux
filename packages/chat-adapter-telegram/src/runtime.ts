import { Result } from "better-result";
import { serializeChatLogError, startChatLogTimer, type ChatLogger } from "@xmux/chat-core";
import type {
  ChatAdapterReplyInput,
  ChatAdapterRespondToActionInput,
  ChatAdapterSendActionInput,
  ChatAdapterSendMessageInput,
  ChatAdapterSendTypingInput,
  ChatAdapterStartContext,
  ChatAdapterStreamMessageInput,
  ChatAdapterUpdateActionInput,
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
import {
  normalizeTelegramMode,
  parseTelegramAdapterConfig,
  type TelegramAdapterConfig,
} from "./config";
import {
  createTelegramLogScope,
  logChatResult,
  telegramLogEvents,
  type TelegramLogScope,
} from "./logger";
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
  TelegramUpdateActionError,
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
import { updateAction as handleUpdateAction } from "./handlers/update-action";
import { sendTyping as handleSendTyping } from "./handlers/send-typing";
import { initializeBot, startPolling } from "./handlers/start-polling";
import { streamMessage as handleStreamMessage } from "./handlers/stream-message";
import { streamReply as handleStreamReply } from "./handlers/stream-reply";
import type {
  CreateTelegramAdapterOptions,
  TelegramAdapterData,
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
  readonly createBot?: CreateTelegramBotClient;
  readonly logger?: ChatLogger;
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
  const configResult = parseTelegramAdapterConfig({ chatId: args.chatId, options: args.options });
  const logMode = configResult.isOk()
    ? configResult.value.mode.type
    : normalizeTelegramMode(args.options.mode).type;
  const logger = createTelegramLogScope({
    logger: args.logger,
    chatId: args.chatId,
    mode: logMode,
  });
  const startedAt = startChatLogTimer();
  const metadata = { operation: "open", mode: logMode } as const;

  logger.debug(telegramLogEvents.openBegin, metadata);

  const result = Result.gen(function* () {
    const config = yield* configResult;
    const bot = yield* Result.try({
      try: () =>
        (args.createBot ?? createTelegramBotClient)({
          token: config.token,
          options: config.botOptions,
        }),
      catch: (cause) => new TelegramConfigurationError({ field: "token", cause }),
    });

    return Result.ok(new TelegramRuntime({ config, bot, logger }));
  });

  logChatResult({
    logger,
    result,
    startedAt,
    metadata,
    successEvent: telegramLogEvents.openSuccess,
    failureEvent: telegramLogEvents.openFailure,
  });

  return result;
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
    readonly config: TelegramAdapterConfig<TChatId>;
    readonly bot: TelegramBotClient;
    readonly logger: TelegramLogScope;
  }) {
    this.id = args.config.id;
    this.bot = args.bot;
    this.config = args.config;
    this.logger = args.logger;
  }

  private readonly bot: TelegramBotClient;
  private readonly config: TelegramAdapterConfig<TChatId>;
  private readonly logger: TelegramLogScope;

  async start<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, TelegramAdapterData>,
  ): Promise<
    Result<
      void,
      TelegramCommandRegistrationError | TelegramStartError | TelegramWebhookModeUnsupportedError
    >
  > {
    const startedAt = startChatLogTimer();
    const metadata = { operation: "start", mode: this.config.mode.type } as const;

    this.logger.debug(telegramLogEvents.startBegin, metadata);

    if (this.#state.status === "closed" || this.#state.status === "started") {
      const result = Result.ok<void, never>(undefined);
      logChatResult({
        logger: this.logger,
        result,
        startedAt,
        metadata: { ...metadata, result: "ignored", lifecycleStatus: this.#state.status },
        successEvent: telegramLogEvents.startSuccess,
        failureEvent: telegramLogEvents.startFailure,
      });
      return result;
    }

    const mode = this.config.mode;
    if (mode.type === "webhook") {
      const result = Result.err(new TelegramWebhookModeUnsupportedError());
      logChatResult({
        logger: this.logger,
        result,
        startedAt,
        metadata,
        successEvent: telegramLogEvents.startSuccess,
        failureEvent: telegramLogEvents.startFailure,
      });
      return result;
    }

    registerInboundHandlers({ chatId: this.id, bot: this.bot, context, logger: this.logger });

    const started = await Result.gen(async function* () {
      yield* Result.await(initializeBot({ bot: this.bot, signal: context.signal }));
      this.logger.debug(telegramLogEvents.commandsRegisterBegin, {
        operation: "registerCommands",
        commandCount: Object.keys(context.commands).length,
      });
      const commandsStartedAt = startChatLogTimer();
      const registered = await registerCommands({
        bot: this.bot,
        commands: context.commands,
        logger: this.logger,
        signal: context.signal,
      });
      logChatResult({
        logger: this.logger,
        result: registered,
        startedAt: commandsStartedAt,
        metadata: {
          operation: "registerCommands",
          commandCount: Object.keys(context.commands).length,
        },
        successEvent: telegramLogEvents.commandsRegisterSuccess,
        failureEvent: telegramLogEvents.commandsRegisterFailure,
      });
      yield* registered;
      this.logger.debug(telegramLogEvents.pollingStart, { operation: "startPolling" });
      const polling = yield* startPolling({ bot: this.bot, mode });
      return Result.ok(polling);
    }, this);
    if (started.isErr()) {
      logChatResult({
        logger: this.logger,
        result: started,
        startedAt,
        metadata,
        successEvent: telegramLogEvents.startSuccess,
        failureEvent: telegramLogEvents.startFailure,
      });
      return Result.err(started.error);
    }

    this.#state = {
      status: "started",
      polling: started.value.polling.catch((error: unknown) => {
        if (this.#state.status !== "closed") {
          this.logger.error(telegramLogEvents.pollingFailure, {
            operation: "polling",
            error: serializeChatLogError(error),
          });
          context.emit({ type: "error", chatId: this.id, error });
        }
      }),
    };

    const removeAbortListener = bindAbortSignal({
      signal: context.signal,
      abort: () => {
        void this.close().catch((error: unknown) => {
          this.logger.error(telegramLogEvents.backgroundFailure, {
            operation: "close",
            reason: "abort_close_failed",
            error: serializeChatLogError(error),
          });
          context.emit({ type: "error", chatId: this.id, error });
        });
      },
    });

    if (removeAbortListener !== undefined && this.#state.status === "started") {
      this.#state = { ...this.#state, removeAbortListener };
    }

    const result = Result.ok<void, never>(undefined);
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.startSuccess,
      failureEvent: telegramLogEvents.startFailure,
    });
    return result;
  }

  async sendMessage(
    input: ChatAdapterSendMessageInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramSendMessageError>> {
    const startedAt = startChatLogTimer();
    const metadata = outboundMessageMetadata("sendMessage", input);
    this.logger.debug(telegramLogEvents.outboundBegin, metadata);
    const result = await handleSendMessage({ chatId: this.id, bot: this.bot, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.outboundSuccess,
      failureEvent: telegramLogEvents.outboundFailure,
    });
    return result;
  }

  async sendAction(
    input: ChatAdapterSendActionInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramSendActionError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundMessageMetadata("sendAction", input),
      buttonRows: input.buttons.length,
      buttonCount: input.buttons.reduce((count, row) => count + row.length, 0),
    } as const;
    this.logger.debug(telegramLogEvents.outboundBegin, metadata);
    const result = await handleSendAction({ chatId: this.id, bot: this.bot, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.outboundSuccess,
      failureEvent: telegramLogEvents.outboundFailure,
    });
    return result;
  }

  async updateAction(
    input: ChatAdapterUpdateActionInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramUpdateActionError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundMessageMetadata("updateAction", input),
      messageId: input.message.messageId,
      buttonRows: input.buttons.length,
      buttonCount: input.buttons.reduce((count, row) => count + row.length, 0),
    } as const;
    this.logger.debug(telegramLogEvents.outboundBegin, metadata);
    const result = await handleUpdateAction({ chatId: this.id, bot: this.bot, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.outboundSuccess,
      failureEvent: telegramLogEvents.outboundFailure,
    });
    return result;
  }

  async respondToAction(
    input: ChatAdapterRespondToActionInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<void, TelegramActionResponseError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      operation: "respondToAction",
      conversationId: input.conversationId,
      messageId: input.message.messageId,
      interactionId: input.interactionId,
      responseKind: input.response.kind,
    } as const;
    this.logger.debug(telegramLogEvents.outboundBegin, metadata);
    const result = await handleRespondToAction({ bot: this.bot, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.outboundSuccess,
      failureEvent: telegramLogEvents.outboundFailure,
    });
    return result;
  }

  async reply(
    input: ChatAdapterReplyInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramReplyError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundMessageMetadata("reply", input),
      messageId: input.message?.messageId,
      mode: input.mode,
    } as const;
    this.logger.debug(telegramLogEvents.outboundBegin, metadata);
    const result = await handleReply({ chatId: this.id, bot: this.bot, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.outboundSuccess,
      failureEvent: telegramLogEvents.outboundFailure,
    });
    return result;
  }

  async sendTyping(
    input: ChatAdapterSendTypingInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<void, TelegramSendTypingError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      operation: "sendTyping",
      conversationId: input.conversationId,
      messageId: input.message?.messageId,
      action: input.action,
    } as const;
    this.logger.debug(telegramLogEvents.outboundBegin, metadata);
    const result = await handleSendTyping({ bot: this.bot, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.outboundSuccess,
      failureEvent: telegramLogEvents.outboundFailure,
    });
    return result;
  }

  async streamMessage(
    input: ChatAdapterStreamMessageInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramStreamMessageError>> {
    const startedAt = startChatLogTimer();
    const metadata = outboundStreamMetadata("streamMessage", input);
    this.logger.debug(telegramLogEvents.outboundBegin, metadata);
    const result = await handleStreamMessage({ chatId: this.id, bot: this.bot, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.outboundSuccess,
      failureEvent: telegramLogEvents.outboundFailure,
    });
    return result;
  }

  async streamReply(
    input: ChatAdapterStreamReplyInput<TChatId, TelegramAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramStreamReplyError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundStreamMetadata("streamReply", input),
      messageId: input.message?.messageId,
      mode: input.mode,
    } as const;
    this.logger.debug(telegramLogEvents.outboundBegin, metadata);
    const result = await handleStreamReply({ chatId: this.id, bot: this.bot, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.outboundSuccess,
      failureEvent: telegramLogEvents.outboundFailure,
    });
    return result;
  }

  async close(): Promise<void> {
    const startedAt = startChatLogTimer();
    const metadata = { operation: "close", lifecycleStatus: this.#state.status } as const;

    this.logger.debug(telegramLogEvents.closeBegin, metadata);

    if (this.#state.status === "closed") {
      logChatResult({
        logger: this.logger,
        result: Result.ok<void, never>(undefined),
        startedAt,
        metadata: { ...metadata, result: "ignored" },
        successEvent: telegramLogEvents.closeSuccess,
        failureEvent: telegramLogEvents.closeFailure,
      });
      return;
    }

    const previousState = this.#state;
    this.#state = { status: "closed" };

    if (previousState.status === "started") {
      previousState.removeAbortListener?.();
    }

    const stopped = await Result.tryPromise({
      try: async () => {
        if (this.bot.isRunning()) {
          await this.bot.stop();
        }
      },
      catch: (cause) => cause,
    });

    logChatResult({
      logger: this.logger,
      result: stopped,
      startedAt,
      metadata,
      successEvent: telegramLogEvents.closeSuccess,
      failureEvent: telegramLogEvents.closeFailure,
      failureLevel: "error",
    });

    if (stopped.isErr()) {
      throw stopped.error;
    }
  }
}

function outboundMessageMetadata(
  operation: string,
  input: ChatAdapterSendMessageInput<string, TelegramAdapterOptions>,
) {
  return {
    operation,
    conversationId: input.conversationId,
    textLength: input.text.length,
    format: input.format,
  } as const;
}

function outboundStreamMetadata(
  operation: string,
  input: ChatAdapterStreamMessageInput<string, TelegramAdapterOptions>,
) {
  return {
    operation,
    conversationId: input.conversationId,
    format: input.content.format,
  } as const;
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
