import type { Result } from "better-result";
import type { ChatAdapterCapabilities } from "../capabilities";
import type { ChatCommandRegistry } from "../registry/commands";
import type { ChatAdapterObject, ChatSentMessage } from "../contracts";
import type {
  ChatAdapterReplyInput,
  ChatAdapterRespondToActionInput,
  ChatAdapterSendActionInput,
  ChatAdapterSendMessageInput,
  ChatAdapterSendTypingInput,
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
  ChatAdapterStartContext,
  OpenChatAdapterContext,
} from "./io";

/** Defines a chat adapter while preserving its id, options, and data types. */
export function defineChatAdapter<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
  const TCapabilities extends ChatAdapterCapabilities = ChatAdapterCapabilities,
  TAdapterError = unknown,
>(
  adapter: ChatAdapterDefinition<
    TChatId,
    TAdapterOptions,
    TAdapterData,
    TCapabilities,
    TAdapterError
  >,
): ChatAdapterDefinition<TChatId, TAdapterOptions, TAdapterData, TCapabilities, TAdapterError> {
  return adapter;
}

/** Live adapter runtime methods shared by every platform. */
export interface OpenedChatAdapterBase<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
  TCapabilities extends ChatAdapterCapabilities = ChatAdapterCapabilities,
  TAdapterError = unknown,
> {
  readonly id: TChatId;
  readonly capabilities?: TCapabilities;
  start<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, TAdapterData>,
  ): Promise<Result<void, TAdapterError>>;
  sendMessage(
    input: ChatAdapterSendMessageInput<TChatId, TAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TAdapterData>, TAdapterError>>;
  sendAction(
    input: ChatAdapterSendActionInput<TChatId, TAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TAdapterData>, TAdapterError>>;
  respondToAction(
    input: ChatAdapterRespondToActionInput<TChatId, TAdapterOptions>,
  ): Promise<Result<void, TAdapterError>>;
  reply?(
    input: ChatAdapterReplyInput<TChatId, TAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TAdapterData>, TAdapterError>>;
  sendTyping?(
    input: ChatAdapterSendTypingInput<TChatId, TAdapterOptions>,
  ): Promise<Result<void, TAdapterError>>;
  close(): Promise<void>;
}

/** Stream methods required only from adapters that claim stream support. */
export type ChatAdapterStreamMethodsFor<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject,
  TAdapterData extends ChatAdapterObject,
  TAdapterError,
  TCapabilities extends ChatAdapterCapabilities,
> = (TCapabilities["messages"] extends { readonly stream: { readonly send: true } }
  ? {
      streamMessage(
        input: ChatAdapterStreamMessageInput<TChatId, TAdapterOptions>,
      ): Promise<Result<ChatSentMessage<TChatId, TAdapterData>, TAdapterError>>;
    }
  : Record<never, never>) &
  (TCapabilities["messages"] extends { readonly stream: { readonly reply: true } }
    ? {
        streamReply(
          input: ChatAdapterStreamReplyInput<TChatId, TAdapterOptions>,
        ): Promise<Result<ChatSentMessage<TChatId, TAdapterData>, TAdapterError>>;
      }
    : Record<never, never>);

/** Live adapter runtime that owns platform resources and connections. */
export type OpenedChatAdapter<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
  TCapabilities extends ChatAdapterCapabilities = ChatAdapterCapabilities,
  TAdapterError = unknown,
> = OpenedChatAdapterBase<TChatId, TAdapterOptions, TAdapterData, TCapabilities, TAdapterError> &
  ChatAdapterStreamMethodsFor<TChatId, TAdapterOptions, TAdapterData, TAdapterError, TCapabilities>;

/** Adapter factory implemented by platform packages such as Discord or Telegram. */
export interface ChatAdapterDefinition<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
  TCapabilities extends ChatAdapterCapabilities = ChatAdapterCapabilities,
  TAdapterError = unknown,
> {
  readonly id: TChatId;
  readonly capabilities: TCapabilities;
  open(
    context: OpenChatAdapterContext,
  ): Promise<
    Result<
      OpenedChatAdapter<TChatId, TAdapterOptions, TAdapterData, TCapabilities, TAdapterError>,
      TAdapterError
    >
  >;
}
