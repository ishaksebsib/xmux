import type { ChatCommandRegistry } from "../registry/commands";
import type {
  ChatActionContent,
  ChatButton,
  ChatConversationRef,
  ChatAdapterObject,
  ChatMessageRef,
  ChatTextContent,
  ChatTextInput,
  ChatTextStreamContent,
} from "../contracts";
import type { ChatAdapterEvent, ChatDiagnosticEvent } from "../events/types";
import type { ChatReplyMode, ChatTypingAction } from "../contracts";

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
  TAdapterError = unknown,
> = (
  event: ChatAdapterEvent<
    TCommands,
    TChatId,
    { readonly [TKey in TChatId]: TAdapterData },
    { readonly [TKey in TChatId]: TAdapterError }
  >,
) => void;

/** Context passed when an opened adapter connects to its platform. */
export interface ChatAdapterStartContext<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
  TAdapterError = unknown,
> {
  readonly commands: TCommands;
  readonly emit: ChatAdapterEmit<TCommands, TChatId, TAdapterData, TAdapterError>;
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
