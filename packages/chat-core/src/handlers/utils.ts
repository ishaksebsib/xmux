import { Result } from "better-result";
import type {
  ChatAdapterSendActionInput,
  ChatAdapterSendMessageInput,
  ChatAdapterSendTypingInput,
  ChatAdapterStartContext,
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
} from "../adapter";
import type { ChatActionRegistry } from "../actions";
import type { ChatCommandRegistry } from "../commands";
import type {
  ChatAdapterObject,
  ChatSentMessage,
  ChatTextContent,
  ChatTextInput,
  ChatTextStreamChunk,
} from "../contracts";
import { ChatAdapterOpenError, ChatAdapterStartError } from "../errors";
import type { ChatEventType } from "../events";
import type {
  AdapterOptionsFor,
  ChatAdapterDefinitions,
  ChatReplyInput,
  ChatSendActionInput,
  ChatSendMessageInput,
  ChatSentMessageFromInput,
  ChatStreamMessageInput,
  ChatStreamReplyInput,
  ChatTypingIndicatorInput,
} from "../types";
import type {
  OpenedRuntime,
  RuntimeChatAdapterDefinition,
  StreamMessageRuntime,
  StreamReplyRuntime,
} from "./types";

export function adapterForChatId<TAdapters extends ChatAdapterDefinitions<TAdapters>>(
  adapters: TAdapters,
  chatId: Extract<keyof TAdapters, string>,
): RuntimeChatAdapterDefinition {
  return adapters[chatId];
}

export function sentMessageFromSameChatInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends { readonly chatId: keyof TAdapters },
>(
  message: ChatSentMessage<string, ChatAdapterObject>,
): ChatSentMessageFromInput<TAdapters, TInput> {
  return message as ChatSentMessageFromInput<TAdapters, TInput>;
}

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

export function handlerKeyFor(event: {
  readonly type: ChatEventType;
  readonly command?: { readonly name: string };
  readonly commandName?: string;
  readonly actionId?: string;
}): string | undefined {
  if (event.type === "command") {
    return event.command?.name;
  }

  if (event.type === "command.invalid" || event.type === "command.unknown") {
    return event.commandName;
  }

  return event.type === "action" ? event.actionId : undefined;
}

export function normalizeChatTextInput(message: ChatTextInput): ChatTextContent {
  return typeof message === "string" ? { text: message } : message;
}

export function createAdapterSendMessageInput<
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

export function createAdapterSendActionInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TActions extends ChatActionRegistry,
  TInput extends ChatSendActionInput<TAdapters, TActions>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    text: input.text,
    format: input.format,
    buttons: input.buttons,
    adapterOptions: "adapterOptions" in input ? input.adapterOptions : {},
    signal: input.signal,
  } as ChatAdapterSendActionInput<TInput["chatId"], AdapterOptionsFor<TAdapters, TInput["chatId"]>>;
}

export function createAdapterTypingIndicatorInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatTypingIndicatorInput<TAdapters>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    ...(input.messageId === undefined
      ? {}
      : {
          message: {
            chatId: input.chatId,
            conversationId: input.conversationId,
            messageId: input.messageId,
          },
        }),
    action: input.action ?? "typing",
    adapterOptions: "adapterOptions" in input ? input.adapterOptions : {},
    signal: input.signal,
  } as ChatAdapterSendTypingInput<TInput["chatId"], AdapterOptionsFor<TAdapters, TInput["chatId"]>>;
}

export function createAdapterStreamMessageInput<
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

export function createAdapterStreamReplyInput<
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

export async function collectChatTextStream(
  chunks: AsyncIterable<ChatTextStreamChunk>,
): Promise<string> {
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

export function hasStreamMessageRuntime(
  runtime: OpenedRuntime,
): runtime is OpenedRuntime & StreamMessageRuntime {
  return typeof (runtime as { readonly streamMessage?: unknown }).streamMessage === "function";
}

export function hasStreamReplyRuntime(
  runtime: OpenedRuntime,
): runtime is OpenedRuntime & StreamReplyRuntime {
  return typeof (runtime as { readonly streamReply?: unknown }).streamReply === "function";
}

export function emitStreamFallbackDiagnostic<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly operation: "streamMessage" | "streamReply";
  readonly emit: (event: {
    readonly type: "diagnostic";
    readonly chatId: TChatId;
    readonly level: "info";
    readonly code: "CHAT_STREAM_FALLBACK_TO_SEND_MESSAGE";
    readonly message: string;
  }) => void;
}) {
  args.emit({
    type: "diagnostic",
    chatId: args.chatId,
    level: "info",
    code: "CHAT_STREAM_FALLBACK_TO_SEND_MESSAGE",
    message: `Chat adapter "${args.chatId}" does not support ${args.operation}; sending final message instead.`,
  });
}
