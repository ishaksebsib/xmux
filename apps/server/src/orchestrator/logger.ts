import { Effect } from "effect";
import type { XmuxLogger } from "@xmux/orchestrator";
import { redactRecord, redactUnknown } from "../logging/redaction";

const FALLBACK_LOG_MESSAGE = "xmux.orchestrator.log";

type OrchestratorLoggerLevel = "trace" | "debug" | "info" | "warn" | "error";

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const toSafeLogMessage = (message: unknown): string => {
  if (typeof message !== "string") return FALLBACK_LOG_MESSAGE;
  const redacted = redactUnknown(message);
  return typeof redacted === "string" ? redacted : FALLBACK_LOG_MESSAGE;
};

const extractAnnotations = (
  optionalParams: readonly unknown[],
): Record<string, unknown> | undefined => {
  const metadata = optionalParams.find(isPlainRecord);
  if (metadata === undefined) return undefined;

  try {
    const redacted = redactRecord(metadata);
    return Object.keys(redacted).length > 0 ? redacted : undefined;
  } catch {
    return { metadataRedaction: "failed" };
  }
};

const logAtLevel = (level: OrchestratorLoggerLevel, message: string): Effect.Effect<void> => {
  switch (level) {
    case "trace":
      return Effect.logTrace(message);
    case "debug":
      return Effect.logDebug(message);
    case "info":
      return Effect.logInfo(message);
    case "warn":
      return Effect.logWarning(message);
    case "error":
      return Effect.logError(message);
  }
};

const makeLogEffect = (
  level: OrchestratorLoggerLevel,
  message: unknown,
  optionalParams: readonly unknown[],
): Effect.Effect<void> => {
  const annotations = extractAnnotations(optionalParams);
  const logEffect = logAtLevel(level, toSafeLogMessage(message));
  return annotations === undefined ? logEffect : logEffect.pipe(Effect.annotateLogs(annotations));
};

export const makeOrchestratorLogger = Effect.fn("server.orchestrator.makeLogger")(function* () {
  const context = yield* Effect.context<never>();
  const runWithContext = Effect.runForkWith(context);

  const write = (
    level: OrchestratorLoggerLevel,
    message: unknown,
    optionalParams: readonly unknown[],
  ): void => {
    try {
      void runWithContext(
        makeLogEffect(level, message, optionalParams).pipe(Effect.catchCause(() => Effect.void)),
      );
    } catch {
      // Package logging is best-effort and must never affect orchestrator flows.
    }
  };

  return {
    trace(message?: unknown, ...optionalParams: unknown[]): void {
      write("trace", message, optionalParams);
    },
    debug(message?: unknown, ...optionalParams: unknown[]): void {
      write("debug", message, optionalParams);
    },
    info(message?: unknown, ...optionalParams: unknown[]): void {
      write("info", message, optionalParams);
    },
    warn(message?: unknown, ...optionalParams: unknown[]): void {
      write("warn", message, optionalParams);
    },
    error(message?: unknown, ...optionalParams: unknown[]): void {
      write("error", message, optionalParams);
    },
  } satisfies XmuxLogger;
});
