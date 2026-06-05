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

/** JSON-like payload that can be carried by a chat action button. */
export type ChatActionPayload =
  | string
  | number
  | boolean
  | null
  | readonly ChatActionPayload[]
  | { readonly [key: string]: ChatActionPayload };

/** Cross-platform visual intent for native buttons; adapters may downgrade unsupported styles. */
export type ChatActionButtonStyle = "primary" | "secondary" | "success" | "danger";

/** Button that dispatches a typed chat action when pressed. */
export interface ChatActionButton<
  TActionId extends string = string,
  TValue extends string = string,
  TPayload extends ChatActionPayload | undefined = ChatActionPayload | undefined,
> {
  readonly kind?: "action";
  readonly id: string;
  readonly label: string;
  readonly actionId: TActionId;
  readonly value: TValue;
  readonly payload?: TPayload;
  readonly style?: ChatActionButtonStyle;
  readonly disabled?: boolean;
}

/** Button that opens an external URL and does not emit an action event. */
export interface ChatUrlButton {
  readonly kind: "url";
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly disabled?: boolean;
}

/** Any cross-platform button accepted by action messages. */
export type ChatButton = ChatActionButton | ChatUrlButton;

/** Text plus button layout shared by action send/update APIs. */
export interface ChatActionContent extends ChatTextContent {
  readonly buttons: readonly (readonly ChatButton[])[];
}

/** Text stream event consumed by streaming send/reply APIs. */
export type ChatTextStreamChunk =
  | { readonly type: "delta"; readonly delta: string }
  | { readonly type: "snapshot"; readonly text: string }
  | { readonly type: "completed"; readonly text?: string };

/** Streamed text payload shared by outbound streaming APIs. */
export interface ChatTextStreamContent {
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly format?: ChatMessageFormat;
}

/** Behavior when a streaming adapter operation is unavailable. */
export type ChatStreamFallback = "send-message" | "error";

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
