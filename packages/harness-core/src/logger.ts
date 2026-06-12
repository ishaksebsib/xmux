import { dummyLogger, type Logger } from "ts-log";

/** Logger interface accepted by harness-core. Compatible with console, pino, winston, etc. */
export type HarnessLogger = Logger;

/** Silent logger for callers and adapter authors that need an explicit no-op default. */
export const dummyHarnessLogger = dummyLogger;

/** Built-in harness-core log event names. Values are stable, query-friendly message strings. */
export const harnessLogEvents = {
  closeBegin: "xmux.harness.close.begin",
  closeSuccess: "xmux.harness.close.success",
  closeFailure: "xmux.harness.close.failure",
  adapterOpenBegin: "xmux.harness.adapter.open.begin",
  adapterOpenSuccess: "xmux.harness.adapter.open.success",
  adapterOpenFailure: "xmux.harness.adapter.open.failure",
  adapterCloseBegin: "xmux.harness.adapter.close.begin",
  adapterCloseSuccess: "xmux.harness.adapter.close.success",
  adapterCloseFailure: "xmux.harness.adapter.close.failure",
  operationBegin: "xmux.harness.operation.begin",
  operationSuccess: "xmux.harness.operation.success",
  operationFailure: "xmux.harness.operation.failure",
} as const satisfies Record<string, `xmux.harness.${string}`>;

/** Union of harness-core's built-in typed log event names. */
export type HarnessLogEventName = (typeof harnessLogEvents)[keyof typeof harnessLogEvents];

/** Log levels supported by ts-log and harness-core's safe logging helpers. */
export type HarnessLogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** Common operation names used by harness-core logs, while still allowing adapter-defined names. */
export type HarnessLogOperation =
  | "openAdapter"
  | "closeAdapter"
  | "close"
  | "createSession"
  | "resumeSession"
  | "listSessions"
  | "getSession"
  | "prompt"
  | "listModels"
  | "getModel"
  | "setModel"
  | "getThinking"
  | "setThinking"
  | "deleteSession"
  | "abort"
  | "respondInteraction"
  | (string & {});

/** Safe, serializable-ish error shape for structured log metadata. */
export interface HarnessLogErrorMetadata {
  readonly name?: string;
  readonly message?: string;
  readonly tag?: string;
  readonly cause?: HarnessLogErrorMetadata;
  readonly [key: string]: unknown;
}

/**
 * General structured metadata shape for harness logs.
 *
 * Keep common cross-package fields typed; package-specific dimensions stay
 * supported through the index signature. Do not include prompt content,
 * credentials, raw adapter options, or other user/private payloads.
 */
export interface HarnessLogMetadata {
  readonly component?: string;
  readonly packageName?: string;
  readonly harnessId?: string;
  readonly sessionId?: string;
  readonly operation?: HarnessLogOperation;
  readonly result?: "ok" | "error" | "ignored" | "unsupported" | (string & {});
  readonly reason?: string;
  readonly durationMs?: number;
  readonly error?: HarnessLogErrorMetadata;
  readonly [key: string]: unknown;
}

/** Typed scoped logger used internally by harness-core and reusable by adapter packages. */
export interface HarnessLogScope<TEventName extends string = HarnessLogEventName> {
  trace(event: TEventName, metadata?: HarnessLogMetadata): void;
  debug(event: TEventName, metadata?: HarnessLogMetadata): void;
  info(event: TEventName, metadata?: HarnessLogMetadata): void;
  warn(event: TEventName, metadata?: HarnessLogMetadata): void;
  error(event: TEventName, metadata?: HarnessLogMetadata): void;
  child(metadata: HarnessLogMetadata): HarnessLogScope<TEventName>;
}
