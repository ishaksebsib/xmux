import { Result } from "better-result";
import {
  serializeChatLogError,
  startChatLogTimer,
  type ChatAdapterReplyInput,
  type ChatAdapterRespondToActionInput,
  type ChatAdapterSendActionInput,
  type ChatAdapterSendMessageInput,
  type ChatAdapterSendTypingInput,
  type ChatAdapterStartContext,
  type ChatAdapterStreamMessageInput,
  type ChatAdapterStreamReplyInput,
  type ChatCommandRegistry,
  type ChatSentMessage,
  type OpenedChatAdapter,
} from "@xmux/chat-core";
import { discordAdapterCapabilities } from "./capabilities";
import {
  createDiscordBotClient,
  type CreateDiscordBotClient,
  type DiscordBotClient,
} from "./client";
import {
  normalizeDiscordMode,
  parseDiscordAdapterConfig,
  type DiscordAdapterConfig,
} from "./config";
import {
  createDiscordLogScope,
  logChatResult,
  discordLogEvents,
  type ChatLogger,
  type DiscordLogScope,
} from "./logger";
import {
  DiscordActionResponseError,
  type DiscordAdapterError,
  DiscordConfigurationError,
  DiscordReplyError,
  DiscordSendActionError,
  DiscordSendMessageError,
  DiscordSendTypingError,
  DiscordStreamMessageError,
  DiscordStreamReplyError,
  DiscordWebhookModeUnsupportedError,
} from "./errors";
import { registerInboundHandlers } from "./handlers/inbound";
import { registerCommands } from "./handlers/register-commands";
import { reply as handleReply } from "./handlers/reply";
import { sendMessage as handleSendMessage } from "./handlers/send-message";
import { sendTyping as handleSendTyping } from "./handlers/send-typing";
import { startGateway } from "./handlers/start-gateway";
import type {
  CreateDiscordAdapterOptions,
  DiscordAdapterData,
  DiscordAdapterOptions,
} from "./types";

type DiscordRuntimeState =
  | { readonly status: "opened" }
  | { readonly status: "started"; readonly removeAbortListener?: () => void }
  | { readonly status: "closed" };

type DiscordOpenedAdapter<TChatId extends string> = OpenedChatAdapter<
  TChatId,
  DiscordAdapterOptions,
  DiscordAdapterData,
  typeof discordAdapterCapabilities,
  DiscordAdapterError
>;

export function openDiscordRuntime<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly options: CreateDiscordAdapterOptions<TChatId>;
  readonly createClient?: CreateDiscordBotClient;
  readonly logger?: ChatLogger;
}): Result<DiscordOpenedAdapter<TChatId>, DiscordConfigurationError> {
  const logger = createDiscordLogScope({
    logger: args.logger,
    chatId: args.chatId,
    mode: normalizeDiscordMode(args.options.mode).type,
  });
  const startedAt = startChatLogTimer();
  const metadata = {
    operation: "open",
    mode: normalizeDiscordMode(args.options.mode).type,
  } as const;

  logger.debug(discordLogEvents.openBegin, metadata);

  const result = Result.gen(function* () {
    const config = yield* parseDiscordAdapterConfig(args.options);
    const client = yield* Result.try({
      try: () =>
        (args.createClient ?? createDiscordBotClient)({
          token: config.token,
          mode: config.mode,
          options: args.options.clientOptions,
        }),
      catch: (cause) => new DiscordConfigurationError({ field: "clientOptions", cause }),
    });

    return Result.ok(
      new DiscordRuntime({
        chatId: args.chatId,
        client,
        config,
        logger,
      }) satisfies DiscordOpenedAdapter<TChatId>,
    );
  });

  logChatResult({
    logger,
    result,
    startedAt,
    metadata,
    successEvent: discordLogEvents.openSuccess,
    failureEvent: discordLogEvents.openFailure,
  });

  return result;
}

class DiscordRuntime<TChatId extends string> implements DiscordOpenedAdapter<TChatId> {
  readonly capabilities = discordAdapterCapabilities;
  readonly id: TChatId;

  #state: DiscordRuntimeState = { status: "opened" };

  constructor(args: {
    readonly chatId: TChatId;
    readonly client: DiscordBotClient;
    readonly config: DiscordAdapterConfig;
    readonly logger: DiscordLogScope;
  }) {
    this.id = args.chatId;
    this.client = args.client;
    this.config = args.config;
    this.logger = args.logger;
  }

  private readonly client: DiscordBotClient;
  private readonly config: DiscordAdapterConfig;
  private readonly logger: DiscordLogScope;

  async start<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, DiscordAdapterData, DiscordAdapterError>,
  ): Promise<Result<void, DiscordAdapterError>> {
    const startedAt = startChatLogTimer();
    const metadata = { operation: "start", mode: this.config.mode.type } as const;

    this.logger.debug(discordLogEvents.startBegin, metadata);

    if (this.#state.status === "closed" || this.#state.status === "started") {
      const result = Result.ok<void, never>(undefined);
      logChatResult({
        logger: this.logger,
        result,
        startedAt,
        metadata: { ...metadata, result: "ignored", lifecycleStatus: this.#state.status },
        successEvent: discordLogEvents.startSuccess,
        failureEvent: discordLogEvents.startFailure,
      });
      return result;
    }

    if (this.config.mode.type === "webhook") {
      const result: Result<void, DiscordAdapterError> = Result.err(
        new DiscordWebhookModeUnsupportedError(),
      );
      logChatResult({
        logger: this.logger,
        result,
        startedAt,
        metadata,
        successEvent: discordLogEvents.startSuccess,
        failureEvent: discordLogEvents.startFailure,
      });
      return result;
    }

    this.registerGatewayLifecycleHandlers(context);
    registerInboundHandlers({
      chatId: this.id,
      client: this.client,
      context,
      logger: this.logger,
      mode: this.config.mode,
    });

    const started = await Result.gen(async function* () {
      const commandCount = Object.keys(context.commands).length;
      const commandsStartedAt = startChatLogTimer();
      const commandsMetadata = {
        operation: "registerCommands",
        commandCount,
        scope: this.config.commandRegistration.scope.type,
      } as const;

      this.logger.debug(discordLogEvents.commandsRegisterBegin, commandsMetadata);
      const registered = await registerCommands({
        client: this.client,
        applicationId: this.config.applicationId,
        registration: this.config.commandRegistration,
        commands: context.commands,
        logger: this.logger,
        signal: context.signal,
      });
      logChatResult({
        logger: this.logger,
        result: registered,
        startedAt: commandsStartedAt,
        metadata: commandsMetadata,
        successEvent: discordLogEvents.commandsRegisterSuccess,
        failureEvent: discordLogEvents.commandsRegisterFailure,
      });
      yield* registered;

      yield* Result.await(startGateway({ client: this.client, token: this.config.token }));
      return Result.ok<void, never>(undefined);
    }, this);

    if (started.isErr()) {
      logChatResult({
        logger: this.logger,
        result: started,
        startedAt,
        metadata,
        successEvent: discordLogEvents.startSuccess,
        failureEvent: discordLogEvents.startFailure,
      });
      return Result.err(started.error);
    }

    this.#state = { status: "started" };

    const removeAbortListener = bindAbortSignal({
      signal: context.signal,
      abort: () => {
        void this.close().catch((error: unknown) => {
          this.logger.error(discordLogEvents.backgroundFailure, {
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
      successEvent: discordLogEvents.startSuccess,
      failureEvent: discordLogEvents.startFailure,
    });
    return result;
  }

  async sendMessage(
    input: ChatAdapterSendMessageInput<TChatId, DiscordAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordSendMessageError>> {
    const startedAt = startChatLogTimer();
    const metadata = outboundMessageMetadata("sendMessage", input);
    this.logger.debug(discordLogEvents.outboundBegin, metadata);
    const result = await handleSendMessage({
      chatId: this.id,
      client: this.client,
      config: this.config,
      input,
    });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: discordLogEvents.outboundSuccess,
      failureEvent: discordLogEvents.outboundFailure,
    });
    return result;
  }

  async sendAction(
    _input: ChatAdapterSendActionInput<TChatId, DiscordAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordSendActionError>> {
    return Result.err(
      new DiscordSendActionError({
        reason: "Discord sendAction is not implemented yet. This operation is planned for Phase 5.",
      }),
    );
  }

  async respondToAction(
    _input: ChatAdapterRespondToActionInput<TChatId, DiscordAdapterOptions>,
  ): Promise<Result<void, DiscordActionResponseError>> {
    return Result.err(
      new DiscordActionResponseError({
        reason:
          "Discord action responses are not implemented yet. This operation is planned for Phase 5.",
      }),
    );
  }

  async reply(
    input: ChatAdapterReplyInput<TChatId, DiscordAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordReplyError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundMessageMetadata("reply", input),
      messageId: input.message?.messageId,
      mode: input.mode,
    } as const;
    this.logger.debug(discordLogEvents.outboundBegin, metadata);
    const result = await handleReply({
      chatId: this.id,
      client: this.client,
      config: this.config,
      input,
    });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: discordLogEvents.outboundSuccess,
      failureEvent: discordLogEvents.outboundFailure,
    });
    return result;
  }

  async sendTyping(
    input: ChatAdapterSendTypingInput<TChatId, DiscordAdapterOptions>,
  ): Promise<Result<void, DiscordSendTypingError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      operation: "sendTyping",
      conversationId: input.conversationId,
      messageId: input.message?.messageId,
      action: input.action,
    } as const;
    this.logger.debug(discordLogEvents.outboundBegin, metadata);
    const result = await handleSendTyping({ client: this.client, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: discordLogEvents.outboundSuccess,
      failureEvent: discordLogEvents.outboundFailure,
    });
    return result;
  }

  async streamMessage(
    _input: ChatAdapterStreamMessageInput<TChatId, DiscordAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordStreamMessageError>> {
    return Result.err(
      new DiscordStreamMessageError({
        reason:
          "Discord streamMessage is not implemented yet. This operation is planned for Phase 7.",
      }),
    );
  }

  async streamReply(
    _input: ChatAdapterStreamReplyInput<TChatId, DiscordAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordStreamReplyError>> {
    return Result.err(
      new DiscordStreamReplyError({
        reason:
          "Discord streamReply is not implemented yet. This operation is planned for Phase 7.",
      }),
    );
  }

  async close(): Promise<void> {
    const startedAt = startChatLogTimer();
    const metadata = { operation: "close", lifecycleStatus: this.#state.status } as const;

    this.logger.debug(discordLogEvents.closeBegin, metadata);

    if (this.#state.status === "closed") {
      logChatResult({
        logger: this.logger,
        result: Result.ok<void, never>(undefined),
        startedAt,
        metadata: { ...metadata, result: "ignored" },
        successEvent: discordLogEvents.closeSuccess,
        failureEvent: discordLogEvents.closeFailure,
      });
      return;
    }

    const previousState = this.#state;
    this.#state = { status: "closed" };

    if (previousState.status === "started") {
      previousState.removeAbortListener?.();
    }

    const destroyed = Result.try({
      try: () => this.client.destroy(),
      catch: (cause) => cause,
    });

    logChatResult({
      logger: this.logger,
      result: destroyed,
      startedAt,
      metadata,
      successEvent: discordLogEvents.closeSuccess,
      failureEvent: discordLogEvents.closeFailure,
      failureLevel: "error",
    });

    if (destroyed.isErr()) {
      throw destroyed.error;
    }
  }

  private registerGatewayLifecycleHandlers<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, DiscordAdapterData, DiscordAdapterError>,
  ): void {
    this.client.onReady((info) => {
      this.logger.debug(discordLogEvents.gatewayReady, {
        operation: "gatewayReady",
        botUserId: info.userId,
        username: info.username,
      });
    });

    this.client.onError((error) => {
      this.logger.error(discordLogEvents.gatewayFailure, {
        operation: "gateway",
        error: serializeChatLogError(error),
      });
      context.emit({ type: "error", chatId: this.id, error });
    });
  }
}

function outboundMessageMetadata(
  operation: string,
  input: ChatAdapterSendMessageInput<string, DiscordAdapterOptions>,
) {
  return {
    operation,
    conversationId: input.conversationId,
    textLength: input.text.length,
    format: input.format,
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
