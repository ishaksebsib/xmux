import { AsyncLocalStorage } from "node:async_hooks";
import type { Result } from "better-result";
import {
  dummyXmuxLogger,
  type XmuxLogger,
  type XmuxLogErrorMetadata,
  type XmuxLogEventName,
  type XmuxLogLevel,
  type XmuxLogMetadata,
  type XmuxLogScope,
} from "./logger";

/** Request-scoped log context propagated to orchestrator, chat, harness, and adapter logs. */
export type XmuxLogContext = Pick<
  XmuxLogMetadata,
  "requestId" | "routeName" | "eventType" | "chatId" | "conversationId"
>;

const xmuxLogContextStorage = new AsyncLocalStorage<XmuxLogContext>();

/** Creates a safe logger scope. Logger failures are swallowed so logging never breaks xmux flows. */
export function createXmuxLogScope<TEventName extends string = XmuxLogEventName>(
  logger: XmuxLogger | undefined,
  metadata: XmuxLogMetadata = {},
): XmuxLogScope<TEventName> {
  const resolvedLogger = logger ?? dummyXmuxLogger;

  function write(level: XmuxLogLevel, event: TEventName, eventMetadata?: XmuxLogMetadata) {
    const mergedMetadata = mergeXmuxLogMetadata(metadata, eventMetadata);

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
      createXmuxLogScope<TEventName>(resolvedLogger, mergeXmuxLogMetadata(metadata, childMetadata)),
  };
}

/** Writes one log entry to a typed scope at a dynamic level. */
export function writeXmuxLog<TEventName extends string>(args: {
  readonly logger: XmuxLogScope<TEventName>;
  readonly level: XmuxLogLevel;
  readonly event: TEventName;
  readonly metadata?: XmuxLogMetadata;
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
export function startXmuxLogTimer(): number {
  return Date.now();
}

/** Returns elapsed milliseconds from a timestamp created by `startXmuxLogTimer`. */
export function xmuxLogDurationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

/** Logs a Result success/failure pair with consistent duration and error metadata. */
export function logXmuxResult<TEventName extends string, TValue, TError>(args: {
  readonly logger?: XmuxLogScope<TEventName>;
  readonly result: Result<TValue, TError>;
  readonly startedAt: number;
  readonly metadata?: XmuxLogMetadata;
  readonly successEvent: TEventName;
  readonly failureEvent: TEventName;
  readonly successLevel?: XmuxLogLevel;
  readonly failureLevel?: XmuxLogLevel;
}): void {
  if (args.logger === undefined) {
    return;
  }

  const metadata = {
    ...args.metadata,
    durationMs: xmuxLogDurationMs(args.startedAt),
  } satisfies XmuxLogMetadata;

  if (args.result.isErr()) {
    writeXmuxLog({
      logger: args.logger,
      level: args.failureLevel ?? "debug",
      event: args.failureEvent,
      metadata: {
        ...metadata,
        result: "error",
        error: serializeXmuxLogError(args.result.error),
      },
    });
    return;
  }

  writeXmuxLog({
    logger: args.logger,
    level: args.successLevel ?? "debug",
    event: args.successEvent,
    metadata: { ...metadata, result: "ok" },
  });
}

/** Converts unknown thrown/returned errors to a bounded metadata object. */
export function serializeXmuxLogError(error: unknown, depth = 0): XmuxLogErrorMetadata {
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

/** Runs a function with request-scoped log context propagated across async boundaries. */
export function runWithXmuxLogContext<T>(context: XmuxLogContext, fn: () => T): T {
  const parent = xmuxLogContextStorage.getStore();
  return xmuxLogContextStorage.run(mergeXmuxLogContext(parent, context), fn);
}

/** Creates a logger that enriches every write with the current async xmux log context. */
export function createContextualXmuxLogger(logger: XmuxLogger | undefined): XmuxLogger {
  const resolvedLogger = logger ?? dummyXmuxLogger;
  const contextualLogger: XmuxLogger = {
    trace(message, ...optionalParams) {
      writeContextualLog("trace", [message, ...optionalParams]);
    },
    debug(message, ...optionalParams) {
      writeContextualLog("debug", [message, ...optionalParams]);
    },
    info(message, ...optionalParams) {
      writeContextualLog("info", [message, ...optionalParams]);
    },
    warn(message, ...optionalParams) {
      writeContextualLog("warn", [message, ...optionalParams]);
    },
    error(message, ...optionalParams) {
      writeContextualLog("error", [message, ...optionalParams]);
    },
  };

  function writeContextualLog(level: XmuxLogLevel, args: Parameters<XmuxLogger["debug"]>) {
    try {
      resolvedLogger[level](...enrichLoggerArgs(args));
    } catch {
      // Logging must remain best-effort and must never change library behavior.
    }
  }

  return contextualLogger;
}

function enrichLoggerArgs(args: Parameters<XmuxLogger["debug"]>): Parameters<XmuxLogger["debug"]> {
  const context = xmuxLogContextStorage.getStore();
  if (context === undefined || !hasMetadata(context)) {
    return args;
  }

  const [message, ...optionalParams] = args;
  if (optionalParams.length === 0) {
    return [message, context];
  }

  const [firstOptionalParam, ...remainingOptionalParams] = optionalParams;
  if (firstOptionalParam === undefined) {
    return [message, context, ...remainingOptionalParams];
  }

  if (isPlainRecord(firstOptionalParam)) {
    return [
      message,
      mergeXmuxLogMetadata(context, firstOptionalParam as XmuxLogMetadata),
      ...remainingOptionalParams,
    ];
  }

  return [message, context, firstOptionalParam, ...remainingOptionalParams];
}

function mergeXmuxLogContext(
  base: XmuxLogContext | undefined,
  metadata: XmuxLogContext | undefined,
): XmuxLogContext {
  return pickXmuxLogContext(mergeXmuxLogMetadata(base, metadata));
}

function pickXmuxLogContext(metadata: XmuxLogMetadata): XmuxLogContext {
  return {
    ...withOptionalString("requestId", toNonEmptyString(metadata.requestId)),
    ...withOptionalString("routeName", toNonEmptyString(metadata.routeName)),
    ...withOptionalString("eventType", toNonEmptyString(metadata.eventType)),
    ...withOptionalString("chatId", toNonEmptyString(metadata.chatId)),
    ...withOptionalString("conversationId", toNonEmptyString(metadata.conversationId)),
  };
}

function mergeXmuxLogMetadata(
  base: XmuxLogMetadata | undefined,
  metadata: XmuxLogMetadata | undefined,
): XmuxLogMetadata {
  const merged = { ...base, ...metadata };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as XmuxLogMetadata;
}

function hasMetadata(metadata: XmuxLogMetadata): boolean {
  return Object.keys(metadata).length > 0;
}

function withOptionalCause<T extends XmuxLogErrorMetadata>(
  metadata: T,
  error: unknown,
  depth: number,
  maxDepth: number,
): T {
  const cause = depth >= maxDepth || !isRecord(error) ? undefined : error.cause;
  return {
    ...metadata,
    ...(cause === undefined ? {} : { cause: serializeXmuxLogError(cause, depth + 1) }),
  };
}

function withOptionalString<K extends string>(
  key: K,
  value: string | undefined,
): { readonly [P in K]?: string } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: string });
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringProperty(value: object, key: string): string | undefined {
  if (!Object.hasOwn(value, key)) return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" && property.length > 0 ? property : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}
