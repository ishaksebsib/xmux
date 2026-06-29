import type { JsonValue } from "./format";
import { formatJson, formatKeyValueLines } from "./format";
import type { CliResolvedServerPaths } from "../domain/discovery";
import type {
  CliChatAdapterStatus,
  CliHarnessAdapterStatus,
  CliInactiveChatAdapterStatus,
  CliInactiveHarnessAdapterStatus,
  CliStatusReport,
} from "../domain/status";

type RunningAdapterStatus = CliChatAdapterStatus | CliHarnessAdapterStatus;
type InactiveAdapterStatus = CliInactiveChatAdapterStatus | CliInactiveHarnessAdapterStatus;

const statusLabel = (report: CliStatusReport): string => {
  switch (report._tag) {
    case "Running":
      return "running";
    case "Stopped":
      return "stopped";
    case "InvalidManifest":
      return "invalid-manifest";
    case "WrongScope":
      return "wrong-scope";
    case "StaleManifestCleaned":
      return "stale-manifest-cleaned";
  }
};

const formatUptime = (uptimeMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(uptimeMs / 1_000));
  if (totalSeconds < 1) return "<1s";

  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 1) return `${seconds}s`;

  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 1) return `${minutes}m${seconds}s`;

  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  if (days < 1) return `${hours}h${minutes}m`;

  return `${days}d${hours}h`;
};

const pathJson = (paths: CliResolvedServerPaths): JsonValue => ({
  configPath: paths.configPath,
  stateDir: paths.stateDir,
  runtimeDir: paths.runtimeDir,
  logDir: paths.logDir,
  manifestPath: paths.manifestPath,
  startupLockPath: paths.startupLockPath,
  socketPath: paths.socketPath,
  scopeId: paths.scopeId,
});

const adapterJson = (adapter: RunningAdapterStatus): JsonValue => ({
  id: adapter.id,
  state: adapter.state,
  ...(adapter.reason === undefined ? {} : { reason: adapter.reason }),
});

const inactiveAdapterJson = (adapter: InactiveAdapterStatus): JsonValue => ({
  id: adapter.id,
  state: adapter.state,
  runtime: adapter.runtime,
});

const formatAdapterLine = (adapter: RunningAdapterStatus): string =>
  `  ${adapter.id}: ${adapter.state}${adapter.reason === undefined ? "" : ` (${adapter.reason})`}`;

const formatInactiveAdapterLine = (adapter: InactiveAdapterStatus): string =>
  `  ${adapter.id}: ${adapter.state}, runtime unavailable`;

const sectionLines = (title: string, lines: readonly string[]): readonly string[] =>
  lines.length === 0 ? [title, "  (none)"] : [title, ...lines];

const runningOrchestratorLines = (
  report: Extract<CliStatusReport, { readonly _tag: "Running" }>,
) => [
  "",
  `orchestrator: ${report.server.orchestrator.state}`,
  ...sectionLines("chats:", report.server.orchestrator.chats.map(formatAdapterLine)),
  ...sectionLines("harnesses:", report.server.orchestrator.harnesses.map(formatAdapterLine)),
];

const inactiveOrchestratorLines = (
  report: Exclude<CliStatusReport, { readonly _tag: "Running" }>,
) => [
  "",
  "orchestrator: unavailable (server not running)",
  `config status: ${report.configSummary.status}`,
  ...sectionLines("chats:", report.configSummary.chats.map(formatInactiveAdapterLine)),
  ...sectionLines("harnesses:", report.configSummary.harnesses.map(formatInactiveAdapterLine)),
];

export const statusReportJson = (report: CliStatusReport): JsonValue => {
  switch (report._tag) {
    case "Running":
      return {
        status: "running",
        _tag: "Running",
        paths: pathJson(report.paths),
        discovery: {
          pid: report.pid,
          pidAlive: report.pidAlive,
          sessionId: report.sessionId,
          manifestPath: report.manifestPath,
          socketPath: report.socketPath,
        },
        server: {
          version: report.server.version,
          protocolVersion: report.server.protocolVersion,
          pid: report.server.pid,
          startedAt: report.server.startedAt,
          uptimeMs: report.server.uptimeMs,
          state: report.server.state,
          configPath: report.server.configPath,
          stateDir: report.server.stateDir,
          scopeId: report.server.scopeId,
          endpoint: {
            kind: report.server.endpoint.kind,
            path: report.server.endpoint.path,
          },
          orchestrator: {
            state: report.server.orchestrator.state,
            activation: report.server.orchestrator.activation,
            chats: report.server.orchestrator.chats.map(adapterJson),
            harnesses: report.server.orchestrator.harnesses.map(adapterJson),
            ...(report.server.orchestrator.reason === undefined
              ? {}
              : { reason: report.server.orchestrator.reason }),
          },
        },
      };
    case "Stopped":
    case "InvalidManifest":
    case "WrongScope":
    case "StaleManifestCleaned":
      return {
        status: statusLabel(report),
        _tag: report._tag,
        reason: report.reason,
        paths: pathJson(report.paths),
        configSummary: {
          status: report.configSummary.status,
          chats: report.configSummary.chats.map(inactiveAdapterJson),
          harnesses: report.configSummary.harnesses.map(inactiveAdapterJson),
        },
      };
  }
};

export const renderStatusHuman = (report: CliStatusReport): string => {
  switch (report._tag) {
    case "Running":
      return [
        formatKeyValueLines([
          ["xmux server", report.server.state],
          ["pid", report.server.pid],
          ["session", report.sessionId],
          ["uptime", formatUptime(report.server.uptimeMs)],
        ]).trimEnd(),
        ...runningOrchestratorLines(report),
      ]
        .join("\n")
        .trimEnd();
    case "Stopped":
    case "InvalidManifest":
    case "WrongScope":
    case "StaleManifestCleaned":
      return [
        formatKeyValueLines([
          ["xmux server", statusLabel(report)],
          ["reason", report.reason],
        ]).trimEnd(),
        ...inactiveOrchestratorLines(report),
      ]
        .join("\n")
        .trimEnd();
  }
};

export const renderStatusJson = (report: CliStatusReport): string =>
  formatJson(statusReportJson(report)).trimEnd();

export const renderStatus = (report: CliStatusReport, mode: "human" | "json"): string =>
  mode === "json" ? renderStatusJson(report) : renderStatusHuman(report);
