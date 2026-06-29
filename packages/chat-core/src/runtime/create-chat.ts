import { Result } from "better-result";
import type { ChatActionRegistry } from "../registry/actions";
import type {
  AdapterDataByChatId,
  AdapterErrorByChatId,
  AdapterOptionsByChatId,
  AdapterCapabilitiesFor,
  AdapterDataFor,
  AdapterErrorFor,
  AdapterOptionsFor,
  ChatAdapterDefinitions,
} from "../adapter/registry";
import type { OpenedChatAdapter } from "../adapter/definition";
import type { ChatAdapterStartContext } from "../adapter/io";
import type { ChatCommandRegistry } from "../registry/commands";
import type {
  ChatAdapterObject,
  ChatButton,
  ChatReplyMode,
  ChatMessage,
  ChatStreamFallback,
  ChatTextInput,
  ChatTextStreamContent,
} from "../contracts";
import {
  ChatAdapterOpenError,
  ChatAdapterStartError,
  ChatCloseError,
  UnknownChatAdapterError,
  type ChatCloseFailure,
  type ChatLifecycleError,
  type ChatInjectCommandFailure,
  type ChatInjectMessageFailure,
  type ChatReplyFailure,
  type ChatSendActionFailure,
  type ChatSendMessageFailure,
  type ChatStartError,
  type ChatStreamMessageFailure,
  type ChatStreamReplyFailure,
  type ChatTypingIndicatorFailure,
  type ChatUpdateActionFailure,
} from "../errors";
import type {
  ChatAdapterActionEvent,
  ChatAdapterCommandEvent,
  ChatAdapterInvalidCommandEvent,
  ChatAdapterMessageEventFor,
  ChatAdapterUnknownCommandEvent,
  ChatEvent,
  ChatEventTypingIndicatorOptions,
  ChatOn,
} from "../events/types";
import { createEventBus } from "../events/bus";
import { chatLogEvents, type ChatLogger } from "../logger";
import { createChatLogScope, logChatResult, startChatLogTimer } from "../logger-utils";
import type {
  ChatInjectCommandInput,
  ChatInjectMessageInput,
  ChatReplyInput,
  ChatSendActionInput,
  ChatSendMessageInput,
  ChatSentMessageFromInput,
  ChatStreamMessageInput,
  ChatStreamReplyInput,
  ChatTypingIndicatorInput,
  ChatTypingIndicatorResult,
  ChatUpdateActionInput,
} from "../inputs";
import { createReplyHandler } from "../handlers/reply";
import { createRespondToActionHandler } from "../handlers/respond-action";
import { createSendActionHandler } from "../handlers/send-action";
import { createSendMessageHandler } from "../handlers/send-message";
import { createStreamMessageHandler } from "../handlers/stream-message";
import { createStreamReplyHandler } from "../handlers/stream-reply";
import { createTypingIndicatorHandler } from "../handlers/typing-indicator";
import { createUpdateActionHandler } from "../handlers/update-action";
import type { ChatRuntimeOperation, OpenedRuntime } from "../handlers/types";
import { adapterForChatId } from "../handlers/adapter-inputs";
import { normalizeChatTextInput, openChatAdapter, startChatAdapter } from "../handlers/utils";
import {
  ensureCanClose,
  ensureCanStart,
  ensureStarted,
  initialChatLifecycleState,
  type ChatLifecycleState,
} from "../lifecycle";
import type { ChatId, EventResult, RuntimeAdapterEvent } from "./runtime-types";

/** Options for building the chat facade over registered adapters. */
export interface CreateChatOptions<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TCommands extends ChatCommandRegistry,
  TActions extends ChatActionRegistry = Record<never, never>,
> {
  readonly adapters: TAdapters;
  readonly commands: TCommands;
  readonly actions?: TActions;
  readonly logger?: ChatLogger;
}

/** Runtime facade for lifecycle and inbound chat events. */
export interface Chat<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TCommands extends ChatCommandRegistry,
  TActions extends ChatActionRegistry = Record<never, never>,
> {
  readonly chatIds: readonly ChatId<TAdapters>[];
  start(): Promise<Result<void, ChatStartError>>;
  close(): Promise<Result<void, ChatCloseFailure>>;
  readonly on: ChatOn<
    TCommands,
    TActions,
    ChatId<TAdapters>,
    EventResult<TAdapters>,
    AdapterDataByChatId<TAdapters>,
    AdapterOptionsByChatId<TAdapters>,
    AdapterErrorByChatId<TAdapters>
  >;
  sendMessage<TInput extends ChatSendMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>>;
  sendAction<TInput extends ChatSendActionInput<TAdapters, TActions>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendActionFailure>>;
  updateAction<TInput extends ChatUpdateActionInput<TAdapters, TActions>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatUpdateActionFailure>>;
  injectMessage<TInput extends ChatInjectMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<void, ChatInjectMessageFailure>>;
  injectCommand<TInput extends ChatInjectCommandInput<TAdapters, TCommands>>(
    input: TInput,
  ): Promise<Result<void, ChatInjectCommandFailure>>;
  reply<TInput extends ChatReplyInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatReplyFailure>>;
  streamMessage<TInput extends ChatStreamMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamMessageFailure>>;
  streamReply<TInput extends ChatStreamReplyInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamReplyFailure>>;
  typingIndicator<TInput extends ChatTypingIndicatorInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatTypingIndicatorResult<TInput>, ChatTypingIndicatorFailure>>;
}

/** Creates a typed chat runtime over the provided adapters and commands. */
export function createChat<
  const TAdapters extends ChatAdapterDefinitions<TAdapters>,
  const TCommands extends ChatCommandRegistry,
  const TActions extends ChatActionRegistry = Record<never, never>,
>(
  options: CreateChatOptions<TAdapters, TCommands, TActions>,
): Chat<TAdapters, TCommands, TActions> {
  type TChatId = ChatId<TAdapters>;
  type AdapterEvent = RuntimeAdapterEvent<TAdapters, TCommands>;
  type ActionAdapterEvent = ChatAdapterActionEvent<TChatId>;
  type ReplyableAdapterEvent =
    | ChatAdapterMessageEventFor<
        TChatId,
        AdapterDataByChatId<TAdapters>,
        AdapterErrorByChatId<TAdapters>
      >
    | ChatAdapterCommandEvent<TCommands, keyof TCommands, TChatId>
    | ChatAdapterInvalidCommandEvent<TChatId>
    | ChatAdapterUnknownCommandEvent<TChatId>;

  const chatIds = Object.freeze(Object.keys(options.adapters) as TChatId[]);
  const logger = createChatLogScope(options.logger, {
    component: "@xmux/chat-core",
    packageName: "@xmux/chat-core",
  });
  const openedRuntimes = new Map<string, OpenedRuntime>();
  const pendingStartupEvents: AdapterEvent[] = [];
  let lifecycle: ChatLifecycleState = initialChatLifecycleState;
  let abortController: AbortController | undefined;

  const bus = createEventBus({ logger });

  function bindEvent(event: AdapterEvent): ChatEvent {
    if (event.type === "action") {
      return bindActionEvent(event);
    }

    if (isReplyableEvent(event)) {
      return bindReplyableEvent(event);
    }

    return event;
  }

  function bindActionEvent(event: ActionAdapterEvent): ChatEvent {
    return {
      ...event,
      ack: (actionOptions?: {
        readonly text?: string;
        readonly showAlert?: boolean;
        readonly adapterOptions?: ChatAdapterObject;
      }) =>
        respondToAction({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          interactionId: event.interactionId,
          message: event.message,
          response: {
            kind: "ack",
            text: actionOptions?.text,
            showAlert: actionOptions?.showAlert,
          },
          adapterOptions: actionOptions?.adapterOptions,
        }),
      reply: (
        message: ChatTextInput,
        actionOptions?: { readonly adapterOptions?: ChatAdapterObject },
      ) =>
        respondToAction({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          interactionId: event.interactionId,
          message: event.message,
          response: { kind: "reply", message },
          adapterOptions: actionOptions?.adapterOptions,
        }),
      update: (actionOptions?: {
        readonly message?: ChatTextInput;
        readonly buttons?: readonly (readonly ChatButton[])[];
        readonly adapterOptions?: ChatAdapterObject;
      }) =>
        respondToAction({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          interactionId: event.interactionId,
          message: event.message,
          response: {
            kind: "update",
            message: actionOptions?.message,
            buttons: actionOptions?.buttons,
          },
          adapterOptions: actionOptions?.adapterOptions,
        }),
    } as ChatEvent;
  }

  function bindReplyableEvent(event: ReplyableAdapterEvent): ChatEvent {
    const messageId = event.type === "message" ? event.message.messageId : event.message?.messageId;

    return {
      ...event,
      reply: (
        message: ChatTextInput,
        replyOptions?: {
          readonly mode?: ChatReplyMode;
          readonly adapterOptions?: ChatAdapterObject;
        },
      ) => {
        const content = normalizeChatTextInput(message);
        return reply({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          messageId,
          text: content.text,
          format: content.format,
          mode: replyOptions?.mode,
          ...withProp("adapterOptions", replyOptions?.adapterOptions),
        } as ChatReplyInput<TAdapters>);
      },
      replyStream: (
        content: ChatTextStreamContent,
        replyOptions?: {
          readonly mode?: ChatReplyMode;
          readonly fallback?: ChatStreamFallback;
          readonly adapterOptions?: ChatAdapterObject;
        },
      ) =>
        streamReply({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          messageId,
          content,
          fallback: replyOptions?.fallback,
          mode: replyOptions?.mode,
          ...withProp("adapterOptions", replyOptions?.adapterOptions),
        } as ChatStreamReplyInput<TAdapters>),
      typingIndicator: (typingOptions?: ChatEventTypingIndicatorOptions<ChatAdapterObject>) =>
        typingIndicator({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          messageId,
          mode: typingOptions?.mode,
          timeoutMs:
            typingOptions !== undefined && "timeoutMs" in typingOptions
              ? typingOptions.timeoutMs
              : undefined,
          refreshIntervalMs:
            typingOptions !== undefined && "refreshIntervalMs" in typingOptions
              ? typingOptions.refreshIntervalMs
              : undefined,
          fallback: typingOptions?.fallback,
          signal: typingOptions?.signal,
          ...withProp("adapterOptions", typingOptions?.adapterOptions),
        } as ChatTypingIndicatorInput<TAdapters>),
    } as ChatEvent;
  }

  function isReplyableEvent(event: AdapterEvent): event is ReplyableAdapterEvent {
    return (
      event.type === "message" ||
      event.type === "command" ||
      event.type === "command.invalid" ||
      event.type === "command.unknown"
    );
  }

  function emit(event: AdapterEvent) {
    if (lifecycle.status === "starting" && event.type !== "error") {
      pendingStartupEvents.push(event);
      return;
    }
    bus.dispatch(bindEvent(event));
  }

  const on = bus.on as Chat<TAdapters, TCommands, TActions>["on"];

  async function getStartedRuntime<TId extends keyof TAdapters>(args: {
    readonly chatId: TId;
    readonly operation: ChatRuntimeOperation;
  }): Promise<
    Result<
      OpenedChatAdapter<
        Extract<TId, string>,
        AdapterOptionsFor<TAdapters, TId>,
        AdapterDataFor<TAdapters, TId>,
        AdapterCapabilitiesFor<TAdapters, TId>,
        AdapterErrorFor<TAdapters, TId>
      >,
      UnknownChatAdapterError | ChatLifecycleError
    >
  > {
    const key = args.chatId as string;
    if (!Object.hasOwn(options.adapters, key)) {
      return Result.err(new UnknownChatAdapterError({ chatId: key, availableChatIds: chatIds }));
    }

    return Result.andThen(ensureStarted({ state: lifecycle, operation: args.operation }), () => {
      const runtime = openedRuntimes.get(key);
      if (!runtime) {
        return Result.err(new UnknownChatAdapterError({ chatId: key, availableChatIds: chatIds }));
      }

      return Result.ok(
        runtime as OpenedChatAdapter<
          Extract<TId, string>,
          AdapterOptionsFor<TAdapters, TId>,
          AdapterDataFor<TAdapters, TId>,
          AdapterCapabilitiesFor<TAdapters, TId>,
          AdapterErrorFor<TAdapters, TId>
        >,
      );
    });
  }

  const sendMessage = createSendMessageHandler<TAdapters>({ getStartedRuntime, logger });
  const sendAction = createSendActionHandler<TAdapters, TActions>({ getStartedRuntime, logger });
  const updateAction = createUpdateActionHandler<TAdapters, TActions>({
    getStartedRuntime,
    logger,
  });
  const reply = createReplyHandler<TAdapters>({ getStartedRuntime, logger });
  const respondToAction = createRespondToActionHandler<TAdapters>({ getStartedRuntime, logger });
  const streamMessage = createStreamMessageHandler<TAdapters>({
    getStartedRuntime,
    sendMessage,
    logger,
  });
  const streamReply = createStreamReplyHandler<TAdapters>({ getStartedRuntime, reply, logger });
  const typingIndicator = createTypingIndicatorHandler<TAdapters>({
    getStartedRuntime,
    getLifecycleSignal: () => abortController?.signal,
    logger,
  });

  async function injectMessage<TInput extends ChatInjectMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<void, ChatInjectMessageFailure>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      chatId: String(input.chatId),
      operation: "injectMessage",
      conversationId: input.conversationId,
      messageId: input.messageId,
      textLength: input.text.length,
      format: input.format,
      attachmentCount: input.attachments?.length ?? 0,
    } as const;

    logger?.debug(chatLogEvents.operationBegin, metadata);

    const result = Result.andThen(
      await getStartedRuntime({ chatId: input.chatId, operation: "injectMessage" }),
      () => {
        const message: ChatMessage<string, ChatAdapterObject, unknown> = {
          chatId: input.chatId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          actor: input.actor,
          text: input.text,
          format: input.format,
          attachments: input.attachments ?? [],
          adapterData: input.adapterData,
        };

        emit({
          type: "message",
          chatId: input.chatId,
          conversation: { chatId: input.chatId, conversationId: input.conversationId },
          message,
        } as AdapterEvent);

        return Result.ok();
      },
    );

    logChatResult({
      logger,
      result,
      startedAt,
      metadata,
      successEvent: chatLogEvents.operationSuccess,
      failureEvent: chatLogEvents.operationFailure,
    });

    return result;
  }

  async function injectCommand<TInput extends ChatInjectCommandInput<TAdapters, TCommands>>(
    input: TInput,
  ): Promise<Result<void, ChatInjectCommandFailure>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      chatId: String(input.chatId),
      operation: "injectCommand",
      conversationId: input.conversationId,
      messageId: input.messageId,
      commandName: input.command.name,
    } as const;

    logger?.debug(chatLogEvents.operationBegin, metadata);

    const result = Result.andThen(
      await getStartedRuntime({ chatId: input.chatId, operation: "injectCommand" }),
      () => {
        emit({
          type: "command",
          chatId: input.chatId,
          conversation: { chatId: input.chatId, conversationId: input.conversationId },
          actor: input.actor,
          ...(input.messageId === undefined
            ? {}
            : {
                message: {
                  chatId: input.chatId,
                  conversationId: input.conversationId,
                  messageId: input.messageId,
                },
              }),
          command: input.command,
        } as AdapterEvent);

        return Result.ok();
      },
    );

    logChatResult({
      logger,
      result,
      startedAt,
      metadata,
      successEvent: chatLogEvents.operationSuccess,
      failureEvent: chatLogEvents.operationFailure,
    });

    return result;
  }

  async function startOneAdapter(
    chatId: TChatId,
  ): Promise<Result<TChatId, ChatAdapterOpenError | ChatAdapterStartError>> {
    return Result.gen(async function* () {
      const existing = openedRuntimes.get(chatId);
      const runtime = existing
        ? existing
        : yield* Result.await(
            openChatAdapter({
              adapter: adapterForChatId(options.adapters, chatId),
              chatId,
              signal: abortController?.signal,
              logger,
              adapterLogger: options.logger,
            }),
          );

      openedRuntimes.set(chatId, runtime);

      yield* Result.await(
        startChatAdapter({
          chatId,
          runtime,
          context: {
            commands: options.commands,
            emit: emit as ChatAdapterStartContext<
              TCommands,
              TChatId,
              ChatAdapterObject,
              unknown
            >["emit"],
            signal: abortController?.signal,
            logger: options.logger,
          },
          logger,
        }),
      );

      return Result.ok(chatId);
    });
  }

  async function start(): Promise<Result<void, ChatStartError>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      operation: "start",
      chatIds,
      lifecycleStatus: lifecycle.status,
    } as const;

    logger.debug(chatLogEvents.startBegin, metadata);

    const canStart = ensureCanStart(lifecycle);
    if (canStart.isErr()) {
      const result: Result<void, ChatStartError> = Result.err(canStart.error);
      logChatResult({
        logger,
        result,
        startedAt,
        metadata,
        successEvent: chatLogEvents.startSuccess,
        failureEvent: chatLogEvents.startFailure,
      });
      return result;
    }

    lifecycle = { status: "starting" };
    abortController = new AbortController();

    const startupResults = await Promise.all(chatIds.map(startOneAdapter));
    const [, startupErrors] = Result.partition(startupResults);
    const startupError = startupErrors[0];
    if (startupError !== undefined) return await failStart(startupError, startedAt, metadata);

    lifecycle = { status: "started" };
    for (const chatId of chatIds) {
      bus.dispatch({ type: "ready", chatId });
    }
    for (const event of pendingStartupEvents.splice(0)) {
      bus.dispatch(bindEvent(event));
    }

    const result: Result<void, ChatStartError> = Result.ok();
    logChatResult({
      logger,
      result,
      startedAt,
      metadata,
      successEvent: chatLogEvents.startSuccess,
      failureEvent: chatLogEvents.startFailure,
    });
    return result;
  }

  async function failStart(
    error: ChatAdapterOpenError | ChatAdapterStartError,
    startedAt: number,
    metadata: {
      readonly operation: "start";
      readonly chatIds: readonly TChatId[];
      readonly lifecycleStatus: string;
    },
  ): Promise<Result<void, ChatStartError>> {
    pendingStartupEvents.length = 0;
    await cleanupOpenedRuntimes();
    lifecycle = { status: "created" };
    const result: Result<void, ChatStartError> = Result.err(error);
    logChatResult({
      logger,
      result,
      startedAt,
      metadata,
      successEvent: chatLogEvents.startSuccess,
      failureEvent: chatLogEvents.startFailure,
    });
    return result;
  }

  async function closeRuntime(args: {
    readonly chatId: string;
    readonly runtime: OpenedRuntime;
    readonly reason?: "startup_cleanup";
    readonly failureLevel?: "error" | "warn";
    readonly emitClosed?: boolean;
  }): Promise<Result<void, { readonly chatId: string; readonly cause: unknown }>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      chatId: args.chatId,
      operation: "closeAdapter",
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    } as const;

    logger.debug(chatLogEvents.adapterCloseBegin, metadata);

    const result = await Result.tryPromise({
      try: async () => {
        try {
          await args.runtime.close();
        } finally {
          openedRuntimes.delete(args.chatId);
        }
        if (args.emitClosed === true) emit({ type: "closed", chatId: args.chatId as TChatId });
      },
      catch: (cause) => ({ chatId: args.chatId, cause }),
    });

    logChatResult({
      logger,
      result,
      startedAt,
      metadata,
      successEvent: chatLogEvents.adapterCloseSuccess,
      failureEvent: chatLogEvents.adapterCloseFailure,
      failureLevel: args.failureLevel,
    });

    return result;
  }

  async function cleanupOpenedRuntimes() {
    await Promise.all(
      [...openedRuntimes.entries()].map(([chatId, runtime]) =>
        closeRuntime({ chatId, runtime, reason: "startup_cleanup", failureLevel: "warn" }),
      ),
    );
  }

  async function close(): Promise<Result<void, ChatCloseFailure>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      operation: "close",
      chatIds,
      lifecycleStatus: lifecycle.status,
    } as const;

    logger.debug(chatLogEvents.closeBegin, metadata);

    const canClose = ensureCanClose(lifecycle);
    if (canClose.isErr()) {
      const result: Result<void, ChatCloseFailure> = Result.err(canClose.error);
      logChatResult({
        logger,
        result,
        startedAt,
        metadata,
        successEvent: chatLogEvents.closeSuccess,
        failureEvent: chatLogEvents.closeFailure,
      });
      return result;
    }

    lifecycle = { status: "closing" };
    abortController?.abort();

    const closeResults = await Promise.all(
      [...openedRuntimes.entries()].map(([chatId, runtime]) =>
        closeRuntime({ chatId, runtime, emitClosed: true }),
      ),
    );
    const [, failures] = Result.partition(closeResults);

    lifecycle = { status: "closed" };
    abortController = undefined;

    const result: Result<void, ChatCloseFailure> =
      failures.length === 0 ? Result.ok() : Result.err(new ChatCloseError({ failures }));

    logChatResult({
      logger,
      result,
      startedAt,
      metadata,
      successEvent: chatLogEvents.closeSuccess,
      failureEvent: chatLogEvents.closeFailure,
    });

    return result;
  }

  return {
    chatIds,
    start,
    close,
    on,
    sendMessage,
    sendAction,
    updateAction,
    injectMessage,
    injectCommand,
    reply,
    streamMessage,
    streamReply,
    typingIndicator,
  };
}

function withProp<K extends string, T>(key: K, value: T | undefined): { readonly [P in K]?: T } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: T };
}
