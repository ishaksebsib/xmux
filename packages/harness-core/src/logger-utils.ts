import { Result, type Result as ResultType } from "better-result";
import {
  dummyHarnessLogger,
  harnessLogEvents,
  type HarnessLogger,
  type HarnessLogErrorMetadata,
  type HarnessLogEventName,
  type HarnessLogLevel,
  type HarnessLogMetadata,
  type HarnessLogOperation,
  type HarnessLogScope,
} from "./logger";
import { isRecord } from "./utils";

/** Creates a safe logger scope. Logger failures are swallowed so logging never breaks harness flows. */
export function createHarnessLogScope<TEventName extends string = HarnessLogEventName>(
  logger: HarnessLogger | undefined,
  metadata: HarnessLogMetadata = {},
): HarnessLogScope<TEventName> {
  const resolvedLogger = logger ?? dummyHarnessLogger;

  function write(level: HarnessLogLevel, event: TEventName, eventMetadata?: HarnessLogMetadata) {
    const mergedMetadata = mergeHarnessLogMetadata(metadata, eventMetadata);

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
      createHarnessLogScope<TEventName>(
        resolvedLogger,
        mergeHarnessLogMetadata(metadata, childMetadata),
      ),
  };
}

/** Writes one log entry to a typed scope at a dynamic level. */
export function writeHarnessLog<TEventName extends string>(args: {
  readonly logger: HarnessLogScope<TEventName>;
  readonly level: HarnessLogLevel;
  readonly event: TEventName;
  readonly metadata?: HarnessLogMetadata;
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
export function startHarnessLogTimer(): number {
  return Date.now();
}

/** Returns elapsed milliseconds from a timestamp created by `startHarnessLogTimer`. */
export function harnessLogDurationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

/** Logs a Result success/failure pair with consistent duration and error metadata. */
export function logHarnessResult<TEventName extends string, TValue, TError>(args: {
  readonly logger?: HarnessLogScope<TEventName>;
  readonly result: ResultType<TValue, TError>;
  readonly startedAt: number;
  readonly metadata?: HarnessLogMetadata;
  readonly successEvent: TEventName;
  readonly failureEvent: TEventName;
  readonly successLevel?: HarnessLogLevel;
  readonly failureLevel?: HarnessLogLevel;
}): void {
  if (args.logger === undefined) {
    return;
  }

  const metadata = {
    ...args.metadata,
    durationMs: harnessLogDurationMs(args.startedAt),
  } satisfies HarnessLogMetadata;

  if (args.result.isErr()) {
    writeHarnessLog({
      logger: args.logger,
      level: args.failureLevel ?? "debug",
      event: args.failureEvent,
      metadata: {
        ...metadata,
        result: "error",
        error: serializeHarnessLogError(args.result.error),
      },
    });
    return;
  }

  writeHarnessLog({
    logger: args.logger,
    level: args.successLevel ?? "debug",
    event: args.successEvent,
    metadata: { ...metadata, result: "ok" },
  });
}

/** Runs and logs a harness-core operation with standard begin/success/failure events. */
export async function logHarnessOperation<TValue, TError>(args: {
  readonly logger?: HarnessLogScope<HarnessLogEventName>;
  readonly operation: HarnessLogOperation;
  readonly harnessId?: string;
  readonly sessionId?: string;
  readonly metadata?: HarnessLogMetadata;
  readonly run: () => Promise<ResultType<TValue, TError>>;
}): Promise<ResultType<TValue, TError>> {
  const startedAt = startHarnessLogTimer();
  const metadata = {
    ...args.metadata,
    harnessId: args.harnessId,
    sessionId: args.sessionId,
    operation: args.operation,
  } satisfies HarnessLogMetadata;

  args.logger?.debug(harnessLogEvents.operationBegin, metadata);

  try {
    const result = await args.run();

    logHarnessResult({
      logger: args.logger,
      result,
      startedAt,
      metadata,
      successEvent: harnessLogEvents.operationSuccess,
      failureEvent: harnessLogEvents.operationFailure,
    });

    return result;
  } catch (cause) {
    logHarnessResult({
      logger: args.logger,
      result: Result.err(cause),
      startedAt,
      metadata,
      successEvent: harnessLogEvents.operationSuccess,
      failureEvent: harnessLogEvents.operationFailure,
    });

    throw cause;
  }
}

/** Converts unknown thrown/returned errors to a bounded metadata object. */
export function serializeHarnessLogError(error: unknown, depth = 0): HarnessLogErrorMetadata {
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

function mergeHarnessLogMetadata(
  base: HarnessLogMetadata | undefined,
  metadata: HarnessLogMetadata | undefined,
): HarnessLogMetadata {
  const merged = { ...base, ...metadata };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as HarnessLogMetadata;
}

function hasMetadata(metadata: HarnessLogMetadata): boolean {
  return Object.keys(metadata).length > 0;
}

function withOptionalCause<T extends HarnessLogErrorMetadata>(
  metadata: T,
  error: unknown,
  depth: number,
  maxDepth: number,
): T {
  const cause = depth >= maxDepth || !isRecord(error) ? undefined : error.cause;
  return {
    ...metadata,
    ...(cause === undefined ? {} : { cause: serializeHarnessLogError(cause, depth + 1) }),
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
