import { Schema } from "effect";
import { LogEntry } from "../../../logging/schema";
import { RESPONSE_VERSION } from "../../shared/version";

export const LogsQuery = Schema.Struct({
  tail: Schema.optional(Schema.String),
});

/** GET /v1/logs response with already-bounded entries. */
export class LogsResponse extends Schema.Class<LogsResponse>("LogsResponse")({
  version: Schema.Literal(RESPONSE_VERSION),
  entries: Schema.Array(LogEntry),
}) {}
