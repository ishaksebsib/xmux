import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Facade operation names used in lifecycle errors. */
export type ChatLifecycleOperation =
  | "start"
  | "close"
  | "sendMessage"
  | "reply"
  | "streamMessage"
  | "streamReply"
  | "typingIndicator";

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

/** Wraps adapter open failures while preserving the original cause. */
export class ChatAdapterOpenError extends TaggedError("ChatAdapterOpenError")<{
  readonly chatId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to open chat adapter "${args.chatId}": ${describeCause(args.cause)}`,
    });
  }
}

/** Wraps adapter start failures while preserving the original cause. */
export class ChatAdapterStartError extends TaggedError("ChatAdapterStartError")<{
  readonly chatId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to start chat adapter "${args.chatId}": ${describeCause(args.cause)}`,
    });
  }
}

/** Wraps adapter send failures while preserving the original cause. */
export class ChatSendMessageError extends TaggedError("ChatSendMessageError")<{
  readonly chatId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to send chat message with "${args.chatId}": ${describeCause(args.cause)}`,
    });
  }
}

/** Wraps adapter reply failures while preserving the original cause. */
export class ChatReplyError extends TaggedError("ChatReplyError")<{
  readonly chatId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to reply with chat adapter "${args.chatId}": ${describeCause(args.cause)}`,
    });
  }
}

/** Wraps adapter stream send failures while preserving the original cause. */
export class ChatStreamMessageError extends TaggedError("ChatStreamMessageError")<{
  readonly chatId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to stream chat message with "${args.chatId}": ${describeCause(args.cause)}`,
    });
  }
}

/** Wraps adapter stream reply failures while preserving the original cause. */
export class ChatStreamReplyError extends TaggedError("ChatStreamReplyError")<{
  readonly chatId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to stream reply with chat adapter "${args.chatId}": ${describeCause(args.cause)}`,
    });
  }
}

/** Wraps adapter typing indicator failures while preserving the original cause. */
export class ChatTypingIndicatorError extends TaggedError("ChatTypingIndicatorError")<{
  readonly chatId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to send typing indicator with chat adapter "${args.chatId}": ${describeCause(args.cause)}`,
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
