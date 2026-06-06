import { Result } from "better-result";
import type { ChatAdapterStartContext } from "../adapter/io";
import type { ChatCommandRegistry } from "../registry/commands";
import type { ChatAdapterObject, ChatTextContent, ChatTextInput } from "../contracts";
import { ChatAdapterOpenError, ChatAdapterStartError } from "../errors";
import type { OpenedRuntime, RuntimeChatAdapterDefinition } from "./types";

export async function openChatAdapter(args: {
  readonly adapter: RuntimeChatAdapterDefinition;
  readonly chatId: string;
  readonly signal?: AbortSignal;
}): Promise<Result<OpenedRuntime, ChatAdapterOpenError>> {
  const opened = await Result.tryPromise({
    try: () => args.adapter.open({ signal: args.signal }),
    catch: (cause) => new ChatAdapterOpenError({ chatId: args.chatId, cause }),
  });

  return Result.andThen(opened, (adapterResult) =>
    Result.mapError(
      adapterResult,
      (cause) => new ChatAdapterOpenError({ chatId: args.chatId, cause }),
    ),
  );
}

export async function startChatAdapter<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly runtime: OpenedRuntime;
  readonly context: ChatAdapterStartContext<TCommands, TChatId, ChatAdapterObject>;
}): Promise<Result<void, ChatAdapterStartError>> {
  const started = await Result.tryPromise({
    try: () =>
      args.runtime.start(
        args.context as ChatAdapterStartContext<TCommands, string, ChatAdapterObject>,
      ),
    catch: (cause) => new ChatAdapterStartError({ chatId: args.chatId, cause }),
  });

  return Result.andThen(started, (adapterResult) =>
    Result.map(
      Result.mapError(
        adapterResult,
        (cause) => new ChatAdapterStartError({ chatId: args.chatId, cause }),
      ),
      () => undefined,
    ),
  );
}

export function normalizeChatTextInput(message: ChatTextInput): ChatTextContent {
  return typeof message === "string" ? { text: message } : message;
}
