import { dummyLogger, type Logger } from "ts-log";

/** Logger interface accepted by orchestrator. Compatible with console, pino, winston, etc. */
export type XmuxLogger = Logger;

/** Silent logger for callers that need an explicit no-op default. */
export const dummyXmuxLogger = dummyLogger;

/** Built-in orchestrator log event names. Values are stable, query-friendly message strings. */
export const xmuxLogEvents = {
  configFailure: "xmux.orchestrator.config.failure",
  initializeBegin: "xmux.orchestrator.initialize.begin",
  initializeSuccess: "xmux.orchestrator.initialize.success",
  initializeFailure: "xmux.orchestrator.initialize.failure",
  shutdownBegin: "xmux.orchestrator.shutdown.begin",
  shutdownSuccess: "xmux.orchestrator.shutdown.success",
  shutdownFailure: "xmux.orchestrator.shutdown.failure",
  routeBegin: "xmux.orchestrator.route.begin",
  routeSuccess: "xmux.orchestrator.route.success",
  routeFailure: "xmux.orchestrator.route.failure",
  routeIgnored: "xmux.orchestrator.route.ignored",
  operationBegin: "xmux.orchestrator.operation.begin",
  operationSuccess: "xmux.orchestrator.operation.success",
  operationFailure: "xmux.orchestrator.operation.failure",
  backgroundFailure: "xmux.orchestrator.background.failure",
} as const satisfies Record<string, `xmux.orchestrator.${string}`>;

/** Union of orchestrator's built-in typed log event names. */
export type XmuxLogEventName = (typeof xmuxLogEvents)[keyof typeof xmuxLogEvents];

/** Log levels supported by ts-log and orchestrator's safe logging helpers. */
export type XmuxLogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** Common operation names used by orchestrator logs, while still allowing feature-defined names. */
export type XmuxLogOperation =
  | "initialize"
  | "shutdown"
  | "route"
  | "sessionCreate"
  | "sessionResume"
  | "sessionDelete"
  | "prompt"
  | "stt"
  | "interaction"
  | "workspace"
  | (string & {});

/** Safe, serializable-ish error shape for structured log metadata. */
export interface XmuxLogErrorMetadata {
  readonly name?: string;
  readonly message?: string;
  readonly tag?: string;
  readonly cause?: XmuxLogErrorMetadata;
  readonly [key: string]: unknown;
}

/**
 * General structured metadata shape for orchestrator logs.
 *
 * Keep metadata safe and small. Do not include prompt text, transcripts,
 * adapter options, tokens, attachment bytes, file contents, or raw payloads.
 */
export interface XmuxLogMetadata {
  readonly component?: string;
  readonly packageName?: string;
  readonly requestId?: string;
  readonly routeName?: string;
  readonly eventType?: string;
  readonly chatId?: string;
  readonly conversationId?: string;
  readonly harnessId?: string;
  readonly sessionId?: string;
  readonly operation?: XmuxLogOperation;
  readonly result?: "ok" | "error" | "ignored" | (string & {});
  readonly reason?: string;
  readonly durationMs?: number;
  readonly error?: XmuxLogErrorMetadata;
  readonly [key: string]: unknown;
}

/** Typed scoped logger used internally by orchestrator and reusable by integrations. */
export interface XmuxLogScope<TEventName extends string = XmuxLogEventName> {
  trace(event: TEventName, metadata?: XmuxLogMetadata): void;
  debug(event: TEventName, metadata?: XmuxLogMetadata): void;
  info(event: TEventName, metadata?: XmuxLogMetadata): void;
  warn(event: TEventName, metadata?: XmuxLogMetadata): void;
  error(event: TEventName, metadata?: XmuxLogMetadata): void;
  child(metadata: XmuxLogMetadata): XmuxLogScope<TEventName>;
}
