import { Result } from "better-result";
import type { ChatAdapterDefinition, OpenedChatAdapter } from "./adapter";
import type { ChatAdapterObject } from "./contracts";
import type { ChatCommandRegistry } from "./commands";
import type { ChatAdapterDefinitions } from "./types";
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
  UnsupportedChatOperationError,
  type ChatCloseFailure,
  type ChatStartError,
} from "./errors";
import {
  ensureCanClose,
  ensureCanStart,
  initialChatLifecycleState,
  type ChatLifecycleState,
} from "./lifecycle";

/** Creates a typed chat runtime over the provided adapters and commands. */
export function createChat<
  const TAdapters extends ChatAdapterDefinitions<TAdapters>,
  const TCommands extends ChatCommandRegistry,
>(options: CreateChatOptions<TAdapters, TCommands>): Chat<TAdapters, TCommands> {
  type TChatId = Extract<keyof TAdapters, string>;

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

    for (const subscription of [...handlers]) {
      if (subscription.type !== event.type) {
        continue;
      }

      if (subscription.commandName !== undefined && subscription.commandName !== commandName) {
        continue;
      }

      void Promise.resolve(subscription.handler(event)).catch((cause: unknown) => {
        reportHandlerError(event, cause);
      });
    }
  }

  function bindEvent(event: ChatAdapterEvent<TCommands, TChatId>): ChatEvent<TCommands, TChatId> {
    if (event.type !== "message" && event.type !== "command") {
      return event as ChatEvent<TCommands, TChatId>;
    }

    return {
      ...event,
      reply: async () =>
        Result.err(
          new UnsupportedChatOperationError({
            chatId: event.chatId,
            operation: "reply",
            mode: "facade-not-implemented",
          }),
        ),
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
  }) as ChatOn<TCommands, TChatId>;

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
        lifecycle = { status: "created" };
        return Result.err(runtimeResult.error);
      }

      const runtime = runtimeResult.value;
      openedRuntimes.set(chatId, runtime);

      const started = await runtime.start({
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
      });

      if (started.isErr()) {
        lifecycle = { status: "created" };
        return Result.err(new ChatAdapterStartError({ chatId, cause: started.error }));
      }

      emit({ type: "ready", chatId });
    }

    lifecycle = { status: "started" };
    return Result.ok();
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
  readonly on: ChatOn<TCommands, Extract<keyof TAdapters, string>>;
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
  const opened = await args.adapter.open({ signal: args.signal });

  return opened.isErr()
    ? Result.err(new ChatAdapterOpenError({ chatId: args.chatId, cause: opened.error }))
    : Result.ok(opened.value);
}

function commandNameFor<TCommands extends ChatCommandRegistry>(
  event: ChatEvent<TCommands>,
): string | undefined {
  return event.type === "command" ? event.command.name : undefined;
}
