import type { Result } from "better-result";
import type { ChatAdapterCapabilities } from "../capabilities";
import type { ChatAdapterDefinition, OpenedChatAdapter } from "../adapter/definition";
import type {
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
  ChatAdapterUpdateActionInput,
} from "../adapter/io";
import type { ChatActionRegistry } from "../registry/actions";
import type { ChatAdapterObject, ChatSentMessage } from "../contracts";
import type {
  ChatLifecycleError,
  ChatReplyFailure,
  ChatSendActionFailure,
  ChatSendMessageFailure,
  ChatUpdateActionFailure,
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
} from "../adapter/registry";
import type {
  ChatReplyInput,
  ChatSendActionInput,
  ChatSendMessageInput,
  ChatUpdateActionInput,
  ChatSentMessageFromInput,
  ChatStreamMessageInput,
  ChatStreamReplyInput,
  ChatTypingIndicatorInput,
  ChatTypingIndicatorResult,
} from "../inputs";

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
  | "updateAction"
  | "injectMessage"
  | "respondToAction"
  | "reply"
  | "streamMessage"
  | "streamReply"
  | "typingIndicator";

export type SendMessageHandler<TAdapters extends ChatAdapterDefinitions<TAdapters>> = <
  TInput extends ChatSendMessageInput<TAdapters>,
>(
  input: TInput,
) => Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>>;

export type SendActionHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TActions extends ChatActionRegistry,
> = <TInput extends ChatSendActionInput<TAdapters, TActions>>(
  input: TInput,
) => Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendActionFailure>>;

export type UpdateActionHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TActions extends ChatActionRegistry,
> = <TInput extends ChatUpdateActionInput<TAdapters, TActions>>(
  input: TInput,
) => Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatUpdateActionFailure>>;

export type UpdateActionRuntime = {
  updateAction(
    input: ChatAdapterUpdateActionInput<string, ChatAdapterObject>,
  ): Promise<Result<ChatSentMessage<string, ChatAdapterObject>, unknown>>;
};

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
