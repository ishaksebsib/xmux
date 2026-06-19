import { Schema } from "effect";

/** Log levels are normalized to lowercase for stable JSONL and API output. */
export const LogLevel = Schema.Literals(["trace", "debug", "info", "warn", "error"]);
export type LogLevel = typeof LogLevel.Type;

/** JSONL log entries are schema-backed because the API returns them. */
export class LogEntry extends Schema.Class<LogEntry>("LogEntry")({
  timestamp: Schema.String,
  level: LogLevel,
  message: Schema.Unknown,
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  spans: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  cause: Schema.optionalKey(Schema.String),
}) {}
