import type { Result } from "better-result";
import {
  dummyChatLogger,
  type ChatLogger,
  type ChatLogErrorMetadata,
  type ChatLogEventName,
  type ChatLogLevel,
  type ChatLogMetadata,
  type ChatLogScope,
} from "./logger";

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
