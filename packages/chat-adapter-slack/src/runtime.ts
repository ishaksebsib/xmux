import { Result } from "better-result";
import {
  serializeChatLogError,
  startChatLogTimer,
  type ChatAdapterReplyInput,
  type ChatAdapterRespondToActionInput,
  type ChatAdapterSendActionInput,
  type ChatAdapterSendMessageInput,
  type ChatAdapterStartContext,
  type ChatAdapterUpdateActionInput,
  type ChatAdapterStreamMessageInput,
  type ChatAdapterStreamReplyInput,
  type ChatCommandRegistry,
  type ChatSentMessage,
  type OpenedChatAdapter,
} from "@xmux/chat-core";
import { slackAdapterCapabilities } from "./capabilities";
import { createSlackBotClient, type CreateSlackBotClient, type SlackBotClient } from "./client";
import { createSlackCommandRegistration } from "./commands";
import { normalizeSlackMode, parseSlackAdapterConfig, type SlackAdapterConfig } from "./config";
import {
  SlackActionResponseError,
  type SlackAdapterError,
  SlackConfigurationError,
  SlackHttpModeUnsupportedError,
  SlackReplyError,
  SlackSendActionError,
  SlackSendMessageError,
  SlackStreamMessageError,
  SlackStreamReplyError,
  SlackUpdateActionError,
} from "./errors";
import { registerInboundHandlers } from "./handlers/inbound";
import { reply as handleReply } from "./handlers/reply";
import { respondToAction as handleRespondToAction } from "./handlers/respond-action";
import { sendAction as handleSendAction } from "./handlers/send-action";
import { sendMessage as handleSendMessage } from "./handlers/send-message";
import { startSocket } from "./handlers/start-socket";
import { updateAction as handleUpdateAction } from "./handlers/update-action";
import { streamMessage as handleStreamMessage } from "./handlers/stream-message";
import { streamReply as handleStreamReply } from "./handlers/stream-reply";
import {
  createSlackLogScope,
  logChatResult,
  slackLogEvents,
  type ChatLogger,
  type SlackLogScope,
} from "./logger";
import {
  createSlackInteractionRegistry,
  type SlackInteractionRegistry,
} from "./stores/interaction-registry";
import {
  createSlackStreamSourceRegistry,
  type SlackStreamSourceRegistry,
} from "./stores/stream-source-registry";
import type { CreateSlackAdapterOptions, SlackAdapterData, SlackAdapterOptions } from "./types";

type SlackRuntimeState =
  | { readonly status: "opened" }
  | { readonly status: "started"; readonly removeAbortListener?: () => void }
  | { readonly status: "closed" };

type SlackOpenedAdapter<TChatId extends string> = OpenedChatAdapter<
  TChatId,
  SlackAdapterOptions,
  SlackAdapterData,
  typeof slackAdapterCapabilities,
  SlackAdapterError
>;

export function openSlackRuntime<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly options: CreateSlackAdapterOptions<TChatId>;
  readonly createClient?: CreateSlackBotClient;
  readonly logger?: ChatLogger;
}): Result<SlackOpenedAdapter<TChatId>, SlackAdapterError> {
  const mode = normalizeSlackMode(args.options.mode);
  const logger = createSlackLogScope({
    logger: args.logger,
    chatId: args.chatId,
    mode: mode.type,
  });
  const startedAt = startChatLogTimer();
  const metadata = { operation: "open", mode: mode.type } as const;

  logger.debug(slackLogEvents.openBegin, metadata);

  const result = Result.gen(function* () {
    const config = yield* parseSlackAdapterConfig(args.options);
    const client = yield* Result.try({
      try: () =>
        (args.createClient ?? createSlackBotClient)({
          botToken: config.botToken,
          mode: config.mode,
          options: args.options.clientOptions,
        }),
      catch: (cause) => new SlackConfigurationError({ field: "clientOptions", cause }),
    });

    return Result.ok(
      new SlackRuntime({
        chatId: args.chatId,
        client,
        config,
        interactionRegistry: createSlackInteractionRegistry(),
        logger,
        streamSourceRegistry: createSlackStreamSourceRegistry(),
      }) satisfies SlackOpenedAdapter<TChatId>,
    );
  });

  logChatResult({
    logger,
    result,
    startedAt,
    metadata,
    successEvent: slackLogEvents.openSuccess,
    failureEvent: slackLogEvents.openFailure,
  });

  return result;
}

class SlackRuntime<TChatId extends string> implements SlackOpenedAdapter<TChatId> {
  readonly capabilities = slackAdapterCapabilities;
  readonly id: TChatId;

  #state: SlackRuntimeState = { status: "opened" };
  #startAttempted = false;

  constructor(args: {
    readonly chatId: TChatId;
    readonly client: SlackBotClient;
    readonly config: SlackAdapterConfig;
    readonly interactionRegistry: SlackInteractionRegistry;
    readonly logger: SlackLogScope;
    readonly streamSourceRegistry: SlackStreamSourceRegistry;
  }) {
    this.id = args.chatId;
    this.client = args.client;
    this.config = args.config;
    this.interactionRegistry = args.interactionRegistry;
    this.logger = args.logger;
    this.streamSourceRegistry = args.streamSourceRegistry;
  }

  private readonly client: SlackBotClient;
  private readonly config: SlackAdapterConfig;
  private readonly interactionRegistry: SlackInteractionRegistry;
  private readonly logger: SlackLogScope;
  private readonly streamSourceRegistry: SlackStreamSourceRegistry;

  async start<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, SlackAdapterData, SlackAdapterError>,
  ): Promise<Result<void, SlackAdapterError>> {
    const startedAt = startChatLogTimer();
    const metadata = { operation: "start", mode: this.config.mode.type } as const;

    this.logger.debug(slackLogEvents.startBegin, metadata);

    if (this.#state.status === "closed" || this.#state.status === "started") {
      const result = Result.ok<void, never>(undefined);
      logChatResult({
        logger: this.logger,
        result,
        startedAt,
        metadata: { ...metadata, result: "ignored", lifecycleStatus: this.#state.status },
        successEvent: slackLogEvents.startSuccess,
        failureEvent: slackLogEvents.startFailure,
      });
      return result;
    }

    if (this.config.mode.type === "http") {
      const result: Result<void, SlackAdapterError> = Result.err(
        new SlackHttpModeUnsupportedError(),
      );
      logChatResult({
        logger: this.logger,
        result,
        startedAt,
        metadata,
        successEvent: slackLogEvents.startSuccess,
        failureEvent: slackLogEvents.startFailure,
      });
      return result;
    }

    const botIdentity = await this.loadBotIdentity(context);

    this.registerSocketLifecycleHandlers(context);
    registerInboundHandlers({
      chatId: this.id,
      client: this.client,
      commandMode: this.config.commandMode,
      mentionCommands: this.config.mentionCommands,
      conversationScope: this.config.conversationScope,
      actionStore: this.config.actionStore,
      botIdentity,
      context,
      interactionRegistry: this.interactionRegistry,
      logger: this.logger,
      streamSourceRegistry: this.streamSourceRegistry,
    });
    createSlackCommandRegistration({
      commands: context.commands,
      commandMode: this.config.commandMode,
      logger: this.logger,
    });

    this.#startAttempted = true;
    const started = await startSocket({ client: this.client });
    if (started.isErr()) {
      logChatResult({
        logger: this.logger,
        result: started,
        startedAt,
        metadata,
        successEvent: slackLogEvents.startSuccess,
        failureEvent: slackLogEvents.startFailure,
      });
      return Result.err(started.error);
    }

    this.#state = { status: "started" };

    const removeAbortListener = bindAbortSignal({
      signal: context.signal,
      abort: () => {
        void this.close().catch((error: unknown) => {
          this.logger.error(slackLogEvents.backgroundFailure, {
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
      successEvent: slackLogEvents.startSuccess,
      failureEvent: slackLogEvents.startFailure,
    });
    return result;
  }

  async sendMessage(
    input: ChatAdapterSendMessageInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackSendMessageError>> {
    const startedAt = startChatLogTimer();
    const metadata = outboundMessageMetadata("sendMessage", input);
    this.logger.debug(slackLogEvents.outboundBegin, metadata);
    const result = await handleSendMessage({ chatId: this.id, client: this.client, input });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: slackLogEvents.outboundSuccess,
      failureEvent: slackLogEvents.outboundFailure,
    });
    return result;
  }

  async sendAction(
    input: ChatAdapterSendActionInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackSendActionError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundMessageMetadata("sendAction", input),
      buttonRows: input.buttons.length,
      buttonCount: input.buttons.reduce((count, row) => count + row.length, 0),
    } as const;
    this.logger.debug(slackLogEvents.outboundBegin, metadata);
    const result = await handleSendAction({
      chatId: this.id,
      client: this.client,
      config: this.config,
      input,
      streamSourceRegistry: this.streamSourceRegistry,
    });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: slackLogEvents.outboundSuccess,
      failureEvent: slackLogEvents.outboundFailure,
    });
    return result;
  }

  async updateAction(
    input: ChatAdapterUpdateActionInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackUpdateActionError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundMessageMetadata("updateAction", input),
      messageId: input.message.messageId,
      buttonRows: input.buttons.length,
      buttonCount: input.buttons.reduce((count, row) => count + row.length, 0),
    } as const;
    this.logger.debug(slackLogEvents.outboundBegin, metadata);
    const result = await handleUpdateAction({
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
      successEvent: slackLogEvents.outboundSuccess,
      failureEvent: slackLogEvents.outboundFailure,
    });
    return result;
  }

  async respondToAction(
    input: ChatAdapterRespondToActionInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<void, SlackActionResponseError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      operation: "respondToAction",
      conversationId: input.conversationId,
      messageId: input.message.messageId,
      interactionId: input.interactionId,
      responseKind: input.response.kind,
    } as const;
    this.logger.debug(slackLogEvents.outboundBegin, metadata);
    const result = await handleRespondToAction({
      client: this.client,
      config: this.config,
      interactionRegistry: this.interactionRegistry,
      input,
    });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: slackLogEvents.outboundSuccess,
      failureEvent: slackLogEvents.outboundFailure,
    });
    return result;
  }

  async reply(
    input: ChatAdapterReplyInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackReplyError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundMessageMetadata("reply", input),
      messageId: input.message?.messageId,
      mode: input.mode,
    } as const;
    this.logger.debug(slackLogEvents.outboundBegin, metadata);
    const result = await handleReply({
      chatId: this.id,
      client: this.client,
      input,
      streamSourceRegistry: this.streamSourceRegistry,
    });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: slackLogEvents.outboundSuccess,
      failureEvent: slackLogEvents.outboundFailure,
    });
    return result;
  }

  async streamMessage(
    input: ChatAdapterStreamMessageInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackStreamMessageError>> {
    const startedAt = startChatLogTimer();
    const metadata = outboundStreamMetadata("streamMessage", input);
    this.logger.debug(slackLogEvents.outboundBegin, metadata);
    const result = await handleStreamMessage({
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
      successEvent: slackLogEvents.outboundSuccess,
      failureEvent: slackLogEvents.outboundFailure,
    });
    return result;
  }

  async streamReply(
    input: ChatAdapterStreamReplyInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackStreamReplyError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      ...outboundStreamMetadata("streamReply", input),
      messageId: input.message?.messageId,
      mode: input.mode,
    } as const;
    this.logger.debug(slackLogEvents.outboundBegin, metadata);
    const result = await handleStreamReply({
      chatId: this.id,
      client: this.client,
      config: this.config,
      input,
      streamSourceRegistry: this.streamSourceRegistry,
    });
    logChatResult({
      logger: this.logger,
      result,
      startedAt,
      metadata,
      successEvent: slackLogEvents.outboundSuccess,
      failureEvent: slackLogEvents.outboundFailure,
    });
    return result;
  }

  async close(): Promise<void> {
    const startedAt = startChatLogTimer();
    const metadata = { operation: "close", lifecycleStatus: this.#state.status } as const;

    this.logger.debug(slackLogEvents.closeBegin, metadata);

    if (this.#state.status === "closed") {
      logChatResult({
        logger: this.logger,
        result: Result.ok<void, never>(undefined),
        startedAt,
        metadata: { ...metadata, result: "ignored" },
        successEvent: slackLogEvents.closeSuccess,
        failureEvent: slackLogEvents.closeFailure,
      });
      return;
    }

    const previousState = this.#state;
    this.#state = { status: "closed" };

    if (previousState.status === "started") {
      previousState.removeAbortListener?.();
    }

    const shouldStop = previousState.status === "started" || this.#startAttempted;
    const stopped = shouldStop
      ? await Result.tryPromise({
          try: async () => this.client.stop(),
          catch: (cause) => cause,
        })
      : Result.ok<void, never>(undefined);

    logChatResult({
      logger: this.logger,
      result: stopped,
      startedAt,
      metadata,
      successEvent: slackLogEvents.closeSuccess,
      failureEvent: slackLogEvents.closeFailure,
      failureLevel: "error",
    });

    if (stopped.isErr()) {
      throw stopped.error;
    }
  }

  private async loadBotIdentity<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, SlackAdapterData, SlackAdapterError>,
  ) {
    const result = await Result.tryPromise({
      try: () => this.client.getBotIdentity(),
      catch: (cause) => cause,
    });

    if (result.isOk()) {
      return result.value;
    }

    this.logger.warn(slackLogEvents.inboundIgnored, {
      operation: "auth.test",
      reason: "bot_identity_unavailable",
      error: serializeChatLogError(result.error),
    });
    context.emit({ type: "error", chatId: this.id, error: result.error });
    return undefined;
  }

  private registerSocketLifecycleHandlers<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, SlackAdapterData, SlackAdapterError>,
  ): void {
    this.client.onError((error) => {
      this.logger.error(slackLogEvents.socketFailure, {
        operation: "socket",
        error: serializeChatLogError(error),
      });
      context.emit({ type: "error", chatId: this.id, error });
    });
  }
}

function outboundMessageMetadata(
  operation: string,
  input: ChatAdapterSendMessageInput<string, SlackAdapterOptions>,
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
  input: ChatAdapterStreamMessageInput<string, SlackAdapterOptions>,
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
