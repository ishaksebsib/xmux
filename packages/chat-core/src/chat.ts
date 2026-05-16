import { Result } from "better-result";
import type {
  ChatAdapterDefinition,
  ChatAdapterReplyInput,
  ChatAdapterSendMessageInput,
  ChatAdapterStartContext,
  OpenedChatAdapter,
} from "./adapter";
import type { ChatAdapterObject, ChatTextInput, ChatTextContent } from "./contracts";
import type { ChatCommandRegistry } from "./commands";
import type {
  AdapterDataFor,
  AdapterOptionsFor,
  ChatAdapterDefinitions,
  ChatReplyInput,
  ChatSendMessageInput,
  ChatSentMessageFromInput,
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
  UnknownChatAdapterError,
  UnsupportedChatOperationError,
  type ChatCloseFailure,
  type ChatLifecycleError,
  type ChatReplyFailure,
  type ChatSendMessageFailure,
  type ChatStartError,
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
  type TReplyResult = Result<
    ChatSentMessageFromInput<TAdapters, ChatReplyInput<TAdapters>>,
    ChatReplyFailure
  >;

  const chatIds = Object.freeze(Object.keys(options.adapters) as TChatId[]);
  const handlers = new Set<StoredHandler<TCommands, TChatId>>();
  const openedRuntimes = new Map<string, OpenedRuntime>();
  let lifecycle: ChatLifecycleState = initialChatLifecycleState;
  let abortController: AbortController | undefined;

  function reportHandlerError(event: ChatEvent<TCommands, TChatId>, cause: unknown) {
    if (event.type === "error") {
      return;
    }

    dispatch({ type: "error", chatId: event.chatId, error: cause } as ChatEvent<
      TCommands,
      TChatId
    >);
  }

  function dispatch(event: ChatEvent<TCommands, TChatId>) {
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

  function bindEvent(event: ChatAdapterEvent<TCommands, TChatId>): ChatEvent<TCommands, TChatId> {
    if (event.type !== "message" && event.type !== "command") {
      return event as ChatEvent<TCommands, TChatId>;
    }

    const messageId = event.type === "message" ? event.message.messageId : event.message?.messageId;

    return {
      ...event,
      reply: async (message: ChatTextInput, replyOptions) => {
        const content = normalizeChatTextInput(message);
        return reply({
          chatId: event.chatId,
          conversationId: event.conversation.conversationId,
          messageId,
          text: content.text,
          format: content.format,
          mode: replyOptions?.mode,
        } as ChatReplyInput<TAdapters>);
      },
    } as ChatEvent<TCommands, TChatId>;
  }

  function emit(event: ChatAdapterEvent<TCommands, TChatId>) {
    dispatch(bindEvent(event));
  }

  const on = ((
    type: ChatEventType,
    commandOrHandler:
      | string
      | ChatEventHandler<ChatCommandEvent<TCommands, keyof TCommands, TChatId>>
      | ChatEventHandler<ChatEvent<TCommands, TChatId>>,
    maybeHandler?: ChatEventHandler<ChatCommandEvent<TCommands, keyof TCommands, TChatId>>,
  ): Unsubscribe => {
    const commandName = typeof commandOrHandler === "string" ? commandOrHandler : undefined;
    const handler = (typeof commandOrHandler === "string" ? maybeHandler : commandOrHandler) as
      | ChatEventHandler<ChatEvent<TCommands, TChatId>>
      | undefined;

    if (handler === undefined) {
      throw new TypeError("chat.on requires an event handler");
    }

    const subscription = { type, commandName, handler } satisfies StoredHandler<TCommands, TChatId>;
    handlers.add(subscription);

    return () => {
      handlers.delete(subscription);
    };
  }) as ChatOn<TCommands, TChatId, TReplyResult>;

  async function start() {
    const canStart = ensureCanStart(lifecycle);
    if (canStart.isErr()) {
      return Result.err(canStart.error);
    }

    lifecycle = { status: "starting" };
    abortController = new AbortController();

    for (const chatId of chatIds) {
      const existing = openedRuntimes.get(chatId) as
        | OpenedChatAdapter<TChatId, ChatAdapterObject, ChatAdapterObject>
        | undefined;
      const runtimeResult: Result<
        OpenedChatAdapter<TChatId, ChatAdapterObject, ChatAdapterObject>,
        ChatAdapterOpenError
      > = existing
        ? Result.ok(existing)
        : await openChatAdapter({
            adapter: options.adapters[chatId] as unknown as ChatAdapterDefinition<
              TChatId,
              ChatAdapterObject,
              ChatAdapterObject
            >,
            chatId,
            signal: abortController.signal,
          });

      if (runtimeResult.isErr()) {
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
          emit,
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
        await cleanupOpenedRuntimes({ reason: "start_failed" });
        lifecycle = { status: "created" };
        return Result.err(started.error);
      }

      emit({ type: "ready", chatId });
    }

    lifecycle = { status: "started" };
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
    readonly operation: "sendMessage" | "reply";
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
    if (!(key in options.adapters)) {
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

      if (runtime.reply && input.messageId !== undefined) {
        const adapterReplyInput = {
          ...createAdapterSendMessageInput<TAdapters, TInput>(input),
          message: {
            chatId: input.chatId,
            conversationId: input.conversationId,
            messageId: input.messageId,
          },
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
    Result<ChatSentMessageFromInput<TAdapters, ChatReplyInput<TAdapters>>, ChatReplyFailure>
  >;
  sendMessage<TInput extends ChatSendMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>>;
  reply<TInput extends ChatReplyInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatReplyFailure>>;
}

type OpenedRuntime = OpenedChatAdapter<string, ChatAdapterObject, ChatAdapterObject>;

type StoredHandler<TCommands extends ChatCommandRegistry, TChatId extends string> = {
  readonly type: ChatEventType;
  readonly commandName?: string;
  readonly handler: ChatEventHandler<ChatEvent<TCommands, TChatId>>;
};

async function openChatAdapter<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject,
  TAdapterData extends ChatAdapterObject,
>(args: {
  readonly adapter: ChatAdapterDefinition<TChatId, TAdapterOptions, TAdapterData>;
  readonly chatId: TChatId;
  readonly signal?: AbortSignal;
}): Promise<
  Result<OpenedChatAdapter<TChatId, TAdapterOptions, TAdapterData>, ChatAdapterOpenError>
> {
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
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject,
  TAdapterData extends ChatAdapterObject,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly chatId: TChatId;
  readonly runtime: OpenedChatAdapter<TChatId, TAdapterOptions, TAdapterData>;
  readonly context: ChatAdapterStartContext<TCommands, TChatId>;
}): Promise<Result<void, ChatAdapterStartError>> {
  const started = await Result.tryPromise({
    try: async () => args.runtime.start(args.context),
    catch: (cause) => new ChatAdapterStartError({ chatId: args.chatId, cause }),
  });

  if (started.isErr()) {
    return Result.err(started.error);
  }

  return started.value.isErr()
    ? Result.err(new ChatAdapterStartError({ chatId: args.chatId, cause: started.value.error }))
    : Result.ok();
}

function commandNameFor<TCommands extends ChatCommandRegistry>(
  event: ChatEvent<TCommands>,
): string | undefined {
  return event.type === "command" ? event.command.name : undefined;
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
