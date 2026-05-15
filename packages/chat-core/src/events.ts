import type { ChatCommandRegistry, ChatCommandValueFor } from "./commands";
import type {
  ChatActor,
  ChatAdapterObject,
  ChatConversationRef,
  ChatMessage,
  ChatMessageRef,
  ChatTextInput,
} from "./contracts";

/** Typed subscription API exposed by the chat facade. */
export interface ChatOn<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TChatId extends string = string,
  TReplyResult = unknown,
> {
  <TName extends Extract<keyof TCommands, string>>(
    type: "command",
    commandName: TName,
    handler: ChatEventHandler<ChatCommandEvent<TCommands, TName, TChatId, TReplyResult>>,
  ): Unsubscribe;

  (
    type: "command",
    handler: ChatEventHandler<ChatCommandEvent<TCommands, keyof TCommands, TChatId, TReplyResult>>,
  ): Unsubscribe;

  <TType extends Exclude<ChatEventType, "command">>(
    type: TType,
    handler: ChatEventHandler<ChatEventByType<TType, TCommands, TChatId, TReplyResult>>,
  ): Unsubscribe;
}

/** Event categories emitted by chat-core and adapters. */
export type ChatEventType =
  | "ready"
  | "message"
  | "command"
  | "reaction.added"
  | "reaction.removed"
  | "diagnostic"
  | "error"
  | "closed";

/** Reply intent used by event helpers; adapters choose the native behavior. */
export type ChatReplyMode = "auto" | "thread" | "quote" | "conversation";

/** Optional reply behavior for message and command event helpers. */
export interface ChatEventReplyOptions {
  readonly mode?: ChatReplyMode;
}

/** Bound reply helper attached to inbound events by the facade. */
export type ChatEventReply<TResult = unknown> = (
  message: ChatTextInput,
  options?: ChatEventReplyOptions,
) => Promise<TResult>;

/** Emitted when an adapter runtime is ready to receive traffic. */
export interface ChatReadyEvent<TChatId extends string = string> {
  readonly type: "ready";
  readonly chatId: TChatId;
}

/** Normal message received from a watched conversation. */
export interface ChatMessageEvent<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
  TReplyResult = unknown,
> {
  readonly type: "message";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessage<TChatId, TAdapterData>;
  readonly reply: ChatEventReply<TReplyResult>;
}

type ChatCommandInvocation<
  TCommands extends ChatCommandRegistry,
  TName extends keyof TCommands = keyof TCommands,
> = {
  readonly [TCommandName in TName]: ChatCommandValueFor<TCommands, TCommandName>;
}[TName];

/** Normalized command invocation, typed from the registered command map. */
export interface ChatCommandEvent<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TName extends keyof TCommands = keyof TCommands,
  TChatId extends string = string,
  TReplyResult = unknown,
> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly message?: ChatMessageRef<TChatId>;
  readonly command: ChatCommandInvocation<TCommands, TName>;
  readonly reply: ChatEventReply<TReplyResult>;
}

/** Reaction added to a message the adapter can observe. */
export interface ChatReactionAddedEvent<TChatId extends string = string> {
  readonly type: "reaction.added";
  readonly chatId: TChatId;
  readonly message: ChatMessageRef<TChatId>;
  readonly actor?: ChatActor;
  readonly reaction: string;
}

/** Reaction removed from a message the adapter can observe. */
export interface ChatReactionRemovedEvent<TChatId extends string = string> {
  readonly type: "reaction.removed";
  readonly chatId: TChatId;
  readonly message: ChatMessageRef<TChatId>;
  readonly actor?: ChatActor;
  readonly reaction: string;
}

export type ChatDiagnosticLevel = "debug" | "info" | "warn" | "error";

/** Non-fatal operational note for logs and observability. */
export interface ChatDiagnosticEvent<TChatId extends string = string> {
  readonly type: "diagnostic";
  readonly chatId?: TChatId;
  readonly level: ChatDiagnosticLevel;
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

/** Runtime failure not tied to a returned Result. */
export interface ChatErrorEvent<TChatId extends string = string> {
  readonly type: "error";
  readonly chatId?: TChatId;
  readonly error: unknown;
}

/** Emitted when an adapter runtime has closed. */
export interface ChatClosedEvent<TChatId extends string = string> {
  readonly type: "closed";
  readonly chatId: TChatId;
  readonly cause?: unknown;
}

/** Any normalized event consumers can subscribe to. */
export type ChatEvent<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TChatId extends string = string,
  TReplyResult = unknown,
> =
  | ChatReadyEvent<TChatId>
  | ChatMessageEvent<TChatId, ChatAdapterObject, TReplyResult>
  | ChatCommandEvent<TCommands, keyof TCommands, TChatId, TReplyResult>
  | ChatReactionAddedEvent<TChatId>
  | ChatReactionRemovedEvent<TChatId>
  | ChatDiagnosticEvent<TChatId>
  | ChatErrorEvent<TChatId>
  | ChatClosedEvent<TChatId>;

export type ChatEventByType<
  TType extends ChatEventType,
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TChatId extends string = string,
  TReplyResult = unknown,
> = Extract<ChatEvent<TCommands, TChatId, TReplyResult>, { readonly type: TType }>;

/** Removes a previously registered event handler. */
export type Unsubscribe = () => void;

/** Consumer callback for one normalized chat event. */
export type ChatEventHandler<TEvent extends ChatEvent = ChatEvent> = (
  event: TEvent,
) => void | Promise<void>;
