import type { CliLogsResponse } from "../control/client";
import type { CliLogsReport } from "../domain/logs";
import { formatJson, formatKeyValueLines, type JsonValue } from "./format";

const MAX_HUMAN_FIELD_CHARS = 2_000;

const compactJson = (value: JsonValue): string => JSON.stringify(value) ?? "null";

const replaceControlCharacters = (value: string): string =>
  Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");

const oneLine = (value: string): string =>
  replaceControlCharacters(value).replace(/\s+/g, " ").trim();

const truncateHumanField = (value: string): string =>
  value.length <= MAX_HUMAN_FIELD_CHARS ? value : `${value.slice(0, MAX_HUMAN_FIELD_CHARS - 3)}...`;

const humanJsonValue = (value: JsonValue): string => {
  const rendered = typeof value === "string" ? oneLine(value) : oneLine(compactJson(value));
  return truncateHumanField(rendered.length > 0 ? rendered : compactJson(value));
};

const nonEmptyRecord = (value: object | undefined): boolean =>
  value !== undefined && Object.keys(value).length > 0;

type LogsReport = CliLogsReport<CliLogsResponse>;
type LogEntry = CliLogsResponse["entries"][number];

// The server API owns bounds and redaction; the CLI only formats the decoded response.
const renderLogEntryHuman = (entry: LogEntry): string => {
  const metadata: string[] = [];

  if (entry.annotations !== undefined && nonEmptyRecord(entry.annotations)) {
    metadata.push(`annotations=${humanJsonValue(entry.annotations)}`);
  }

  if (entry.spans !== undefined && nonEmptyRecord(entry.spans)) {
    metadata.push(`spans=${humanJsonValue(entry.spans)}`);
  }

  if (entry.cause !== undefined) {
    metadata.push(`cause=${humanJsonValue(entry.cause)}`);
  }

  const suffix = metadata.length === 0 ? "" : ` ${metadata.join(" ")}`;
  return `${entry.timestamp} ${entry.level} ${humanJsonValue(entry.message)}${suffix}`;
};

const logEntryJson = (entry: LogEntry): JsonValue => ({
  timestamp: entry.timestamp,
  level: entry.level,
  message: entry.message,
  annotations: entry.annotations,
  spans: entry.spans,
  cause: entry.cause,
});

export const logsReportJson = (report: LogsReport): JsonValue => ({
  kind: "logs",
  _tag: report._tag,
  version: report.response.version,
  server: {
    scopeId: report.server.paths.scopeId,
    configPath: report.server.paths.configPath,
    socketPath: report.server.socketPath,
    manifestPath: report.server.manifestPath,
    pid: report.server.pid,
    pidAlive: report.server.pidAlive,
    sessionId: report.server.sessionId,
  },
  entries: report.response.entries.map(logEntryJson),
});

export const renderLogsHuman = (report: LogsReport): string => {
  const count = report.response.entries.length;
  const header = formatKeyValueLines([
    ["xmux logs", count === 0 ? "empty" : `${count} entr${count === 1 ? "y" : "ies"}`],
    ["scope", report.server.paths.scopeId],
    ["config", report.server.paths.configPath],
    ["socket", report.server.socketPath],
  ]).trimEnd();

  if (count === 0) return header;

  return `${header}\n${report.response.entries.map(renderLogEntryHuman).join("\n")}`;
};

export const renderLogsJson = (report: LogsReport): string =>
  formatJson(logsReportJson(report)).trimEnd();

export const renderLogs = (report: LogsReport, mode: "human" | "json"): string =>
  mode === "json" ? renderLogsJson(report) : renderLogsHuman(report);
