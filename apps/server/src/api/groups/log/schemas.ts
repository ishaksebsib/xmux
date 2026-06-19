import { Schema } from "effect";
import { API_VERSION } from "../../../contracts/constants";
import { LogEntry } from "../../../logging/schema";

export const PositiveIntegerFromString = Schema.NumberFromString.check(Schema.isInt()).check(
  Schema.isGreaterThan(0),
);
export type PositiveIntegerFromString = typeof PositiveIntegerFromString.Type;

export const LogsQuery = Schema.Struct({
  tail: Schema.optional(PositiveIntegerFromString),
});
export type LogsQuery = typeof LogsQuery.Type;

/** GET /v1/logs response with already-bounded entries. */
export class LogsResponse extends Schema.Class<LogsResponse>("LogsResponse")({
  version: Schema.Literal(API_VERSION),
  entries: Schema.Array(LogEntry),
}) {}
