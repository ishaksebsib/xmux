import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Facade operation names used in lifecycle errors. */
export type ChatLifecycleOperation =
  | "start"
  | "close"
  | "sendMessage"
  | "sendAction"
  | "updateAction"
  | "injectMessage"
  | "injectCommand"
  | "respondToAction"
  | "reply"
  | "streamMessage"
  | "streamReply"
  | "typingIndicator";

/**
 * Builds a tagged error class for the common `{ chatId, cause }` adapter failure
 * shape. Each call produces a distinct tag, so `instanceof` and `.is()` stay
 * unique per operation while the constructor/message boilerplate is shared.
 */
function chatCauseError<const TTag extends string>(
  tag: TTag,
  describe: (chatId: string) => string,
) {
  return class extends TaggedError(tag)<{
    readonly chatId: string;
    readonly cause: unknown;
    readonly message: string;
  }>() {
    constructor(args: { readonly chatId: string; readonly cause: unknown }) {
      super({ ...args, message: `${describe(args.chatId)}: ${describeCause(args.cause)}` });
    }
  };
}

/** Wraps adapter open failures while preserving the original cause. */
export class ChatAdapterOpenError extends chatCauseError(
  "ChatAdapterOpenError",
  (chatId) => `Failed to open chat adapter "${chatId}"`,
) {}

/** Wraps adapter start failures while preserving the original cause. */
export class ChatAdapterStartError extends chatCauseError(
  "ChatAdapterStartError",
  (chatId) => `Failed to start chat adapter "${chatId}"`,
) {}

/** Wraps adapter send failures while preserving the original cause. */
export class ChatSendMessageError extends chatCauseError(
  "ChatSendMessageError",
  (chatId) => `Failed to send chat message with "${chatId}"`,
) {}

/** Wraps adapter send action failures while preserving the original cause. */
export class ChatSendActionError extends chatCauseError(
  "ChatSendActionError",
  (chatId) => `Failed to send chat action with "${chatId}"`,
) {}

/** Wraps adapter action response failures while preserving the original cause. */
export class ChatUpdateActionError extends chatCauseError(
  "ChatUpdateActionError",
  (chatId) => `Failed to update chat action with "${chatId}"`,
) {}

export class ChatActionResponseError extends chatCauseError(
  "ChatActionResponseError",
  (chatId) => `Failed to respond to chat action with "${chatId}"`,
) {}

/** Wraps adapter reply failures while preserving the original cause. */
export class ChatReplyError extends chatCauseError(
  "ChatReplyError",
  (chatId) => `Failed to reply with chat adapter "${chatId}"`,
) {}

/** Wraps adapter stream send failures while preserving the original cause. */
export class ChatStreamMessageError extends chatCauseError(
  "ChatStreamMessageError",
  (chatId) => `Failed to stream chat message with "${chatId}"`,
) {}

/** Wraps adapter stream reply failures while preserving the original cause. */
export class ChatStreamReplyError extends chatCauseError(
  "ChatStreamReplyError",
  (chatId) => `Failed to stream reply with chat adapter "${chatId}"`,
) {}

/** Wraps adapter typing indicator failures while preserving the original cause. */
export class ChatTypingIndicatorError extends chatCauseError(
  "ChatTypingIndicatorError",
  (chatId) => `Failed to send typing indicator with chat adapter "${chatId}"`,
) {}

/** Returned when a caller targets an adapter id that was not registered. */
export class UnknownChatAdapterError extends TaggedError("UnknownChatAdapterError")<{
  readonly chatId: string;
  readonly availableChatIds: readonly string[];
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string; readonly availableChatIds: readonly string[] }) {
    super({
      ...args,
      message: `Unknown chat adapter "${args.chatId}". Available adapters: ${args.availableChatIds.join(", ") || "(none)"}`,
    });
  }
}

/** Returned when typing indicator timing options are unsafe or invalid. */
export class InvalidChatTypingIndicatorInputError extends TaggedError(
  "InvalidChatTypingIndicatorInputError",
)<{
  readonly field: "timeoutMs" | "refreshIntervalMs";
  readonly value: number;
  readonly message: string;
}>() {
  constructor(args: { readonly field: "timeoutMs" | "refreshIntervalMs"; readonly value: number }) {
    super({
      ...args,
      message: `Invalid typing indicator ${args.field}: expected a positive finite number, received ${args.value}`,
    });
  }
}

/** Returned when the facade cannot safely emulate a requested adapter feature. */
export class UnsupportedChatOperationError extends TaggedError("UnsupportedChatOperationError")<{
  readonly chatId: string;
  readonly operation: string;
  readonly mode?: string;
  readonly message: string;
}>() {
  constructor(args: {
    readonly chatId: string;
    readonly operation: string;
    readonly mode?: string;
  }) {
    const mode = args.mode === undefined ? "" : ` (${args.mode})`;

    super({
      ...args,
      message: `Chat adapter "${args.chatId}" does not support ${args.operation}${mode}`,
    });
  }
}

/** Returned for deterministic invalid facade lifecycle transitions. */
export class ChatLifecycleError extends TaggedError("ChatLifecycleError")<{
  readonly operation: ChatLifecycleOperation;
  readonly currentState: string;
  readonly expectedState: string;
  readonly message: string;
}>() {
  constructor(args: {
    readonly operation: ChatLifecycleOperation;
    readonly currentState: string;
    readonly expectedState: string;
  }) {
    super({
      ...args,
      message: `Cannot ${args.operation} chat while lifecycle is "${args.currentState}"; expected "${args.expectedState}"`,
    });
  }
}

/** Aggregates close failures after every opened adapter was attempted. */
export class ChatCloseError extends TaggedError("ChatCloseError")<{
  readonly failures: readonly { readonly chatId: string; readonly cause: unknown }[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly failures: readonly { readonly chatId: string; readonly cause: unknown }[];
  }) {
    const chatIds = args.failures.map((failure) => failure.chatId).join(", ");

    super({
      ...args,
      message: `Failed to close chat adapter runtimes: ${chatIds}`,
    });
  }
}

/** Errors returned by `chat.start()`. */
export type ChatStartError = ChatLifecycleError | ChatAdapterOpenError | ChatAdapterStartError;

/** Errors returned by `chat.close()`. */
export type ChatCloseFailure = ChatLifecycleError | ChatCloseError;

/** Errors returned by `chat.sendMessage()`. */
export type ChatSendMessageFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | ChatSendMessageError;

/** Errors returned by `chat.sendAction()`. */
export type ChatSendActionFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | ChatSendActionError;

/** Errors returned by `chat.updateAction()`. */
export type ChatUpdateActionFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | UnsupportedChatOperationError
  | ChatUpdateActionError;

/** Errors returned by `chat.injectMessage()`. */
export type ChatInjectMessageFailure = UnknownChatAdapterError | ChatLifecycleError;

/** Errors returned by `chat.injectCommand()`. */
export type ChatInjectCommandFailure = UnknownChatAdapterError | ChatLifecycleError;

/** Errors returned by action event ack/reply/update helpers. */
export type ChatActionResponseFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | ChatActionResponseError;

/** Errors returned by `chat.reply()` and event reply helpers. */
export type ChatReplyFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | UnsupportedChatOperationError
  | ChatReplyError
  | ChatSendMessageError;

/** Errors returned by `chat.streamMessage()`. */
export type ChatStreamMessageFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | UnsupportedChatOperationError
  | ChatStreamMessageError
  | ChatSendMessageError;

/** Errors returned by `chat.streamReply()` and event stream reply helpers. */
export type ChatStreamReplyFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | UnsupportedChatOperationError
  | ChatStreamReplyError
  | ChatReplyError
  | ChatSendMessageError;

/** Errors returned by `chat.typingIndicator()` and event typing helpers. */
export type ChatTypingIndicatorFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | UnsupportedChatOperationError
  | InvalidChatTypingIndicatorInputError
  | ChatTypingIndicatorError;
