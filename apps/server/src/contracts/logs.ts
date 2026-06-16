import { Schema } from "effect";
import { CONTROL_RESPONSE_VERSION } from "./control";

/** Log levels are normalized to lowercase for stable JSONL and control output. */
export const LogLevel = Schema.Literals(["trace", "debug", "info", "warn", "error"]);
export type LogLevel = typeof LogLevel.Type;

/** JSONL log entries are schema-backed because the control API returns them. */
export class LogEntry extends Schema.Class<LogEntry>("LogEntry")({
  timestamp: Schema.String,
  level: LogLevel,
  message: Schema.Unknown,
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  spans: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  cause: Schema.optionalKey(Schema.String),
}) {}

/** GET /v1/logs response with already-bounded entries. */
export class LogsResponse extends Schema.Class<LogsResponse>("LogsResponse")({
  version: Schema.Literal(CONTROL_RESPONSE_VERSION),
  entries: Schema.Array(LogEntry),
}) {}
