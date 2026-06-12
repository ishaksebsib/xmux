import { dummyLogger, type Logger } from "ts-log";

/** Logger interface accepted by chat-core. Compatible with console, pino, winston, etc. */
export type ChatLogger = Logger;

/** Silent logger for callers and adapter authors that need an explicit no-op default. */
export const dummyChatLogger = dummyLogger;

/** Built-in chat-core log event names. Values are stable, query-friendly message strings. */
export const chatLogEvents = {
  startBegin: "xmux.chat.start.begin",
  startSuccess: "xmux.chat.start.success",
  startFailure: "xmux.chat.start.failure",
  closeBegin: "xmux.chat.close.begin",
  closeSuccess: "xmux.chat.close.success",
  closeFailure: "xmux.chat.close.failure",
  adapterOpenBegin: "xmux.chat.adapter.open.begin",
  adapterOpenSuccess: "xmux.chat.adapter.open.success",
  adapterOpenFailure: "xmux.chat.adapter.open.failure",
  adapterStartBegin: "xmux.chat.adapter.start.begin",
  adapterStartSuccess: "xmux.chat.adapter.start.success",
  adapterStartFailure: "xmux.chat.adapter.start.failure",
  adapterCloseBegin: "xmux.chat.adapter.close.begin",
  adapterCloseSuccess: "xmux.chat.adapter.close.success",
  adapterCloseFailure: "xmux.chat.adapter.close.failure",
  operationBegin: "xmux.chat.operation.begin",
  operationSuccess: "xmux.chat.operation.success",
  operationFailure: "xmux.chat.operation.failure",
  operationFallback: "xmux.chat.operation.fallback",
  eventHandlerFailure: "xmux.chat.event.handler.failure",
  backgroundTaskFailure: "xmux.chat.background.failure",
} as const satisfies Record<string, `xmux.chat.${string}`>;

/** Union of chat-core's built-in typed log event names. */
export type ChatLogEventName = (typeof chatLogEvents)[keyof typeof chatLogEvents];

/** Log levels supported by ts-log and chat-core's safe logging helpers. */
export type ChatLogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** Common operation names used by chat-core logs, while still allowing adapter-defined names. */
export type ChatLogOperation =
  | "start"
  | "close"
  | "openAdapter"
  | "startAdapter"
  | "closeAdapter"
  | "sendMessage"
  | "sendAction"
  | "respondToAction"
  | "reply"
  | "streamMessage"
  | "streamReply"
  | "typingIndicator"
  | (string & {});

/** Safe, serializable-ish error shape for structured log metadata. */
export interface ChatLogErrorMetadata {
  readonly name?: string;
  readonly message?: string;
  readonly tag?: string;
  readonly cause?: ChatLogErrorMetadata;
  readonly [key: string]: unknown;
}

/**
 * General structured metadata shape for chat logs.
 *
 * The named fields provide autocomplete for common dimensions. The index signature keeps the
 * shape extensible for future chat-core features and adapter-specific metadata.
 */
export interface ChatLogMetadata {
  readonly component?: string;
  readonly packageName?: string;
  readonly chatId?: string;
  readonly chatIds?: readonly string[];
  readonly operation?: ChatLogOperation;
  readonly lifecycleStatus?: string;
  readonly eventType?: string;
  readonly eventKey?: string;
  readonly commandName?: string;
  readonly actionId?: string;
  readonly interactionId?: string;
  readonly responseKind?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly mode?: string;
  readonly fallback?: string;
  readonly action?: string;
  readonly result?: "ok" | "error" | "ignored" | (string & {});
  readonly reason?: string;
  readonly durationMs?: number;
  readonly textLength?: number;
  readonly format?: string;
  readonly buttonRows?: number;
  readonly buttonCount?: number;
  readonly error?: ChatLogErrorMetadata;
  readonly cause?: ChatLogErrorMetadata;
  readonly [key: string]: unknown;
}

/** Typed scoped logger used internally by chat-core and reusable by adapter packages. */
export interface ChatLogScope<TEventName extends string = ChatLogEventName> {
  trace(event: TEventName, metadata?: ChatLogMetadata): void;
  debug(event: TEventName, metadata?: ChatLogMetadata): void;
  info(event: TEventName, metadata?: ChatLogMetadata): void;
  warn(event: TEventName, metadata?: ChatLogMetadata): void;
  error(event: TEventName, metadata?: ChatLogMetadata): void;
  child(metadata: ChatLogMetadata): ChatLogScope<TEventName>;
}
