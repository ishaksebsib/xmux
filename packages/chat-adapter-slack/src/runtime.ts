import { Result } from "better-result";
import {
  startChatLogTimer,
  type ChatAdapterReplyInput,
  type ChatAdapterRespondToActionInput,
  type ChatAdapterSendActionInput,
  type ChatAdapterSendMessageInput,
  type ChatAdapterStartContext,
  type ChatAdapterStreamMessageInput,
  type ChatAdapterStreamReplyInput,
  type ChatCommandRegistry,
  type ChatSentMessage,
  type OpenedChatAdapter,
} from "@xmux/chat-core";
import { slackAdapterCapabilities } from "./capabilities";
import { normalizeSlackMode, parseSlackAdapterConfig, type SlackAdapterConfig } from "./config";
import {
  SlackActionResponseError,
  type SlackAdapterError,
  SlackHttpModeUnsupportedError,
  SlackReplyError,
  SlackSendActionError,
  SlackSendMessageError,
  SlackStartError,
  SlackStreamMessageError,
  SlackStreamReplyError,
} from "./errors";
import {
  createSlackLogScope,
  logChatResult,
  slackLogEvents,
  type ChatLogger,
  type SlackLogScope,
} from "./logger";
import type { CreateSlackAdapterOptions, SlackAdapterData, SlackAdapterOptions } from "./types";

type SlackRuntimeState = "opened" | "closed";

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

  const result = Result.map(
    parseSlackAdapterConfig(args.options),
    (config) =>
      new SlackRuntime({
        chatId: args.chatId,
        config,
        logger,
      }) satisfies SlackOpenedAdapter<TChatId>,
  );

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

  #state: SlackRuntimeState = "opened";

  constructor(args: {
    readonly chatId: TChatId;
    readonly config: SlackAdapterConfig;
    readonly logger: SlackLogScope;
  }) {
    this.id = args.chatId;
    this.config = args.config;
    this.logger = args.logger;
  }

  private readonly config: SlackAdapterConfig;
  private readonly logger: SlackLogScope;

  async start<TCommands extends ChatCommandRegistry>(
    _context: ChatAdapterStartContext<TCommands, TChatId, SlackAdapterData, SlackAdapterError>,
  ): Promise<Result<void, SlackAdapterError>> {
    const startedAt = startChatLogTimer();
    const metadata = { operation: "start", mode: this.config.mode.type } as const;

    this.logger.debug(slackLogEvents.startBegin, metadata);

    const result: Result<void, SlackAdapterError> = Result.err(
      this.config.mode.type === "http"
        ? new SlackHttpModeUnsupportedError()
        : new SlackStartError({
            operation: "socket_mode",
            reason: "Slack Socket Mode runtime is not implemented until phase 2",
          }),
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

  async sendMessage(
    _input: ChatAdapterSendMessageInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackSendMessageError>> {
    return Result.err(new SlackSendMessageError({ reason: phaseNotImplemented("sendMessage", 3) }));
  }

  async sendAction(
    _input: ChatAdapterSendActionInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackSendActionError>> {
    return Result.err(new SlackSendActionError({ reason: phaseNotImplemented("sendAction", 6) }));
  }

  async respondToAction(
    _input: ChatAdapterRespondToActionInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<void, SlackActionResponseError>> {
    return Result.err(
      new SlackActionResponseError({ reason: phaseNotImplemented("respondToAction", 6) }),
    );
  }

  async reply(
    _input: ChatAdapterReplyInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackReplyError>> {
    return Result.err(new SlackReplyError({ reason: phaseNotImplemented("reply", 3) }));
  }

  async streamMessage(
    _input: ChatAdapterStreamMessageInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackStreamMessageError>> {
    return Result.err(
      new SlackStreamMessageError({ reason: phaseNotImplemented("streamMessage", 7) }),
    );
  }

  async streamReply(
    _input: ChatAdapterStreamReplyInput<TChatId, SlackAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackStreamReplyError>> {
    return Result.err(new SlackStreamReplyError({ reason: phaseNotImplemented("streamReply", 7) }));
  }

  async close(): Promise<void> {
    const startedAt = startChatLogTimer();
    const metadata = { operation: "close", lifecycleStatus: this.#state } as const;

    this.logger.debug(slackLogEvents.closeBegin, metadata);

    if (this.#state === "closed") {
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

    this.#state = "closed";

    logChatResult({
      logger: this.logger,
      result: Result.ok<void, never>(undefined),
      startedAt,
      metadata,
      successEvent: slackLogEvents.closeSuccess,
      failureEvent: slackLogEvents.closeFailure,
    });
  }
}

function phaseNotImplemented(operation: string, phase: number): string {
  return `Slack ${operation} is not implemented until phase ${phase}`;
}
