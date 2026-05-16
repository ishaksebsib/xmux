import type { Result } from "better-result";
import type { ChatCommandRegistry } from "./commands";
import type {
  ChatConversationRef,
  ChatAdapterObject,
  ChatMessageRef,
  ChatSentMessage,
  ChatTextContent,
} from "./contracts";
import type { ChatAdapterEvent, ChatDiagnosticEvent } from "./events";
import type { ChatReplyMode } from "./types";

/** Defines a chat adapter while preserving its id, options, and data types. */
export function defineChatAdapter<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
>(
  adapter: ChatAdapterDefinition<TChatId, TAdapterOptions, TAdapterData>,
): ChatAdapterDefinition<TChatId, TAdapterOptions, TAdapterData> {
  return adapter;
}

/** Live adapter runtime that owns platform resources and connections. */
export interface OpenedChatAdapter<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
> {
  readonly id: TChatId;
  readonly capabilities?: ChatAdapterCapabilities;
  start<TCommands extends ChatCommandRegistry>(
    context: ChatAdapterStartContext<TCommands, TChatId, TAdapterData>,
  ): Promise<Result<void, unknown>>;
  sendMessage(
    input: ChatAdapterSendMessageInput<TChatId, TAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TAdapterData>, unknown>>;
  reply?(
    input: ChatAdapterReplyInput<TChatId, TAdapterOptions>,
  ): Promise<Result<ChatSentMessage<TChatId, TAdapterData>, unknown>>;
  close(): Promise<void>;
}

/** Adapter factory implemented by platform packages such as Discord or Telegram. */
export interface ChatAdapterDefinition<
  TChatId extends string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
> {
  readonly id: TChatId;
  open(
    context: OpenChatAdapterContext,
  ): Promise<Result<OpenedChatAdapter<TChatId, TAdapterOptions, TAdapterData>, unknown>>;
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
  };
  readonly reactions?: {
    readonly receive: boolean;
    readonly send: boolean;
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

/** Reply input with the original message target and requested behavior. */
export interface ChatAdapterReplyInput<
  TChatId extends string = string,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> extends ChatAdapterSendMessageInput<TChatId, TAdapterOptions> {
  readonly message?: ChatMessageRef<TChatId>;
  readonly mode?: ChatReplyMode;
}
