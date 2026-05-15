import type { ChatAdapterDefinition } from "./adapter";
import type {
  ChatAdapterObject,
  ChatConversationRef,
  ChatMessage,
  ChatMessageRef,
  ChatSentMessage,
} from "./contracts";

type AnyChatAdapterDefinition = ChatAdapterDefinition<string, ChatAdapterObject, ChatAdapterObject>;

export type ChatIdFromConversation<TConversation extends ChatConversationRef> =
  TConversation["chatId"];

export type ChatIdFromMessageRef<TMessageRef extends ChatMessageRef> = TMessageRef["chatId"];

export type AdapterDataFromMessage<TMessage extends ChatMessage> = TMessage["adapterData"];

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
