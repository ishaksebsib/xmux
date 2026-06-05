import type { Result } from "better-result";
import type { ChatActionRegistry, ChatActionValuesFor } from "./actions";
import type { ChatCommandRegistry, ChatCommandValueFor } from "./commands";
import type {
  ChatActor,
  ChatAdapterObject,
  ChatButton,
  ChatConversationRef,
  ChatMessage,
  ChatMessageRef,
  ChatStreamFallback,
  ChatTextInput,
  ChatTextStreamContent,
} from "./contracts";
import type {
  AdapterOptionsProp,
  ChatEventAdapterData,
  ChatEventAdapterOptions,
  ChatReplyMode,
  ChatTypingIndicatorBehavior,
  ChatTypingIndicatorFallback,
  ChatTypingIndicatorHandle,
  RequiredKeys,
} from "./types";
import type { ChatTypingIndicatorFailure } from "./errors";

/** Typed subscription API exposed by the chat facade. */
export interface ChatOn<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TActions extends ChatActionRegistry = ChatActionRegistry,
  TChatId extends string = string,
  TReplyResult = unknown,
  TAdapterDataByChatId extends ChatEventAdapterData<TChatId> = ChatEventAdapterData<TChatId>,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId> =
    ChatEventAdapterOptions<TChatId>,
> {
  <TActionId extends Extract<keyof TActions, string>>(
    type: "action",
    actionId: TActionId,
    handler: ChatEventHandler<
      ChatActionEventFor<TActions, TActionId, TChatId, TReplyResult, TAdapterOptionsByChatId>
    >,
  ): Unsubscribe;

  (
    type: "action",
    handler: ChatEventHandler<
      ChatActionEventFor<TActions, keyof TActions, TChatId, TReplyResult, TAdapterOptionsByChatId>
    >,
  ): Unsubscribe;

  <TName extends Extract<keyof TCommands, string>>(
    type: "command",
    commandName: TName,
    handler: ChatEventHandler<
      ChatCommandEventFor<TCommands, TName, TChatId, TReplyResult, TAdapterOptionsByChatId>
    >,
  ): Unsubscribe;

  (
    type: "command",
    handler: ChatEventHandler<
      ChatCommandEventFor<
        TCommands,
        keyof TCommands,
        TChatId,
        TReplyResult,
        TAdapterOptionsByChatId
      >
    >,
  ): Unsubscribe;

  <TType extends Exclude<ChatEventType, "command" | "action">>(
    type: TType,
    handler: ChatEventHandler<
      ChatEventByType<
        TType,
        TCommands,
        TActions,
        TChatId,
        TReplyResult,
        TAdapterDataByChatId,
        TAdapterOptionsByChatId
      >
    >,
  ): Unsubscribe;
}

/** Event categories emitted by chat-core and adapters. */
export type ChatEventType =
  | "ready"
  | "message"
  | "command"
  | "command.invalid"
  | "command.unknown"
  | "action"
  | "reaction.added"
  | "reaction.removed"
  | "diagnostic"
  | "error"
  | "closed";

/** Optional reply behavior for message and command event helpers. */
export type ChatEventReplyOptions<
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = {
  readonly mode?: ChatReplyMode;
} & AdapterOptionsProp<TAdapterOptions>;

/** Optional stream reply behavior for message and command event helpers. */
export type ChatEventReplyStreamOptions<
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = {
  readonly mode?: ChatReplyMode;
  readonly fallback?: ChatStreamFallback;
} & AdapterOptionsProp<TAdapterOptions>;

/** Bound reply helper attached to inbound events by the facade. */
export type ChatEventReply<
  TResult = unknown,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = [RequiredKeys<TAdapterOptions>] extends [never]
  ? (message: ChatTextInput, options?: ChatEventReplyOptions<TAdapterOptions>) => Promise<TResult>
  : (message: ChatTextInput, options: ChatEventReplyOptions<TAdapterOptions>) => Promise<TResult>;

/** Bound stream reply helper attached to inbound events by the facade. */
export type ChatEventReplyStream<
  TResult = unknown,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = [RequiredKeys<TAdapterOptions>] extends [never]
  ? (
      content: ChatTextStreamContent,
      options?: ChatEventReplyStreamOptions<TAdapterOptions>,
    ) => Promise<TResult>
  : (
      content: ChatTextStreamContent,
      options: ChatEventReplyStreamOptions<TAdapterOptions>,
    ) => Promise<TResult>;

export type ChatEventTypingIndicatorOptions<
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = {
  readonly fallback?: ChatTypingIndicatorFallback;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<TAdapterOptions> &
  ChatTypingIndicatorBehavior;

export type ChatEventTypingIndicatorResult<TOptions> = TOptions extends {
  readonly mode: "managed";
}
  ? ChatTypingIndicatorHandle
  : void;

/** Bound typing indicator helper attached to inbound events by the facade. */
export type ChatEventTypingIndicator<
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = [RequiredKeys<TAdapterOptions>] extends [never]
  ? <TOptions extends ChatEventTypingIndicatorOptions<TAdapterOptions> | undefined = undefined>(
      options?: TOptions,
    ) => Promise<Result<ChatEventTypingIndicatorResult<TOptions>, ChatTypingIndicatorFailure>>
  : <TOptions extends ChatEventTypingIndicatorOptions<TAdapterOptions>>(
      options: TOptions,
    ) => Promise<Result<ChatEventTypingIndicatorResult<TOptions>, ChatTypingIndicatorFailure>>;

export type ChatActionAckOptions<TAdapterOptions extends ChatAdapterObject = Record<never, never>> =
  {
    readonly text?: string;
    readonly showAlert?: boolean;
  } & AdapterOptionsProp<TAdapterOptions>;

export type ChatActionUpdateOptions<
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = {
  readonly message?: ChatTextInput;
  readonly buttons?: readonly (readonly ChatButton[])[];
} & AdapterOptionsProp<TAdapterOptions>;

export type ChatActionAck<
  TResult = unknown,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = [RequiredKeys<TAdapterOptions>] extends [never]
  ? (options?: ChatActionAckOptions<TAdapterOptions>) => Promise<TResult>
  : (options: ChatActionAckOptions<TAdapterOptions>) => Promise<TResult>;

export type ChatActionReply<
  TResult = unknown,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = [RequiredKeys<TAdapterOptions>] extends [never]
  ? (message: ChatTextInput, options?: AdapterOptionsProp<TAdapterOptions>) => Promise<TResult>
  : (message: ChatTextInput, options: AdapterOptionsProp<TAdapterOptions>) => Promise<TResult>;

export type ChatActionUpdate<
  TResult = unknown,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = [RequiredKeys<TAdapterOptions>] extends [never]
  ? (options?: ChatActionUpdateOptions<TAdapterOptions>) => Promise<TResult>
  : (options: ChatActionUpdateOptions<TAdapterOptions>) => Promise<TResult>;

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
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> {
  readonly type: "message";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessage<TChatId, TAdapterData>;
  readonly reply: ChatEventReply<TReplyResult, TAdapterOptions>;
  readonly replyStream: ChatEventReplyStream<TReplyResult, TAdapterOptions>;
  readonly typingIndicator: ChatEventTypingIndicator<TAdapterOptions>;
}

/** Message event selected by registered chat id so adapter data/options stay typed. */
export type ChatMessageEventFor<
  TChatId extends string,
  TAdapterDataByChatId extends ChatEventAdapterData<TChatId>,
  TReplyResult = unknown,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId> =
    ChatEventAdapterOptions<TChatId>,
> = {
  readonly [TCurrentChatId in TChatId]: ChatMessageEvent<
    TCurrentChatId,
    TAdapterDataByChatId[TCurrentChatId],
    TReplyResult,
    TAdapterOptionsByChatId[TCurrentChatId]
  >;
}[TChatId];

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
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly message?: ChatMessageRef<TChatId>;
  readonly command: ChatCommandInvocation<TCommands, TName>;
  readonly reply: ChatEventReply<TReplyResult, TAdapterOptions>;
  readonly replyStream: ChatEventReplyStream<TReplyResult, TAdapterOptions>;
  readonly typingIndicator: ChatEventTypingIndicator<TAdapterOptions>;
}

/** Command event selected by registered chat id so reply options stay typed. */
export type ChatCommandEventFor<
  TCommands extends ChatCommandRegistry,
  TName extends keyof TCommands,
  TChatId extends string,
  TReplyResult = unknown,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId> =
    ChatEventAdapterOptions<TChatId>,
> = {
  readonly [TCurrentChatId in TChatId]: ChatCommandEvent<
    TCommands,
    TName,
    TCurrentChatId,
    TReplyResult,
    TAdapterOptionsByChatId[TCurrentChatId]
  >;
}[TChatId];

/** Command-like input that targeted a known command but failed validation/parsing. */
export interface ChatInvalidCommandEvent<
  TChatId extends string = string,
  TReplyResult = unknown,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> {
  readonly type: "command.invalid";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly message?: ChatMessageRef<TChatId>;
  readonly commandName: string;
  readonly reason: string;
  readonly optionName?: string;
  readonly reply: ChatEventReply<TReplyResult, TAdapterOptions>;
  readonly replyStream: ChatEventReplyStream<TReplyResult, TAdapterOptions>;
  readonly typingIndicator: ChatEventTypingIndicator<TAdapterOptions>;
}

/** Invalid command event selected by registered chat id so reply options stay typed. */
export type ChatInvalidCommandEventFor<
  TChatId extends string,
  TReplyResult = unknown,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId> =
    ChatEventAdapterOptions<TChatId>,
> = {
  readonly [TCurrentChatId in TChatId]: ChatInvalidCommandEvent<
    TCurrentChatId,
    TReplyResult,
    TAdapterOptionsByChatId[TCurrentChatId]
  >;
}[TChatId];

/** Slash command input that targeted no registered command. */
export interface ChatUnknownCommandEvent<
  TChatId extends string = string,
  TReplyResult = unknown,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> {
  readonly type: "command.unknown";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly message?: ChatMessageRef<TChatId>;
  readonly commandName: string;
  readonly reply: ChatEventReply<TReplyResult, TAdapterOptions>;
  readonly replyStream: ChatEventReplyStream<TReplyResult, TAdapterOptions>;
  readonly typingIndicator: ChatEventTypingIndicator<TAdapterOptions>;
}

/** Unknown command event selected by registered chat id so reply options stay typed. */
export type ChatUnknownCommandEventFor<
  TChatId extends string,
  TReplyResult = unknown,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId> =
    ChatEventAdapterOptions<TChatId>,
> = {
  readonly [TCurrentChatId in TChatId]: ChatUnknownCommandEvent<
    TCurrentChatId,
    TReplyResult,
    TAdapterOptionsByChatId[TCurrentChatId]
  >;
}[TChatId];

type ChatActionInvocation<
  TActions extends ChatActionRegistry,
  TActionId extends keyof TActions = keyof TActions,
> = {
  readonly [TCurrentActionId in TActionId]: ChatActionValuesFor<TActions, TCurrentActionId>;
}[TActionId];

/** Button action received from an adapter with bound response helpers. */
export type ChatActionEvent<
  TActions extends ChatActionRegistry = ChatActionRegistry,
  TActionId extends keyof TActions = keyof TActions,
  TChatId extends string = string,
  TReplyResult = unknown,
  TAdapterOptions extends ChatAdapterObject = Record<never, never>,
> = ChatActionInvocation<TActions, TActionId> & {
  readonly type: "action";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessageRef<TChatId>;
  readonly interactionId: string;
  readonly actor?: ChatActor;
  readonly ack: ChatActionAck<TReplyResult, TAdapterOptions>;
  readonly reply: ChatActionReply<TReplyResult, TAdapterOptions>;
  readonly update: ChatActionUpdate<TReplyResult, TAdapterOptions>;
};

/** Action event selected by action id and registered chat id. */
export type ChatActionEventFor<
  TActions extends ChatActionRegistry,
  TActionId extends keyof TActions,
  TChatId extends string,
  TReplyResult = unknown,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId> =
    ChatEventAdapterOptions<TChatId>,
> = {
  readonly [TCurrentChatId in TChatId]: ChatActionEvent<
    TActions,
    TActionId,
    TCurrentChatId,
    TReplyResult,
    TAdapterOptionsByChatId[TCurrentChatId]
  >;
}[TChatId];

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
  TActions extends ChatActionRegistry = ChatActionRegistry,
  TChatId extends string = string,
  TReplyResult = unknown,
  TAdapterDataByChatId extends ChatEventAdapterData<TChatId> = ChatEventAdapterData<TChatId>,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId> =
    ChatEventAdapterOptions<TChatId>,
> =
  | ChatReadyEvent<TChatId>
  | ChatMessageEventFor<TChatId, TAdapterDataByChatId, TReplyResult, TAdapterOptionsByChatId>
  | ChatCommandEventFor<TCommands, keyof TCommands, TChatId, TReplyResult, TAdapterOptionsByChatId>
  | ChatInvalidCommandEventFor<TChatId, TReplyResult, TAdapterOptionsByChatId>
  | ChatUnknownCommandEventFor<TChatId, TReplyResult, TAdapterOptionsByChatId>
  | ChatActionEventFor<TActions, keyof TActions, TChatId, TReplyResult, TAdapterOptionsByChatId>
  | ChatReactionAddedEvent<TChatId>
  | ChatReactionRemovedEvent<TChatId>
  | ChatDiagnosticEvent<TChatId>
  | ChatErrorEvent<TChatId>
  | ChatClosedEvent<TChatId>;

/** Message event shape adapters emit before chat-core binds reply(). */
export type ChatAdapterMessageEvent<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = Record<never, never>,
> = Omit<ChatMessageEvent<TChatId, TAdapterData>, "reply" | "replyStream" | "typingIndicator">;

/** Message adapter event selected by registered chat id. */
export type ChatAdapterMessageEventFor<
  TChatId extends string,
  TAdapterDataByChatId extends ChatEventAdapterData<TChatId>,
> = {
  readonly [TCurrentChatId in TChatId]: ChatAdapterMessageEvent<
    TCurrentChatId,
    TAdapterDataByChatId[TCurrentChatId]
  >;
}[TChatId];

/** Command event shape adapters emit before chat-core binds reply(). */
export type ChatAdapterCommandEvent<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TName extends keyof TCommands = keyof TCommands,
  TChatId extends string = string,
> = Omit<ChatCommandEvent<TCommands, TName, TChatId>, "reply" | "replyStream" | "typingIndicator">;

/** Invalid command adapter event before chat-core binds reply(). */
export type ChatAdapterInvalidCommandEvent<TChatId extends string = string> = Omit<
  ChatInvalidCommandEvent<TChatId>,
  "reply" | "replyStream" | "typingIndicator"
>;

/** Unknown command adapter event before chat-core binds reply(). */
export type ChatAdapterUnknownCommandEvent<TChatId extends string = string> = Omit<
  ChatUnknownCommandEvent<TChatId>,
  "reply" | "replyStream" | "typingIndicator"
>;

/** Action event shape adapters emit before chat-core binds action response helpers. */
export interface ChatAdapterActionEvent<TChatId extends string = string> {
  readonly type: "action";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessageRef<TChatId>;
  readonly interactionId: string;
  readonly actor?: ChatActor;
  readonly actionId: string;
  readonly value: string;
  readonly payload?: unknown;
}

/** Event shape accepted from adapters during runtime. */
export type ChatAdapterEvent<
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TChatId extends string = string,
  TAdapterDataByChatId extends ChatEventAdapterData<TChatId> = ChatEventAdapterData<TChatId>,
> =
  | ChatAdapterMessageEventFor<TChatId, TAdapterDataByChatId>
  | ChatAdapterCommandEvent<TCommands, keyof TCommands, TChatId>
  | ChatAdapterInvalidCommandEvent<TChatId>
  | ChatAdapterUnknownCommandEvent<TChatId>
  | ChatAdapterActionEvent<TChatId>
  | ChatReactionAddedEvent<TChatId>
  | ChatReactionRemovedEvent<TChatId>
  | ChatDiagnosticEvent<TChatId>
  | ChatErrorEvent<TChatId>
  | ChatClosedEvent<TChatId>;

export type ChatEventByType<
  TType extends ChatEventType,
  TCommands extends ChatCommandRegistry = ChatCommandRegistry,
  TActions extends ChatActionRegistry = ChatActionRegistry,
  TChatId extends string = string,
  TReplyResult = unknown,
  TAdapterDataByChatId extends ChatEventAdapterData<TChatId> = ChatEventAdapterData<TChatId>,
  TAdapterOptionsByChatId extends ChatEventAdapterOptions<TChatId> =
    ChatEventAdapterOptions<TChatId>,
> = Extract<
  ChatEvent<
    TCommands,
    TActions,
    TChatId,
    TReplyResult,
    TAdapterDataByChatId,
    TAdapterOptionsByChatId
  >,
  { readonly type: TType }
>;

/** Removes a previously registered event handler. */
export type Unsubscribe = () => void;

/** Consumer callback for one normalized chat event. */
export type ChatEventHandler<TEvent = ChatEvent> = (event: TEvent) => void | Promise<void>;
