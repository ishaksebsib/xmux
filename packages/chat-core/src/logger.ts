import type { Result } from "better-result";
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

/** Creates a safe logger scope. Logger failures are swallowed so logging never breaks chat flows. */
export function createChatLogScope<TEventName extends string = ChatLogEventName>(
  logger: ChatLogger | undefined,
  metadata: ChatLogMetadata = {},
): ChatLogScope<TEventName> {
  const resolvedLogger = logger ?? dummyChatLogger;

  function write(level: ChatLogLevel, event: TEventName, eventMetadata?: ChatLogMetadata) {
    const mergedMetadata = mergeChatLogMetadata(metadata, eventMetadata);

    try {
      if (hasMetadata(mergedMetadata)) {
        resolvedLogger[level](event, mergedMetadata);
        return;
      }

      resolvedLogger[level](event);
    } catch {
      // Logging must remain best-effort and must never change library behavior.
    }
  }

  return {
    trace: (event, eventMetadata) => write("trace", event, eventMetadata),
    debug: (event, eventMetadata) => write("debug", event, eventMetadata),
    info: (event, eventMetadata) => write("info", event, eventMetadata),
    warn: (event, eventMetadata) => write("warn", event, eventMetadata),
    error: (event, eventMetadata) => write("error", event, eventMetadata),
    child: (childMetadata) =>
      createChatLogScope<TEventName>(resolvedLogger, mergeChatLogMetadata(metadata, childMetadata)),
  };
}

/** Writes one log entry to a typed scope at a dynamic level. */
export function writeChatLog<TEventName extends string>(args: {
  readonly logger: ChatLogScope<TEventName>;
  readonly level: ChatLogLevel;
  readonly event: TEventName;
  readonly metadata?: ChatLogMetadata;
}): void {
  switch (args.level) {
    case "trace":
      args.logger.trace(args.event, args.metadata);
      return;
    case "debug":
      args.logger.debug(args.event, args.metadata);
      return;
    case "info":
      args.logger.info(args.event, args.metadata);
      return;
    case "warn":
      args.logger.warn(args.event, args.metadata);
      return;
    case "error":
      args.logger.error(args.event, args.metadata);
      return;
  }
}

/** Current timestamp token for duration logging. */
export function startChatLogTimer(): number {
  return Date.now();
}

/** Returns elapsed milliseconds from a timestamp created by `startChatLogTimer`. */
export function chatLogDurationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

/** Logs a Result success/failure pair with consistent duration and error metadata. */
export function logChatResult<TEventName extends string, TValue, TError>(args: {
  readonly logger?: ChatLogScope<TEventName>;
  readonly result: Result<TValue, TError>;
  readonly startedAt: number;
  readonly metadata?: ChatLogMetadata;
  readonly successEvent: TEventName;
  readonly failureEvent: TEventName;
  readonly successLevel?: ChatLogLevel;
  readonly failureLevel?: ChatLogLevel;
}): void {
  if (args.logger === undefined) {
    return;
  }

  const metadata = {
    ...args.metadata,
    durationMs: chatLogDurationMs(args.startedAt),
  } satisfies ChatLogMetadata;

  if (args.result.isErr()) {
    writeChatLog({
      logger: args.logger,
      level: args.failureLevel ?? "debug",
      event: args.failureEvent,
      metadata: {
        ...metadata,
        result: "error",
        error: serializeChatLogError(args.result.error),
      },
    });
    return;
  }

  writeChatLog({
    logger: args.logger,
    level: args.successLevel ?? "debug",
    event: args.successEvent,
    metadata: { ...metadata, result: "ok" },
  });
}

/** Converts unknown thrown/returned errors to a bounded metadata object. */
export function serializeChatLogError(error: unknown, depth = 0): ChatLogErrorMetadata {
  const maxDepth = 2;

  if (error instanceof Error) {
    return withOptionalCause(
      {
        name: error.name,
        message: error.message,
        ...withOptionalString(
          "tag",
          readStringProperty(error, "tag") ?? readStringProperty(error, "_tag"),
        ),
      },
      error,
      depth,
      maxDepth,
    );
  }

  if (isRecord(error)) {
    const name = readStringProperty(error, "name");
    const message = readStringProperty(error, "message");
    const tag = readStringProperty(error, "tag") ?? readStringProperty(error, "_tag");

    return withOptionalCause(
      {
        ...withOptionalString("name", name),
        ...withOptionalString("message", message),
        ...withOptionalString("tag", tag),
        ...(!name && !message && !tag ? { message: String(error) } : {}),
      },
      error,
      depth,
      maxDepth,
    );
  }

  return { message: String(error) };
}

function mergeChatLogMetadata(
  base: ChatLogMetadata | undefined,
  metadata: ChatLogMetadata | undefined,
): ChatLogMetadata {
  const merged = { ...base, ...metadata };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as ChatLogMetadata;
}

function hasMetadata(metadata: ChatLogMetadata): boolean {
  return Object.keys(metadata).length > 0;
}

function withOptionalCause<T extends ChatLogErrorMetadata>(
  metadata: T,
  error: unknown,
  depth: number,
  maxDepth: number,
): T {
  const cause = depth >= maxDepth || !isRecord(error) ? undefined : error.cause;
  return {
    ...metadata,
    ...(cause === undefined ? {} : { cause: serializeChatLogError(cause, depth + 1) }),
  };
}

function withOptionalString<K extends string>(
  key: K,
  value: string | undefined,
): { readonly [P in K]?: string } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: string });
}

function readStringProperty(value: object, key: string): string | undefined {
  if (!Object.hasOwn(value, key)) return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" && property.length > 0 ? property : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
