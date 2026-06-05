import type { Result } from "better-result";
import type { ChatCommandRegistry } from "./commands";
import type {
  ChatActionContent,
  ChatButton,
  ChatConversationRef,
  ChatAdapterObject,
  ChatMessageRef,
  ChatSentMessage,
  ChatTextContent,
  ChatTextInput,
  ChatTextStreamContent,
} from "./contracts";
import type { ChatAdapterEvent, ChatDiagnosticEvent } from "./events";
import type { ChatReplyMode, ChatTypingAction } from "./types";

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
  TAdapterError = unknown,
  TCapabilities extends ChatAdapterCapabilities = ChatAdapterCapabilities,
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
> = OpenedChatAdapterBase<TChatId, TAdapterOptions, TAdapterData, TAdapterError, TCapabilities> &
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

/** Runtime feature map used for diagnostics and safe facade decisions. */
export interface ChatAdapterCapabilities {
  readonly commands?: {
    readonly registration: "dynamic" | "manual" | "none";
    readonly options: boolean;
    readonly choices: boolean;
    readonly autocomplete: boolean;
  };
  readonly messages: {
    readonly send: true;
    readonly reply: boolean;
    readonly edit: boolean;
    readonly delete: boolean;
    readonly typing: boolean;
    readonly markdown: boolean;
    readonly attachments: boolean;
    readonly stream?: {
      readonly send: boolean;
      readonly reply: boolean;
      readonly strategy: "native" | "edit" | "chunked";
    };
  };
  readonly reactions?: {
    readonly receive: boolean;
    readonly send: boolean;
  };
  readonly actions?: {
    readonly send: boolean;
    readonly receive: boolean;
    readonly ack: boolean;
    readonly reply: boolean;
    readonly update: boolean;
    readonly urlButtons: boolean;
    readonly maxButtonsPerMessage?: number;
    readonly maxButtonsPerRow?: number;
  };
}

/** Inputs available while an adapter creates SDK clients or other resources. */
export interface OpenChatAdapterContext {
  readonly signal?: AbortSignal;
}

/** Diagnostic input adapters use for non-fatal operational notes. */
export type ChatAdapterDiagnosticInput<TChatId extends string = string> = Omit<
  ChatDiagnosticEvent<TChatId>,
  "type"
>;

/** Emits normalized adapter events into the chat facade. */
export type ChatAdapterEmit<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> = (
  event: ChatAdapterEvent<TCommands, TChatId, { readonly [TKey in TChatId]: TAdapterData }>,
) => void;

/** Context passed when an opened adapter connects to its platform. */
export interface ChatAdapterStartContext<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly commands: TCommands;
  readonly emit: ChatAdapterEmit<TCommands, TChatId, TAdapterData>;
  readonly diagnostic: (diagnostic: ChatAdapterDiagnosticInput<TChatId>) => void;
  readonly signal?: AbortSignal;
}

/** Common outbound message input every adapter receives. */
export interface ChatAdapterSendMessageInput<
  TChatId extends string = string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
>
  extends ChatConversationRef<TChatId>, ChatTextContent {
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Outbound action message input every adapter receives. */
export interface ChatAdapterSendActionInput<
  TChatId extends string = string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
>
  extends ChatConversationRef<TChatId>, ChatActionContent {
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

export type ChatAdapterActionResponse =
  | {
      readonly kind: "ack";
      readonly text?: string;
      readonly showAlert?: boolean;
    }
  | {
      readonly kind: "reply";
      readonly message: ChatTextInput;
    }
  | {
      readonly kind: "update";
      readonly message?: ChatTextInput;
      readonly buttons?: readonly (readonly ChatButton[])[];
    };

/** Adapter-owned response to one previously received action click. */
export interface ChatAdapterRespondToActionInput<
  TChatId extends string = string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> extends ChatConversationRef<TChatId> {
  readonly interactionId: string;
  readonly message: ChatMessageRef<TChatId>;
  readonly response: ChatAdapterActionResponse;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Reply input with the original message target and requested behavior. */
export interface ChatAdapterReplyInput<
  TChatId extends string = string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> extends ChatAdapterSendMessageInput<TChatId, TAdapterOptions> {
  readonly message?: ChatMessageRef<TChatId>;
  readonly mode?: ChatReplyMode;
}

/** One typing/status pulse sent to an adapter for a conversation. */
export interface ChatAdapterSendTypingInput<
  TChatId extends string = string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> extends ChatConversationRef<TChatId> {
  readonly message?: ChatMessageRef<TChatId>;
  readonly action: ChatTypingAction;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Common outbound streamed message input every streaming adapter receives. */
export interface ChatAdapterStreamMessageInput<
  TChatId extends string = string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> extends ChatConversationRef<TChatId> {
  readonly content: ChatTextStreamContent;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Stream reply input with the original message target and requested behavior. */
export interface ChatAdapterStreamReplyInput<
  TChatId extends string = string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> extends ChatAdapterStreamMessageInput<TChatId, TAdapterOptions> {
  readonly message?: ChatMessageRef<TChatId>;
  readonly mode?: ChatReplyMode;
}
