/** Adapter-owned JSON-like metadata kept typed but opaque to chat-core. */
export type ChatAdapterObject = Record<string, unknown>;

/** Text rendering intent; adapters may downgrade unsupported formats. */
export type ChatMessageFormat = "plain" | "markdown" | "html";

/** Normalized destination identity shared by every chat adapter. */
export interface ChatConversationRef<TChatId extends string = string> {
  readonly chatId: TChatId;
  readonly conversationId: string;
  // TODO: support threadId later
}

/** Normalized message identity inside a conversation. */
export interface ChatMessageRef<
  TChatId extends string = string,
> extends ChatConversationRef<TChatId> {
  readonly messageId: string;
}

/** Human sender identity normalized across platforms. */
export interface ChatUserActor<TAdapterData extends ChatAdapterObject = Record<never, never>> {
  readonly kind: "user";
  readonly actorId: string;
  readonly displayName?: string;
  readonly adapterData: TAdapterData;
}

/** Bot sender identity, including the current bot when platforms expose it. */
export interface ChatBotActor<TAdapterData extends ChatAdapterObject = Record<never, never>> {
  readonly kind: "bot";
  readonly actorId: string;
  readonly displayName?: string;
  readonly adapterData: TAdapterData;
}

/** Platform/system sender for messages not authored by a normal user or bot. */
export interface ChatSystemActor<TAdapterData extends ChatAdapterObject = Record<never, never>> {
  readonly kind: "system";
  readonly actorId?: string;
  readonly displayName?: string;
  readonly adapterData: TAdapterData;
}

/** Normalized sender identity for received chat messages. */
export type ChatActor<TAdapterData extends ChatAdapterObject = Record<never, never>> =
  | ChatUserActor<TAdapterData>
  | ChatBotActor<TAdapterData>
  | ChatSystemActor<TAdapterData>;

/** Text payload shared by inbound and outbound messages. */
export interface ChatTextContent {
  readonly text: string;
  readonly format?: ChatMessageFormat;
}

/** Convenience input accepted by send/reply APIs. */
export type ChatTextInput = string | ChatTextContent;

/** Message received from an adapter with normalized identity and typed metadata. */
export interface ChatMessage<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
>
  extends ChatMessageRef<TChatId>, ChatTextContent {
  readonly actor: ChatActor;
  readonly adapterData: TAdapterData;
}

/** Message returned after a successful outbound send/reply operation. */
export interface ChatSentMessage<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
>
  extends ChatMessageRef<TChatId>, ChatTextContent {
  readonly adapterData: TAdapterData;
}
