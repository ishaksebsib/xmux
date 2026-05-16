import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export type ChatLifecycleOperation = "start" | "close" | "sendMessage" | "reply";

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

export type ChatStartError = ChatLifecycleError | ChatAdapterOpenError | ChatAdapterStartError;

export type ChatCloseFailure = ChatLifecycleError | ChatCloseError;

export type ChatSendMessageFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | ChatSendMessageError;

export type ChatReplyFailure =
  | UnknownChatAdapterError
  | ChatLifecycleError
  | UnsupportedChatOperationError
  | ChatReplyError
  | ChatSendMessageError;
