import { LogLevel as LogLevelSchema, type LogLevel as LogLevelType } from "../logging/schema";
export { LogEntry } from "../logging/schema";
export { LogsResponse } from "../api/groups/log/schemas";

/** Backward-compatible log-level schema alias for older imports. */
export const LogLevel = LogLevelSchema;
export type LogLevel = LogLevelType;
