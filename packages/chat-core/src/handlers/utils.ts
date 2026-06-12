import { Result } from "better-result";
import type { ChatAdapterStartContext } from "../adapter/io";
import type { ChatCommandRegistry } from "../registry/commands";
import type { ChatAdapterObject, ChatTextContent, ChatTextInput } from "../contracts";
import { ChatAdapterOpenError, ChatAdapterStartError } from "../errors";
import {
  chatLogEvents,
  type ChatLogEventName,
  type ChatLogScope,
  type ChatLogger,
} from "../logger";
import { logChatResult, startChatLogTimer } from "../logger-utils";
import type { OpenedRuntime, RuntimeChatAdapterDefinition } from "./types";

export async function openChatAdapter(args: {
  readonly adapter: RuntimeChatAdapterDefinition;
  readonly chatId: string;
  readonly signal?: AbortSignal;
  readonly logger?: ChatLogScope<ChatLogEventName>;
  readonly adapterLogger?: ChatLogger;
}): Promise<Result<OpenedRuntime, ChatAdapterOpenError>> {
  const startedAt = startChatLogTimer();
  const metadata = {
    chatId: args.chatId,
    operation: "openAdapter",
  } as const;

  args.logger?.debug(chatLogEvents.adapterOpenBegin, metadata);

  const opened = await Result.tryPromise({
    try: () => args.adapter.open({ signal: args.signal, logger: args.adapterLogger }),
    catch: (cause) => new ChatAdapterOpenError({ chatId: args.chatId, cause }),
  });

  const result = Result.andThen(opened, (adapterResult) =>
    Result.mapError(
      adapterResult,
      (cause) => new ChatAdapterOpenError({ chatId: args.chatId, cause }),
    ),
  );

  logChatResult({
    logger: args.logger,
    result,
    startedAt,
    metadata,
    successEvent: chatLogEvents.adapterOpenSuccess,
    failureEvent: chatLogEvents.adapterOpenFailure,
  });

  return result;
}

export async function startChatAdapter<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly runtime: OpenedRuntime;
  readonly context: ChatAdapterStartContext<TCommands, TChatId, ChatAdapterObject, unknown>;
  readonly logger?: ChatLogScope<ChatLogEventName>;
}): Promise<Result<void, ChatAdapterStartError>> {
  const startedAt = startChatLogTimer();
  const metadata = {
    chatId: args.chatId,
    operation: "startAdapter",
  } as const;

  args.logger?.debug(chatLogEvents.adapterStartBegin, metadata);

  const started = await Result.tryPromise({
    try: () =>
      args.runtime.start(
        args.context as ChatAdapterStartContext<TCommands, string, ChatAdapterObject, unknown>,
      ),
    catch: (cause) => new ChatAdapterStartError({ chatId: args.chatId, cause }),
  });

  const result = Result.andThen(started, (adapterResult) =>
    Result.map(
      Result.mapError(
        adapterResult,
        (cause) => new ChatAdapterStartError({ chatId: args.chatId, cause }),
      ),
      () => undefined,
    ),
  );

  logChatResult({
    logger: args.logger,
    result,
    startedAt,
    metadata,
    successEvent: chatLogEvents.adapterStartSuccess,
    failureEvent: chatLogEvents.adapterStartFailure,
  });

  return result;
}

export function normalizeChatTextInput(message: ChatTextInput): ChatTextContent {
  return typeof message === "string" ? { text: message } : message;
}
