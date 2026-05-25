import type { ChatAdapterDefinition } from "./adapter";
import type {
  ChatAdapterObject,
  ChatConversationRef,
  ChatMessage,
  ChatMessageFormat,
  ChatMessageRef,
  ChatSentMessage,
  ChatStreamFallback,
  ChatTextStreamContent,
} from "./contracts";
import type { ChatAdapterCapabilities } from "./adapter";

type AnyChatAdapterDefinition = ChatAdapterDefinition<
  string,
  ChatAdapterObject,
  ChatAdapterObject,
  ChatAdapterCapabilities
>;

export type RequiredKeys<TValue extends ChatAdapterObject> = {
  [TKey in keyof TValue]-?: {} extends Pick<TValue, TKey> ? never : TKey;
}[keyof TValue];

export type AdapterOptionsProp<TAdapterOptions extends ChatAdapterObject> = [
  RequiredKeys<TAdapterOptions>,
] extends [never]
  ? { readonly adapterOptions?: TAdapterOptions }
  : { readonly adapterOptions: TAdapterOptions };

/** Reply intent used by event helpers and facade replies. */
export type ChatReplyMode = "auto" | "thread" | "quote" | "conversation";

/** Typing/status action adapters can expose as a platform-native indicator. */
export type ChatTypingAction = "typing";

/**
 * Public typing indicator behavior.
 *
 * `pulse` sends one short-lived platform typing action and returns after that
 * adapter call. `managed` sends an initial pulse, refreshes it until stopped,
 * and returns a handle whose `stop()` method cancels future refreshes.
 */
export type ChatTypingIndicatorMode = "pulse" | "managed";

/** Behavior when a typing indicator is not supported by the selected adapter. */
export type ChatTypingIndicatorFallback = "error" | "ignore";

/** Handle returned by managed typing indicators. */
export interface ChatTypingIndicatorHandle {
  /** Stops refreshing future typing pulses. The current platform pulse expires naturally. */
  stop(): void;
}

export type ChatTypingIndicatorResult<TInput> = TInput extends { readonly mode: "managed" }
  ? ChatTypingIndicatorHandle
  : void;

/** Shared pulse-vs-managed behavior for facade and event typing helpers. */
export type ChatTypingIndicatorBehavior =
  | {
      /**
       * Sends exactly one typing indicator pulse.
       *
       * Use this when the caller owns its own refresh timing or only needs a
       * short-lived indicator. The visible duration is platform-specific; for
       * example, Telegram expires a typing pulse after roughly five seconds.
       */
      readonly mode?: "pulse";
    }
  | {
      /**
       * Sends an initial pulse and keeps refreshing until stopped or timed out.
       *
       * `stop()` cancels future refresh pulses, but most platforms do not offer
       * a native "clear typing now" API; the last sent pulse expires naturally.
       */
      readonly mode: "managed";
      /** Maximum lifetime for the refresh loop. Defaults to a safe finite timeout. */
      readonly timeoutMs?: number;
      /** Delay between refresh pulses. Keep below the platform pulse TTL. */
      readonly refreshIntervalMs?: number;
    };

/** Adapter data map keyed by registered chat id. */
export type ChatEventAdapterData<TChatId extends string = string> = {
  readonly [TCurrentChatId in TChatId]: ChatAdapterObject;
};

/** Adapter options map keyed by registered chat id. */
export type ChatEventAdapterOptions<TChatId extends string = string> = {
  readonly [TCurrentChatId in TChatId]: ChatAdapterObject;
};

export type AdapterDataByChatId<TAdapters extends ChatAdapterDefinitions<TAdapters>> = {
  readonly [TChatId in Extract<keyof TAdapters, string>]: AdapterDataFor<TAdapters, TChatId>;
};

export type AdapterOptionsByChatId<TAdapters extends ChatAdapterDefinitions<TAdapters>> = {
  readonly [TChatId in Extract<keyof TAdapters, string>]: AdapterOptionsFor<TAdapters, TChatId>;
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

/** Adapter-specific send/reply options selected by registered chat id. */
export type AdapterOptionsFor<
  TAdapters extends Record<string, AnyChatAdapterDefinition>,
  TChatId extends keyof TAdapters,
> =
  TAdapters[TChatId] extends ChatAdapterDefinition<
    string,
    infer TAdapterOptions extends ChatAdapterObject,
    ChatAdapterObject,
    ChatAdapterCapabilities
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
    ChatAdapterCapabilities
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
    infer TCapabilities extends ChatAdapterCapabilities
  >
    ? TCapabilities
    : never;

/** Adapter registry whose object key must match each adapter's own id. */
export type ChatAdapterDefinitions<TAdapters extends Record<string, AnyChatAdapterDefinition>> = {
  readonly [TChatId in keyof TAdapters]: ChatAdapterDefinition<
    Extract<TChatId, string>,
    AdapterOptionsFor<TAdapters, TChatId>,
    AdapterDataFor<TAdapters, TChatId>,
    AdapterCapabilitiesFor<TAdapters, TChatId>
  >;
};

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
