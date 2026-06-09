import type { ChatAdapterCapabilities } from "../capabilities";
import type { ChatAdapterDefinition } from "./definition";
import type {
  ChatAdapterObject,
  ChatConversationRef,
  ChatMessage,
  ChatMessageRef,
  ChatSentMessage,
} from "../contracts";

type AnyChatAdapterDefinition = ChatAdapterDefinition<
  string,
  ChatAdapterObject,
  ChatAdapterObject,
  ChatAdapterCapabilities,
  unknown
>;

/** Adapter-specific send/reply options selected by registered chat id. */
export type AdapterOptionsFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> =
  TAdapters[TChatId] extends ChatAdapterDefinition<
    string,
    infer TAdapterOptions extends ChatAdapterObject,
    ChatAdapterObject,
    ChatAdapterCapabilities,
    unknown
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
    infer TAdapterData extends ChatAdapterObject,
    ChatAdapterCapabilities,
    unknown
  >
    ? TAdapterData
    : never;

/** Static capabilities declared by a registered chat adapter. */
export type AdapterCapabilitiesFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> =
  TAdapters[TChatId] extends ChatAdapterDefinition<
    string,
    ChatAdapterObject,
    ChatAdapterObject,
    infer TCapabilities extends ChatAdapterCapabilities,
    unknown
  >
    ? TCapabilities
    : never;

/** Adapter-specific error returned by a registered chat id. */
export type AdapterErrorFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> =
  TAdapters[TChatId] extends ChatAdapterDefinition<
    string,
    ChatAdapterObject,
    ChatAdapterObject,
    ChatAdapterCapabilities,
    infer TAdapterError
  >
    ? TAdapterError
    : never;

/** Adapter registry whose object key must match each adapter's own id. */
export type ChatAdapterDefinitions<TAdapters extends Record<string, AnyChatAdapterDefinition>> = {
  readonly [TChatId in keyof TAdapters]: ChatAdapterDefinition<
    Extract<TChatId, string>,
    AdapterOptionsFor<TAdapters, TChatId>,
    AdapterDataFor<TAdapters, TChatId>,
    AdapterCapabilitiesFor<TAdapters, TChatId>,
    AdapterErrorFor<TAdapters, TChatId>
  >;
};

/** Adapter data map keyed by registered chat id. */
export type ChatEventAdapterData<TChatId extends string = string> = {
  readonly [TCurrentChatId in TChatId]: ChatAdapterObject;
};

/** Adapter options map keyed by registered chat id. */
export type ChatEventAdapterOptions<TChatId extends string = string> = {
  readonly [TCurrentChatId in TChatId]: ChatAdapterObject;
};

/** Adapter error map keyed by registered chat id. */
export type ChatEventAdapterError<TChatId extends string = string> = {
  readonly [TCurrentChatId in TChatId]: unknown;
};

export type AdapterDataByChatId<TAdapters extends ChatAdapterDefinitions<TAdapters>> = {
  readonly [TChatId in Extract<keyof TAdapters, string>]: AdapterDataFor<TAdapters, TChatId>;
};

export type AdapterOptionsByChatId<TAdapters extends ChatAdapterDefinitions<TAdapters>> = {
  readonly [TChatId in Extract<keyof TAdapters, string>]: AdapterOptionsFor<TAdapters, TChatId>;
};

export type AdapterErrorByChatId<TAdapters extends ChatAdapterDefinitions<TAdapters>> = {
  readonly [TChatId in Extract<keyof TAdapters, string>]: AdapterErrorFor<TAdapters, TChatId>;
};

/** Extracts the chat id from a normalized conversation reference. */
export type ChatIdFromConversation<TConversation extends ChatConversationRef> =
  TConversation["chatId"];

/** Extracts the chat id from a normalized message reference. */
export type ChatIdFromMessageRef<TMessageRef extends ChatMessageRef> = TMessageRef["chatId"];

/** Extracts adapter metadata from a received message. */
export type AdapterDataFromMessage<TMessage extends ChatMessage> = TMessage["adapterData"];

/** Extracts adapter metadata from a sent message. */
export type AdapterDataFromSentMessage<TMessage extends ChatSentMessage> = TMessage["adapterData"];
