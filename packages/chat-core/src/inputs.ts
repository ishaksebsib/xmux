import type { ChatActionPayloadFor, ChatActionRegistry } from "./registry/actions";
import type { ChatAdapterDefinition } from "./adapter/definition";
import type { ChatAdapterCapabilities } from "./capabilities";
import type {
  AdapterCapabilitiesFor,
  AdapterDataFor,
  AdapterOptionsFor,
} from "./adapter/registry";
import type {
  ChatActionButton,
  ChatAdapterObject,
  ChatMessageFormat,
  ChatReplyMode,
  ChatSentMessage,
  ChatStreamFallback,
  ChatTextStreamContent,
  ChatTypingAction,
  ChatUrlButton,
} from "./contracts";
import type { AdapterOptionsProp } from "./type-utils";

/** `pulse` sends one short-lived typing action; `managed` refreshes until stopped. */
export type ChatTypingIndicatorMode = "pulse" | "managed";

/** Behavior when a typing indicator is not supported by the selected adapter. */
export type ChatTypingIndicatorFallback = "error" | "ignore";

/** Handle returned by managed typing indicators. */
export interface ChatTypingIndicatorHandle {
  stop(): void;
}

export type ChatTypingIndicatorResult<TInput> = TInput extends { readonly mode: "managed" }
  ? ChatTypingIndicatorHandle
  : void;

/** Shared pulse-vs-managed behavior for facade and event typing helpers. */
export type ChatTypingIndicatorBehavior =
  | { readonly mode?: "pulse" }
  | {
      readonly mode: "managed";
      readonly timeoutMs?: number;
      readonly refreshIntervalMs?: number;
    };

type AnyChatAdapterDefinition = ChatAdapterDefinition<
  string,
  ChatAdapterObject,
  ChatAdapterObject,
  ChatAdapterCapabilities,
  unknown
>;

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

type ChatActionButtonPayloadProp<TPayload> = [TPayload] extends [undefined]
  ? { readonly payload?: undefined }
  : { readonly payload: TPayload };

/** Action button input narrowed to one registered action id and value. */
export type ChatActionButtonInputFor<
  TActions extends ChatActionRegistry,
  TActionId extends keyof TActions,
  TValue extends keyof TActions[TActionId]["values"],
> = Omit<ChatActionButton<Extract<TActionId, string>, Extract<TValue, string>>, "payload"> &
  ChatActionButtonPayloadProp<ChatActionPayloadFor<TActions, TActionId, TValue>>;

/** Action button input union inferred from an action registry. */
export type ChatActionButtonInput<TActions extends ChatActionRegistry> = {
  readonly [TActionId in keyof TActions]: {
    readonly [TValue in keyof TActions[TActionId]["values"]]: ChatActionButtonInputFor<
      TActions,
      TActionId,
      TValue
    >;
  }[keyof TActions[TActionId]["values"]];
}[keyof TActions];

/** Button input accepted by action sends. */
export type ChatButtonInput<TActions extends ChatActionRegistry> =
  | ChatActionButtonInput<TActions>
  | ChatUrlButton;

/** Send action input narrowed to one registered chat adapter. */
export type ChatSendActionInputFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TActions extends ChatActionRegistry,
  TChatId extends keyof TAdapters,
> = {
  readonly chatId: Extract<TChatId, string>;
  readonly conversationId: string;
  readonly text: string;
  readonly format?: ChatMessageFormat;
  readonly buttons: readonly (readonly ChatButtonInput<TActions>[])[];
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, TChatId>>;

/** Send action input union for all registered chat adapters. */
export type ChatSendActionInput<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TActions extends ChatActionRegistry,
> = {
  readonly [TChatId in keyof TAdapters]: ChatSendActionInputFor<TAdapters, TActions, TChatId>;
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

/** Typing indicator input narrowed to one registered chat adapter. */
export type ChatTypingIndicatorInputFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> = {
  readonly chatId: Extract<TChatId, string>;
  readonly conversationId: string;
  readonly messageId?: string;
  readonly action?: ChatTypingAction;
  readonly fallback?: ChatTypingIndicatorFallback;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, TChatId>> &
  ChatTypingIndicatorBehavior;

/** Typing indicator input union for all registered chat adapters. */
export type ChatTypingIndicatorInput<TAdapters extends Record<string, AnyChatAdapterDefinition>> = {
  readonly [TChatId in keyof TAdapters]: ChatTypingIndicatorInputFor<TAdapters, TChatId>;
}[keyof TAdapters];

export type ChatStreamFallbackFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
  TKind extends "send" | "reply",
> = AdapterCapabilitiesFor<TAdapters, TChatId>["messages"] extends {
  readonly stream: { readonly [TKey in TKind]: true };
}
  ? ChatStreamFallback
  : Exclude<ChatStreamFallback, "error">;

/** Stream send input narrowed to one registered chat adapter. */
export type ChatStreamMessageInputFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> = {
  readonly chatId: Extract<TChatId, string>;
  readonly conversationId: string;
  readonly content: ChatTextStreamContent;
  readonly fallback?: ChatStreamFallbackFor<TAdapters, TChatId, "send">;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, TChatId>>;

/** Stream send input union for all registered chat adapters. */
export type ChatStreamMessageInput<TAdapters extends Record<string, AnyChatAdapterDefinition>> = {
  readonly [TChatId in keyof TAdapters]: ChatStreamMessageInputFor<TAdapters, TChatId>;
}[keyof TAdapters];

/** Stream reply input narrowed to one registered chat adapter. */
export type ChatStreamReplyInputFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> = {
  readonly chatId: Extract<TChatId, string>;
  readonly conversationId: string;
  readonly messageId?: string;
  readonly content: ChatTextStreamContent;
  readonly fallback?: ChatStreamFallbackFor<TAdapters, TChatId, "reply">;
  readonly mode?: ChatReplyMode;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, TChatId>>;

/** Stream reply input union for all registered chat adapters. */
export type ChatStreamReplyInput<TAdapters extends Record<string, AnyChatAdapterDefinition>> = {
  readonly [TChatId in keyof TAdapters]: ChatStreamReplyInputFor<TAdapters, TChatId>;
}[keyof TAdapters];
