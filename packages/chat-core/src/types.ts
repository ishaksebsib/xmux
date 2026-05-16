import type { ChatAdapterDefinition } from "./adapter";
import type { ChatReplyMode } from "./events";
import type {
  ChatAdapterObject,
  ChatConversationRef,
  ChatMessage,
  ChatMessageFormat,
  ChatMessageRef,
  ChatSentMessage,
} from "./contracts";

type AnyChatAdapterDefinition = ChatAdapterDefinition<string, ChatAdapterObject, ChatAdapterObject>;

type RequiredKeys<TValue extends ChatAdapterObject> = {
  [TKey in keyof TValue]-?: {} extends Pick<TValue, TKey> ? never : TKey;
}[keyof TValue];

type AdapterOptionsProp<TAdapterOptions extends ChatAdapterObject> = [
  RequiredKeys<TAdapterOptions>,
] extends [never]
  ? { readonly adapterOptions?: TAdapterOptions }
  : { readonly adapterOptions: TAdapterOptions };

/** Extracts the chat id from a normalized conversation reference. */
export type ChatIdFromConversation<TConversation extends ChatConversationRef> =
  TConversation["chatId"];

/** Extracts the chat id from a normalized message reference. */
export type ChatIdFromMessageRef<TMessageRef extends ChatMessageRef> = TMessageRef["chatId"];

/** Extracts adapter metadata from a received message. */
export type AdapterDataFromMessage<TMessage extends ChatMessage> = TMessage["adapterData"];

/** Extracts adapter metadata from a sent message. */
export type AdapterDataFromSentMessage<TMessage extends ChatSentMessage> = TMessage["adapterData"];

/** Adapter-specific send/reply options selected by registered chat id. */
export type AdapterOptionsFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> =
  TAdapters[TChatId] extends ChatAdapterDefinition<
    string,
    infer TAdapterOptions extends ChatAdapterObject,
    ChatAdapterObject
  >
    ? TAdapterOptions
    : never;

/** Adapter-specific data returned by send/reply for a registered chat id. */
export type AdapterDataFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> =
  TAdapters[TChatId] extends ChatAdapterDefinition<
    string,
    ChatAdapterObject,
    infer TAdapterData extends ChatAdapterObject
  >
    ? TAdapterData
    : never;

/** Adapter registry whose object key must match each adapter's own id. */
export type ChatAdapterDefinitions<TAdapters extends Record<string, AnyChatAdapterDefinition>> = {
  readonly [TChatId in keyof TAdapters]: ChatAdapterDefinition<
    Extract<TChatId, string>,
    AdapterOptionsFor<TAdapters, TChatId>,
    AdapterDataFor<TAdapters, TChatId>
  >;
};

/** Send input narrowed to one registered chat adapter. */
export type ChatSendMessageInputFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> = {
  readonly chatId: Extract<TChatId, string>;
  readonly conversationId: string;
  readonly text: string;
  readonly format?: ChatMessageFormat;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, TChatId>>;

/** Send input union for all registered chat adapters. */
export type ChatSendMessageInput<TAdapters extends Record<string, AnyChatAdapterDefinition>> = {
  readonly [TChatId in keyof TAdapters]: ChatSendMessageInputFor<TAdapters, TChatId>;
}[keyof TAdapters];

/** Sent message result narrowed to one registered chat adapter. */
export type ChatSentMessageFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> = ChatSentMessage<Extract<TChatId, string>, AdapterDataFor<TAdapters, TChatId>>;

/** Sent message result selected from a send/reply input's chat id. */
export type ChatSentMessageFromInput<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TInput,
> = TInput extends { readonly chatId: infer TChatId extends keyof TAdapters }
  ? ChatSentMessageFor<TAdapters, TChatId>
  : never;

/** Reply input narrowed to one registered chat adapter. */
export type ChatReplyInputFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> = {
  readonly chatId: Extract<TChatId, string>;
  readonly conversationId: string;
  readonly messageId?: string;
  readonly text: string;
  readonly format?: ChatMessageFormat;
  readonly mode?: ChatReplyMode;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, TChatId>>;

/** Reply input union for all registered chat adapters. */
export type ChatReplyInput<TAdapters extends Record<string, AnyChatAdapterDefinition>> = {
  readonly [TChatId in keyof TAdapters]: ChatReplyInputFor<TAdapters, TChatId>;
}[keyof TAdapters];
