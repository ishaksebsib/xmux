import { Schema } from "effect";
import { NonEmptyString } from "./primitives";

/** Log levels are normalized to lowercase for stable config, JSONL, and API output. */
export const LogLevel = Schema.Literals(["trace", "debug", "info", "warn", "error"]);
export type LogLevel = typeof LogLevel.Type;

/** JSONL log entries are schema-backed because the API returns them. */
export class LogEntry extends Schema.Class<LogEntry>("LogEntry")({
  timestamp: NonEmptyString,
  level: LogLevel,
  message: Schema.Json,
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  spans: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  cause: Schema.optionalKey(NonEmptyString),
}) {}
