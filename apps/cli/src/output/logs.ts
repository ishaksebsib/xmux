import type { CliLogsResponse } from "../control/client";
import type { CliLogsReport } from "../domain/logs";
import type { CliOutputCapabilities } from "./capabilities";
import { plainCliOutputCapabilities } from "./capabilities";
import { formatJson, type JsonValue } from "./format";
import { cell, renderSections, row, statusCell } from "./layout";
import { logLevelSeverity } from "./presentation";
import { padRight, styleToken, type UiSeverity } from "./theme";

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

const logEntryMetadata = (
  entry: LogEntry,
): ReadonlyArray<readonly [label: string, value: JsonValue]> => {
  const metadata: Array<readonly [label: string, value: JsonValue]> = [];

  if (entry.annotations !== undefined && nonEmptyRecord(entry.annotations)) {
    metadata.push(["annotations", entry.annotations]);
  }

  if (entry.spans !== undefined && nonEmptyRecord(entry.spans)) {
    metadata.push(["spans", entry.spans]);
  }

  if (entry.cause !== undefined) {
    metadata.push(["cause", entry.cause]);
  }

  return metadata;
};

// The server API owns bounds and redaction; the CLI only formats the decoded response.
const renderLogEntryHuman = (
  capabilities: CliOutputCapabilities,
  entry: LogEntry,
  levelWidth: number,
): string => {
  const level = entry.level.toUpperCase();
  const renderedLevel = styleToken(
    capabilities,
    logLevelSeverity(entry.level),
    padRight(level, levelWidth),
  );
  const renderedTimestamp = styleToken(capabilities, "timestamp", entry.timestamp);
  const renderedMessage = humanJsonValue(entry.message);
  const header = `${renderedTimestamp}  ${renderedLevel}  ${renderedMessage}`;
  const metadata = logEntryMetadata(entry);

  if (metadata.length === 0) return header;

  const metadataLines = metadata.map(
    ([label, value]) =>
      `  ${styleToken(capabilities, "muted", label)} ${styleToken(capabilities, "muted", humanJsonValue(value))}`,
  );
  return [header, ...metadataLines].join("\n");
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

const entriesLabel = (count: number): string => {
  if (count === 0) return "empty";
  return `${count} entr${count === 1 ? "y" : "ies"}`;
};

const entriesSeverity = (count: number): UiSeverity => (count === 0 ? "muted" : "success");

export const renderLogsHuman = (
  report: LogsReport,
  capabilities: CliOutputCapabilities = plainCliOutputCapabilities,
): string => {
  const count = report.response.entries.length;
  const header = renderSections(capabilities, [
    {
      title: "LOGS",
      rows: [
        row(
          cell("entries", "label"),
          statusCell(capabilities, entriesLabel(count), entriesSeverity(count)),
        ),
        row(cell("scope", "label"), cell(report.server.paths.scopeId, "code")),
        row(cell("config", "label"), cell(report.server.paths.configPath, "code")),
        row(cell("socket", "label"), cell(report.server.socketPath, "code")),
      ],
    },
  ]).trimEnd();

  if (count === 0) return header;

  const levelWidth = report.response.entries.reduce(
    (maximum, entry) => Math.max(maximum, entry.level.length),
    0,
  );
  const entries = report.response.entries
    .map((entry) => renderLogEntryHuman(capabilities, entry, levelWidth))
    .join("\n");

  return `${header}\n\n${entries}`;
};

export const renderLogsJson = (report: LogsReport): string =>
  formatJson(logsReportJson(report)).trimEnd();

export const renderLogs = (
  report: LogsReport,
  mode: "human" | "json",
  capabilities: CliOutputCapabilities = plainCliOutputCapabilities,
): string => (mode === "json" ? renderLogsJson(report) : renderLogsHuman(report, capabilities));
