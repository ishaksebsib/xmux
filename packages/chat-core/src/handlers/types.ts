import type { Result } from "better-result";
import type {
  ChatAdapterDefinition,
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
  ChatAdapterCapabilities,
  OpenedChatAdapter,
} from "../adapter";
import type { ChatAdapterObject, ChatSentMessage } from "../contracts";
import type {
  ChatLifecycleError,
  ChatReplyFailure,
  ChatSendActionFailure,
  ChatSendMessageFailure,
  ChatStreamMessageFailure,
  ChatStreamReplyFailure,
  ChatTypingIndicatorFailure,
  UnknownChatAdapterError,
} from "../errors";
import type {
  AdapterCapabilitiesFor,
  AdapterDataFor,
  AdapterErrorFor,
  AdapterOptionsFor,
  ChatAdapterDefinitions,
  ChatReplyInput,
  ChatSendActionInput,
  ChatSendMessageInput,
  ChatSentMessageFromInput,
  ChatStreamMessageInput,
  ChatStreamReplyInput,
  ChatTypingIndicatorInput,
  ChatTypingIndicatorResult,
} from "../types";

export type SendMessageInputForStream<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends { readonly chatId: keyof TAdapters },
> = Extract<ChatSendMessageInput<TAdapters>, { readonly chatId: TInput["chatId"] }>;

export type ReplyInputForStream<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends { readonly chatId: keyof TAdapters },
> = Extract<ChatReplyInput<TAdapters>, { readonly chatId: TInput["chatId"] }>;

export type RuntimeChatAdapterDefinition = ChatAdapterDefinition<
  string,
  ChatAdapterObject,
  ChatAdapterObject,
  ChatAdapterCapabilities
>;

export type OpenedRuntime = OpenedChatAdapter<
  string,
  ChatAdapterObject,
  ChatAdapterObject,
  ChatAdapterCapabilities,
  unknown
>;

export type StreamMessageRuntime = {
  streamMessage(
    input: ChatAdapterStreamMessageInput<string, ChatAdapterObject>,
  ): Promise<Result<ChatSentMessage<string, ChatAdapterObject>, unknown>>;
};

export type StreamReplyRuntime = {
  streamReply(
    input: ChatAdapterStreamReplyInput<string, ChatAdapterObject>,
  ): Promise<Result<ChatSentMessage<string, ChatAdapterObject>, unknown>>;
};

export type ChatRuntimeOperation =
  | "sendMessage"
  | "sendAction"
  | "reply"
  | "streamMessage"
  | "streamReply"
  | "typingIndicator";

export type StreamFallbackDiagnosticEmit<TChatId extends string> = (event: {
  readonly type: "diagnostic";
  readonly chatId: TChatId;
  readonly level: "info";
  readonly code: "CHAT_STREAM_FALLBACK_TO_SEND_MESSAGE";
  readonly message: string;
}) => void;

export type SendMessageHandler<TAdapters extends ChatAdapterDefinitions<TAdapters>> = <
  TInput extends ChatSendMessageInput<TAdapters>,
>(
  input: TInput,
) => Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>>;

export type SendActionHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TActions extends import("../actions").ChatActionRegistry,
> = <TInput extends ChatSendActionInput<TAdapters, TActions>>(
  input: TInput,
) => Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendActionFailure>>;

export type ReplyHandler<TAdapters extends ChatAdapterDefinitions<TAdapters>> = <
  TInput extends ChatReplyInput<TAdapters>,
>(
  input: TInput,
) => Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatReplyFailure>>;

export type StreamMessageHandler<TAdapters extends ChatAdapterDefinitions<TAdapters>> = <
  TInput extends ChatStreamMessageInput<TAdapters>,
>(
  input: TInput,
) => Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamMessageFailure>>;

export type StreamReplyHandler<TAdapters extends ChatAdapterDefinitions<TAdapters>> = <
  TInput extends ChatStreamReplyInput<TAdapters>,
>(
  input: TInput,
) => Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamReplyFailure>>;

export type TypingIndicatorHandler<TAdapters extends ChatAdapterDefinitions<TAdapters>> = <
  TInput extends ChatTypingIndicatorInput<TAdapters>,
>(
  input: TInput,
) => Promise<Result<ChatTypingIndicatorResult<TInput>, ChatTypingIndicatorFailure>>;

export type GetStartedRuntime<TAdapters extends ChatAdapterDefinitions<TAdapters>> = <
  TChatId extends keyof TAdapters,
>(args: {
  readonly chatId: TChatId;
  readonly operation: ChatRuntimeOperation;
}) => Promise<
  Result<
    OpenedChatAdapter<
      Extract<TChatId, string>,
      AdapterOptionsFor<TAdapters, TChatId>,
      AdapterDataFor<TAdapters, TChatId>,
      AdapterCapabilitiesFor<TAdapters, TChatId>,
      AdapterErrorFor<TAdapters, TChatId>
    >,
    UnknownChatAdapterError | ChatLifecycleError
  >
>;
