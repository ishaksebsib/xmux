import { Result } from "better-result";
import type { ChatAdapterStartContext, OpenedChatAdapter } from "./adapter";
import type {
  ChatAdapterObject,
  ChatStreamFallback,
  ChatTextInput,
  ChatTextStreamContent,
} from "./contracts";
import type { ChatCommandRegistry } from "./commands";
import type {
  AdapterDataByChatId,
  AdapterDataFor,
  AdapterOptionsByChatId,
  AdapterOptionsFor,
  ChatAdapterDefinitions,
  ChatEventAdapterData,
  ChatEventAdapterOptions,
  ChatReplyInput,
  ChatReplyMode,
  ChatSendMessageInput,
  ChatSentMessageFromInput,
  ChatStreamMessageInput,
  ChatStreamReplyInput,
  ChatTypingIndicatorInput,
  ChatTypingIndicatorResult,
} from "./types";
import type {
  ChatAdapterEvent,
  ChatCommandEvent,
  ChatEvent,
  ChatEventHandler,
  ChatEventType,
  ChatEventTypingIndicatorOptions,
  ChatOn,
  Unsubscribe,
} from "./events";
import {
  ChatAdapterOpenError,
  ChatCloseError,
  UnknownChatAdapterError,
  type ChatCloseFailure,
  type ChatLifecycleError,
  type ChatReplyFailure,
  type ChatSendMessageFailure,
  type ChatStartError,
  type ChatStreamMessageFailure,
  type ChatStreamReplyFailure,
  type ChatTypingIndicatorFailure,
} from "./errors";
import { createReplyHandler } from "./handlers/reply";
import { createSendMessageHandler } from "./handlers/send-message";
import { createStreamMessageHandler } from "./handlers/stream-message";
import { createStreamReplyHandler } from "./handlers/stream-reply";
import { createTypingIndicatorHandler } from "./handlers/typing-indicator";
import type { OpenedRuntime } from "./handlers/types";
import {
  adapterForChatId,
  commandNameFor,
  normalizeChatTextInput,
  openChatAdapter,
  startChatAdapter,
} from "./handlers/utils";
import {
  ensureCanClose,
  ensureCanStart,
  ensureStarted,
  initialChatLifecycleState,
  type ChatLifecycleState,
} from "./lifecycle";

/** Runtime facade for lifecycle and inbound chat events. */
export interface Chat<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TCommands extends ChatCommandRegistry,
> {
  readonly chatIds: readonly Extract<keyof TAdapters, string>[];
  start(): Promise<Result<void, ChatStartError>>;
  close(): Promise<Result<void, ChatCloseFailure>>;
  readonly on: ChatOn<
    TCommands,
    Extract<keyof TAdapters, string>,
    Result<
      ChatSentMessageFromInput<
        TAdapters,
        ChatReplyInput<TAdapters> | ChatStreamReplyInput<TAdapters>
      >,
      ChatReplyFailure | ChatStreamReplyFailure
    >,
    AdapterDataByChatId<TAdapters>,
    AdapterOptionsByChatId<TAdapters>
  >;
  sendMessage<TInput extends ChatSendMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>>;
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
>(options: CreateChatOptions<TAdapters, TCommands>): Chat<TAdapters, TCommands> {
  type TChatId = Extract<keyof TAdapters, string>;
  type TAdapterDataByChatId = AdapterDataByChatId<TAdapters>;
  type TAdapterOptionsByChatId = AdapterOptionsByChatId<TAdapters>;
  type TReplyResult = Result<
    ChatSentMessageFromInput<
      TAdapters,
      ChatReplyInput<TAdapters> | ChatStreamReplyInput<TAdapters>
    >,
    ChatReplyFailure | ChatStreamReplyFailure
  >;

  const chatIds = Object.freeze(Object.keys(options.adapters) as TChatId[]);
  const handlers = new Set<
    StoredHandler<TCommands, TChatId, TReplyResult, TAdapterDataByChatId, TAdapterOptionsByChatId>
  >();
  const openedRuntimes = new Map<string, OpenedRuntime>();
  const pendingStartupEvents: ChatAdapterEvent<TCommands, TChatId, TAdapterDataByChatId>[] = [];
  let lifecycle: ChatLifecycleState = initialChatLifecycleState;
  let abortController: AbortController | undefined;

  function reportHandlerError(
    event: ChatEvent<
      TCommands,
      TChatId,
      TReplyResult,
      TAdapterDataByChatId,
      TAdapterOptionsByChatId
    >,
    cause: unknown,
  ) {
    if (event.type === "error") {
      return;
    }

    dispatch({ type: "error", chatId: event.chatId, error: cause } as ChatEvent<
      TCommands,
      TChatId,
      TReplyResult,
      TAdapterDataByChatId,
      TAdapterOptionsByChatId
    >);
  }

  function dispatch(
    event: ChatEvent<
      TCommands,
      TChatId,
      TReplyResult,
      TAdapterDataByChatId,
      TAdapterOptionsByChatId
    >,
  ) {
    const commandName = commandNameFor(event);

    for (const subscription of handlers) {
      if (subscription.type !== event.type) {
        continue;
      }

      if (subscription.commandName !== undefined && subscription.commandName !== commandName) {
        continue;
      }

      try {
        void Promise.resolve(subscription.handler(event)).catch((cause: unknown) => {
          reportHandlerError(event, cause);
        });
      } catch (cause) {
        reportHandlerError(event, cause);
      }
    }
  }

  function bindEvent(
    event: ChatAdapterEvent<TCommands, TChatId, TAdapterDataByChatId>,
  ): ChatEvent<TCommands, TChatId, TReplyResult, TAdapterDataByChatId, TAdapterOptionsByChatId> {
    if (
      event.type !== "message" &&
      event.type !== "command" &&
      event.type !== "command.invalid" &&
      event.type !== "command.unknown"
    ) {
      return event as ChatEvent<
        TCommands,
        TChatId,
        TReplyResult,
        TAdapterDataByChatId,
        TAdapterOptionsByChatId
      >;
    }

    const messageId = event.type === "message" ? event.message.messageId : event.message?.messageId;

    return {
      ...event,
      reply: async (
        message: ChatTextInput,
        replyOptions?: {
          readonly mode?: ChatReplyMode;
          readonly adapterOptions?: ChatAdapterObject;
        },
      ) => {
        const content = normalizeChatTextInput(message);
        const adapterOptions = replyOptions?.adapterOptions;
        return reply({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          messageId,
          text: content.text,
          format: content.format,
          mode: replyOptions?.mode,
          ...(adapterOptions === undefined ? {} : { adapterOptions }),
        } as ChatReplyInput<TAdapters>);
      },
      replyStream: async (
        content: ChatTextStreamContent,
        replyOptions?: {
          readonly mode?: ChatReplyMode;
          readonly fallback?: ChatStreamFallback;
          readonly adapterOptions?: ChatAdapterObject;
        },
      ) => {
        const adapterOptions = replyOptions?.adapterOptions;
        return streamReply({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          messageId,
          content,
          fallback: replyOptions?.fallback,
          mode: replyOptions?.mode,
          ...(adapterOptions === undefined ? {} : { adapterOptions }),
        } as ChatStreamReplyInput<TAdapters>);
      },
      typingIndicator: async (
        typingOptions?: ChatEventTypingIndicatorOptions<ChatAdapterObject>,
      ) => {
        const adapterOptions = typingOptions?.adapterOptions;
        return typingIndicator({
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
          ...(adapterOptions === undefined ? {} : { adapterOptions }),
        } as ChatTypingIndicatorInput<TAdapters>);
      },
    } as ChatEvent<TCommands, TChatId, TReplyResult, TAdapterDataByChatId, TAdapterOptionsByChatId>;
  }

  function emit(event: ChatAdapterEvent<TCommands, TChatId, TAdapterDataByChatId>) {
    if (lifecycle.status === "starting" && event.type !== "diagnostic" && event.type !== "error") {
      pendingStartupEvents.push(event);
      return;
    }

    dispatch(bindEvent(event));
  }

  const on = ((
    type: ChatEventType,
    commandOrHandler:
      | string
      | ChatEventHandler<ChatCommandEvent<TCommands, keyof TCommands, TChatId>>
      | ChatEventHandler<
          ChatEvent<TCommands, TChatId, TReplyResult, TAdapterDataByChatId, TAdapterOptionsByChatId>
        >,
    maybeHandler?: ChatEventHandler<ChatCommandEvent<TCommands, keyof TCommands, TChatId>>,
  ): Unsubscribe => {
    const commandName = typeof commandOrHandler === "string" ? commandOrHandler : undefined;
    const handler = (typeof commandOrHandler === "string" ? maybeHandler : commandOrHandler) as
      | ChatEventHandler<
          ChatEvent<TCommands, TChatId, TReplyResult, TAdapterDataByChatId, TAdapterOptionsByChatId>
        >
      | undefined;

    if (handler === undefined) {
      throw new TypeError("chat.on requires an event handler");
    }

    const subscription = { type, commandName, handler } satisfies StoredHandler<
      TCommands,
      TChatId,
      TReplyResult,
      TAdapterDataByChatId,
      TAdapterOptionsByChatId
    >;
    handlers.add(subscription);

    return () => {
      handlers.delete(subscription);
    };
  }) as ChatOn<TCommands, TChatId, TReplyResult, TAdapterDataByChatId, TAdapterOptionsByChatId>;

  async function start() {
    const canStart = ensureCanStart(lifecycle);
    if (canStart.isErr()) {
      return Result.err(canStart.error);
    }

    lifecycle = { status: "starting" };
    abortController = new AbortController();

    for (const chatId of chatIds) {
      const existing = openedRuntimes.get(chatId);
      const runtimeResult: Result<OpenedRuntime, ChatAdapterOpenError> = existing
        ? Result.ok(existing)
        : await openChatAdapter({
            adapter: adapterForChatId(options.adapters, chatId),
            chatId,
            signal: abortController.signal,
          });

      if (runtimeResult.isErr()) {
        pendingStartupEvents.length = 0;
        await cleanupOpenedRuntimes({ reason: "start_failed" });
        lifecycle = { status: "created" };
        return Result.err(runtimeResult.error);
      }

      const runtime = runtimeResult.value;
      openedRuntimes.set(chatId, runtime);

      const started = await startChatAdapter({
        chatId,
        runtime,
        context: {
          commands: options.commands,
          emit: emit as ChatAdapterStartContext<TCommands, TChatId, ChatAdapterObject>["emit"],
          diagnostic: (diagnostic) => {
            emit({
              ...diagnostic,
              type: "diagnostic",
              chatId: (diagnostic.chatId ?? chatId) as TChatId,
            });
          },
          signal: abortController.signal,
        },
      });

      if (started.isErr()) {
        pendingStartupEvents.length = 0;
        await cleanupOpenedRuntimes({ reason: "start_failed" });
        lifecycle = { status: "created" };
        return Result.err(started.error);
      }

      dispatch({ type: "ready", chatId } as ChatEvent<
        TCommands,
        TChatId,
        TReplyResult,
        TAdapterDataByChatId,
        TAdapterOptionsByChatId
      >);
    }

    lifecycle = { status: "started" };
    for (const event of pendingStartupEvents.splice(0)) {
      dispatch(bindEvent(event));
    }
    return Result.ok();
  }

  async function cleanupOpenedRuntimes(args: { readonly reason: string }) {
    const cleanupResults = await Promise.all(
      [...openedRuntimes.entries()].map(async ([chatId, runtime]) => {
        try {
          await runtime.close();
        } catch (cause) {
          return Result.err({ chatId, cause });
        } finally {
          openedRuntimes.delete(chatId);
        }

        return Result.ok();
      }),
    );
    const [, failures] = Result.partition(cleanupResults);

    for (const failure of failures) {
      emit({
        type: "diagnostic",
        chatId: failure.chatId as TChatId,
        level: "warn",
        code: "ADAPTER_CLEANUP_FAILED",
        message: `Failed to clean up chat adapter after ${args.reason}`,
        cause: failure.cause,
      });
    }
  }

  async function getStartedRuntime<TChatId extends keyof TAdapters>(args: {
    readonly chatId: TChatId;
    readonly operation:
      | "sendMessage"
      | "reply"
      | "streamMessage"
      | "streamReply"
      | "typingIndicator";
  }): Promise<
    Result<
      OpenedChatAdapter<
        Extract<TChatId, string>,
        AdapterOptionsFor<TAdapters, TChatId>,
        AdapterDataFor<TAdapters, TChatId>
      >,
      UnknownChatAdapterError | ChatLifecycleError
    >
  > {
    const key = args.chatId as string;
    if (!Object.hasOwn(options.adapters, key)) {
      return Result.err(new UnknownChatAdapterError({ chatId: key, availableChatIds: chatIds }));
    }

    const canRun = ensureStarted({ state: lifecycle, operation: args.operation });
    if (canRun.isErr()) {
      return Result.err(canRun.error);
    }

    const runtime = openedRuntimes.get(key);
    if (!runtime) {
      return Result.err(new UnknownChatAdapterError({ chatId: key, availableChatIds: chatIds }));
    }

    return Result.ok(
      runtime as OpenedChatAdapter<
        Extract<TChatId, string>,
        AdapterOptionsFor<TAdapters, TChatId>,
        AdapterDataFor<TAdapters, TChatId>
      >,
    );
  }

  const sendMessage = createSendMessageHandler<TAdapters>({ getStartedRuntime });
  const reply = createReplyHandler<TAdapters>({ getStartedRuntime });
  const streamMessage = createStreamMessageHandler<TAdapters>({
    getStartedRuntime,
    emit,
    sendMessage,
  });
  const streamReply = createStreamReplyHandler<TAdapters>({
    getStartedRuntime,
    emit,
    reply,
  });
  const typingIndicator = createTypingIndicatorHandler<TAdapters>({
    getStartedRuntime,
    emit,
    getLifecycleSignal: () => abortController?.signal,
  });

  async function close() {
    const canClose = ensureCanClose(lifecycle);
    if (canClose.isErr()) {
      return Result.err(canClose.error);
    }

    lifecycle = { status: "closing" };
    abortController?.abort();

    const closeResults = await Promise.all(
      [...openedRuntimes.entries()].map(async ([chatId, runtime]) => {
        return Result.tryPromise({
          try: async () => {
            await runtime.close();
            openedRuntimes.delete(chatId);
            emit({ type: "closed", chatId: chatId as TChatId });
          },
          catch: (cause) => ({ chatId, cause }),
        });
      }),
    );
    const [, failures] = Result.partition(closeResults);

    lifecycle = { status: "closed" };
    abortController = undefined;

    return failures.length === 0 ? Result.ok() : Result.err(new ChatCloseError({ failures }));
  }

  return {
    chatIds,
    start,
    close,
    on,
    sendMessage,
    reply,
    streamMessage,
    streamReply,
    typingIndicator,
  };
}

/** Options for building the chat facade over registered adapters. */
export interface CreateChatOptions<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TCommands extends ChatCommandRegistry,
> {
  readonly adapters: TAdapters;
  readonly commands: TCommands;
}

type StoredHandler<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
  TReplyResult,
  TAdapterDataByChatId extends ChatEventAdapterData<TChatId>,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId>,
> = {
  readonly type: ChatEventType;
  readonly commandName?: string;
  readonly handler: ChatEventHandler<
    ChatEvent<TCommands, TChatId, TReplyResult, TAdapterDataByChatId, TAdapterOptionsByChatId>
  >;
};
