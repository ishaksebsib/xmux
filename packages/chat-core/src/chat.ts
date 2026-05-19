import { Result } from "better-result";
import type {
  ChatAdapterDefinition,
  ChatAdapterReplyInput,
  ChatAdapterSendMessageInput,
  ChatAdapterStartContext,
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
  ChatAdapterCapabilities,
  OpenedChatAdapter,
} from "./adapter";
import type {
  ChatAdapterObject,
  ChatSentMessage,
  ChatStreamFallback,
  ChatTextInput,
  ChatTextContent,
  ChatTextStreamChunk,
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
} from "./types";
import type {
  ChatAdapterEvent,
  ChatCommandEvent,
  ChatEvent,
  ChatEventHandler,
  ChatEventType,
  ChatOn,
  Unsubscribe,
} from "./events";
import {
  ChatAdapterOpenError,
  ChatAdapterStartError,
  ChatCloseError,
  ChatReplyError,
  ChatSendMessageError,
  ChatStreamMessageError,
  ChatStreamReplyError,
  UnknownChatAdapterError,
  UnsupportedChatOperationError,
  type ChatCloseFailure,
  type ChatLifecycleError,
  type ChatReplyFailure,
  type ChatSendMessageFailure,
  type ChatStartError,
  type ChatStreamMessageFailure,
  type ChatStreamReplyFailure,
} from "./errors";
import {
  ensureCanClose,
  ensureCanStart,
  ensureStarted,
  initialChatLifecycleState,
  type ChatLifecycleState,
} from "./lifecycle";

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
    if (event.type !== "message" && event.type !== "command") {
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
    readonly operation: "sendMessage" | "reply" | "streamMessage" | "streamReply";
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

  async function sendMessage<TInput extends ChatSendMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>> {
    return Result.gen(async function* () {
      const runtime = yield* Result.await(
        getStartedRuntime({ chatId: input.chatId, operation: "sendMessage" }),
      );
      const adapterInput = createAdapterSendMessageInput<TAdapters, TInput>(input);

      const sentResult = yield* Result.await(
        Result.tryPromise({
          try: async () => runtime.sendMessage(adapterInput),
          catch: (cause) => new ChatSendMessageError({ chatId: input.chatId, cause }),
        }),
      );

      if (sentResult.isErr()) {
        return Result.err(
          new ChatSendMessageError({ chatId: input.chatId, cause: sentResult.error }),
        );
      }

      return Result.ok(sentResult.value as ChatSentMessageFromInput<TAdapters, TInput>);
    });
  }

  async function reply<TInput extends ChatReplyInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatReplyFailure>> {
    return Result.gen(async function* () {
      const runtime = yield* Result.await(
        getStartedRuntime({ chatId: input.chatId, operation: "reply" }),
      );
      const mode = input.mode ?? "auto";

      if (runtime.reply) {
        const adapterReplyInput = {
          ...createAdapterSendMessageInput<TAdapters, TInput>(input),
          ...(input.messageId === undefined
            ? {}
            : {
                message: {
                  chatId: input.chatId,
                  conversationId: input.conversationId,
                  messageId: input.messageId,
                },
              }),
          mode,
        } as ChatAdapterReplyInput<
          TInput["chatId"],
          AdapterOptionsFor<TAdapters, TInput["chatId"]>
        >;

        const replyResult = yield* Result.await(
          Result.tryPromise({
            try: async () => runtime.reply?.(adapterReplyInput),
            catch: (cause) => new ChatReplyError({ chatId: input.chatId, cause }),
          }),
        );

        if (replyResult === undefined) {
          return Result.err(
            new UnsupportedChatOperationError({
              chatId: input.chatId,
              operation: "reply",
              mode,
            }),
          );
        }

        if (replyResult.isErr()) {
          return Result.err(new ChatReplyError({ chatId: input.chatId, cause: replyResult.error }));
        }

        return Result.ok(replyResult.value as ChatSentMessageFromInput<TAdapters, TInput>);
      }

      if (mode !== "auto" && mode !== "conversation") {
        return Result.err(
          new UnsupportedChatOperationError({
            chatId: input.chatId,
            operation: "reply",
            mode,
          }),
        );
      }

      const sentResult = yield* Result.await(
        Result.tryPromise({
          try: async () =>
            runtime.sendMessage(createAdapterSendMessageInput<TAdapters, TInput>(input)),
          catch: (cause) => new ChatSendMessageError({ chatId: input.chatId, cause }),
        }),
      );

      if (sentResult.isErr()) {
        return Result.err(
          new ChatSendMessageError({ chatId: input.chatId, cause: sentResult.error }),
        );
      }

      return Result.ok(sentResult.value as ChatSentMessageFromInput<TAdapters, TInput>);
    });
  }

  async function streamMessage<TInput extends ChatStreamMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamMessageFailure>> {
    return Result.gen(async function* () {
      const runtime = yield* Result.await(
        getStartedRuntime({ chatId: input.chatId, operation: "streamMessage" }),
      );
      const fallback = input.fallback ?? "send-message";

      if (hasStreamMessageRuntime(runtime)) {
        const streamResult = yield* Result.await(
          Result.tryPromise({
            try: async () =>
              runtime.streamMessage(createAdapterStreamMessageInput<TAdapters, TInput>(input)),
            catch: (cause) => new ChatStreamMessageError({ chatId: input.chatId, cause }),
          }),
        );

        if (streamResult.isErr()) {
          return Result.err(
            new ChatStreamMessageError({ chatId: input.chatId, cause: streamResult.error }),
          );
        }

        return Result.ok(streamResult.value as ChatSentMessageFromInput<TAdapters, TInput>);
      }

      if (fallback === "error") {
        return Result.err(
          new UnsupportedChatOperationError({ chatId: input.chatId, operation: "streamMessage" }),
        );
      }

      emitStreamFallbackDiagnostic({ chatId: input.chatId, operation: "streamMessage" });
      const collected = yield* Result.await(collectStreamForMessage({ input }));
      const sent = yield* Result.await(sendMessage(collected));
      return Result.ok(sentMessageFromSameChatInput<TAdapters, TInput>(sent));
    });
  }

  async function streamReply<TInput extends ChatStreamReplyInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamReplyFailure>> {
    return Result.gen(async function* () {
      const runtime = yield* Result.await(
        getStartedRuntime({ chatId: input.chatId, operation: "streamReply" }),
      );
      const fallback = input.fallback ?? "send-message";

      if (hasStreamReplyRuntime(runtime)) {
        const streamResult = yield* Result.await(
          Result.tryPromise({
            try: async () =>
              runtime.streamReply(createAdapterStreamReplyInput<TAdapters, TInput>(input)),
            catch: (cause) => new ChatStreamReplyError({ chatId: input.chatId, cause }),
          }),
        );

        if (streamResult.isErr()) {
          return Result.err(
            new ChatStreamReplyError({ chatId: input.chatId, cause: streamResult.error }),
          );
        }

        return Result.ok(streamResult.value as ChatSentMessageFromInput<TAdapters, TInput>);
      }

      if (fallback === "error") {
        return Result.err(
          new UnsupportedChatOperationError({ chatId: input.chatId, operation: "streamReply" }),
        );
      }

      emitStreamFallbackDiagnostic({ chatId: input.chatId, operation: "streamReply" });
      const collected = yield* Result.await(collectStreamForReply({ input }));
      const replied = yield* Result.await(reply(collected));
      return Result.ok(sentMessageFromSameChatInput<TAdapters, TInput>(replied));
    });
  }

  function emitStreamFallbackDiagnostic(args: {
    readonly chatId: TChatId;
    readonly operation: "streamMessage" | "streamReply";
  }) {
    emit({
      type: "diagnostic",
      chatId: args.chatId,
      level: "info",
      code: "CHAT_STREAM_FALLBACK_TO_SEND_MESSAGE",
      message: `Chat adapter "${args.chatId}" does not support ${args.operation}; sending final message instead.`,
    });
  }

  async function collectStreamForMessage<TInput extends ChatStreamMessageInput<TAdapters>>(args: {
    readonly input: TInput;
  }): Promise<Result<SendMessageInputForStream<TAdapters, TInput>, ChatStreamMessageError>> {
    const collected = await Result.tryPromise({
      try: async () => collectChatTextStream(args.input.content.chunks),
      catch: (cause) => new ChatStreamMessageError({ chatId: args.input.chatId, cause }),
    });
    if (collected.isErr()) {
      return Result.err(collected.error);
    }

    return Result.ok({
      chatId: args.input.chatId,
      conversationId: args.input.conversationId,
      text: collected.value,
      format: args.input.content.format,
      adapterOptions: "adapterOptions" in args.input ? args.input.adapterOptions : {},
      signal: args.input.signal,
    } as SendMessageInputForStream<TAdapters, TInput>);
  }

  async function collectStreamForReply<TInput extends ChatStreamReplyInput<TAdapters>>(args: {
    readonly input: TInput;
  }): Promise<Result<ReplyInputForStream<TAdapters, TInput>, ChatStreamReplyError>> {
    const collected = await Result.tryPromise({
      try: async () => collectChatTextStream(args.input.content.chunks),
      catch: (cause) => new ChatStreamReplyError({ chatId: args.input.chatId, cause }),
    });
    if (collected.isErr()) {
      return Result.err(collected.error);
    }

    return Result.ok({
      chatId: args.input.chatId,
      conversationId: args.input.conversationId,
      messageId: args.input.messageId,
      text: collected.value,
      format: args.input.content.format,
      mode: args.input.mode,
      adapterOptions: "adapterOptions" in args.input ? args.input.adapterOptions : {},
      signal: args.input.signal,
    } as ReplyInputForStream<TAdapters, TInput>);
  }

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
}

type SendMessageInputForStream<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends { readonly chatId: keyof TAdapters },
> = Extract<ChatSendMessageInput<TAdapters>, { readonly chatId: TInput["chatId"] }>;

type ReplyInputForStream<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends { readonly chatId: keyof TAdapters },
> = Extract<ChatReplyInput<TAdapters>, { readonly chatId: TInput["chatId"] }>;

type RuntimeChatAdapterDefinition = ChatAdapterDefinition<
  string,
  ChatAdapterObject,
  ChatAdapterObject,
  ChatAdapterCapabilities
>;

type OpenedRuntime = OpenedChatAdapter<
  string,
  ChatAdapterObject,
  ChatAdapterObject,
  ChatAdapterCapabilities
>;

type StreamMessageRuntime = {
  streamMessage(
    input: ChatAdapterStreamMessageInput<string, ChatAdapterObject>,
  ): Promise<Result<ChatSentMessage<string, ChatAdapterObject>, unknown>>;
};

type StreamReplyRuntime = {
  streamReply(
    input: ChatAdapterStreamReplyInput<string, ChatAdapterObject>,
  ): Promise<Result<ChatSentMessage<string, ChatAdapterObject>, unknown>>;
};

function adapterForChatId<TAdapters extends ChatAdapterDefinitions<TAdapters>>(
  adapters: TAdapters,
  chatId: Extract<keyof TAdapters, string>,
): RuntimeChatAdapterDefinition {
  return adapters[chatId];
}

function sentMessageFromSameChatInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends { readonly chatId: keyof TAdapters },
>(
  message: ChatSentMessage<string, ChatAdapterObject>,
): ChatSentMessageFromInput<TAdapters, TInput> {
  return message as ChatSentMessageFromInput<TAdapters, TInput>;
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

async function openChatAdapter(args: {
  readonly adapter: RuntimeChatAdapterDefinition;
  readonly chatId: string;
  readonly signal?: AbortSignal;
}): Promise<Result<OpenedRuntime, ChatAdapterOpenError>> {
  const opened = await Result.tryPromise({
    try: async () => args.adapter.open({ signal: args.signal }),
    catch: (cause) => new ChatAdapterOpenError({ chatId: args.chatId, cause }),
  });

  if (opened.isErr()) {
    return Result.err(opened.error);
  }

  return opened.value.isErr()
    ? Result.err(new ChatAdapterOpenError({ chatId: args.chatId, cause: opened.value.error }))
    : Result.ok(opened.value.value);
}

async function startChatAdapter<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly runtime: OpenedRuntime;
  readonly context: ChatAdapterStartContext<TCommands, TChatId, ChatAdapterObject>;
}): Promise<Result<void, ChatAdapterStartError>> {
  const started = await Result.tryPromise({
    try: async () =>
      args.runtime.start(
        args.context as ChatAdapterStartContext<TCommands, string, ChatAdapterObject>,
      ),
    catch: (cause) => new ChatAdapterStartError({ chatId: args.chatId, cause }),
  });

  if (started.isErr()) {
    return Result.err(started.error);
  }

  return started.value.isErr()
    ? Result.err(new ChatAdapterStartError({ chatId: args.chatId, cause: started.value.error }))
    : Result.ok();
}

function commandNameFor(event: {
  readonly type: ChatEventType;
  readonly command?: { readonly name: string };
}): string | undefined {
  return event.type === "command" ? event.command?.name : undefined;
}

function normalizeChatTextInput(message: ChatTextInput): ChatTextContent {
  return typeof message === "string" ? { text: message } : message;
}

function createAdapterSendMessageInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatSendMessageInput<TAdapters> | ChatReplyInput<TAdapters>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    text: input.text,
    format: input.format,
    adapterOptions: "adapterOptions" in input ? input.adapterOptions : {},
    signal: input.signal,
  } as ChatAdapterSendMessageInput<
    TInput["chatId"],
    AdapterOptionsFor<TAdapters, TInput["chatId"]>
  >;
}

function createAdapterStreamMessageInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatStreamMessageInput<TAdapters> | ChatStreamReplyInput<TAdapters>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    content: input.content,
    adapterOptions: "adapterOptions" in input ? input.adapterOptions : {},
    signal: input.signal,
  } as ChatAdapterStreamMessageInput<
    TInput["chatId"],
    AdapterOptionsFor<TAdapters, TInput["chatId"]>
  >;
}

function createAdapterStreamReplyInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatStreamReplyInput<TAdapters>,
>(input: TInput) {
  return {
    ...createAdapterStreamMessageInput<TAdapters, TInput>(input),
    ...(input.messageId === undefined
      ? {}
      : {
          message: {
            chatId: input.chatId,
            conversationId: input.conversationId,
            messageId: input.messageId,
          },
        }),
    mode: input.mode ?? "auto",
  } as ChatAdapterStreamReplyInput<
    TInput["chatId"],
    AdapterOptionsFor<TAdapters, TInput["chatId"]>
  >;
}

async function collectChatTextStream(chunks: AsyncIterable<ChatTextStreamChunk>): Promise<string> {
  let text = "";

  for await (const chunk of chunks) {
    if (chunk.type === "delta") {
      text += chunk.delta;
      continue;
    }

    if (chunk.type === "snapshot") {
      text = chunk.text;
      continue;
    }

    if (chunk.text !== undefined) {
      text = chunk.text;
    }
  }

  return text;
}

function hasStreamMessageRuntime(
  runtime: OpenedRuntime,
): runtime is OpenedRuntime & StreamMessageRuntime {
  return typeof (runtime as { readonly streamMessage?: unknown }).streamMessage === "function";
}

function hasStreamReplyRuntime(
  runtime: OpenedRuntime,
): runtime is OpenedRuntime & StreamReplyRuntime {
  return typeof (runtime as { readonly streamReply?: unknown }).streamReply === "function";
}
