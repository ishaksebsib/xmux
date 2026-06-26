import type { JsonValue } from "./format";
import { formatJson, formatKeyValueLines } from "./format";
import type { CliResolvedServerPaths } from "../domain/discovery";
import type { CliStatusReport } from "../domain/status";

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

const inactiveReason = (report: Exclude<CliStatusReport, { readonly _tag: "Running" }>): string => {
  switch (report._tag) {
    case "Stopped":
      return "no-manifest";
    case "InvalidManifest":
      return report.reason ?? "invalid-manifest";
    case "WrongScope":
      return "wrong-scope";
    case "StaleManifestCleaned":
      return "stale-manifest-removed";
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
        },
      };
    case "Stopped":
    case "InvalidManifest":
    case "WrongScope":
    case "StaleManifestCleaned":
      return {
        status: statusLabel(report),
        _tag: report._tag,
        reason: inactiveReason(report),
        paths: pathJson(report.paths),
      };
  }
};

export const renderStatusHuman = (report: CliStatusReport): string => {
  switch (report._tag) {
    case "Running":
      return formatKeyValueLines([
        ["xmux server", report.server.state],
        ["pid", report.server.pid],
        ["session", report.sessionId],
        ["config", report.server.configPath],
        ["state dir", report.server.stateDir],
        ["socket", report.server.endpoint.path],
        ["manifest", report.manifestPath],
        ["uptime", formatUptime(report.server.uptimeMs)],
      ]).trimEnd();
    case "Stopped":
    case "InvalidManifest":
    case "WrongScope":
    case "StaleManifestCleaned":
      return formatKeyValueLines([
        ["xmux server", statusLabel(report)],
        ["reason", inactiveReason(report)],
        ["config", report.paths.configPath],
        ["state dir", report.paths.stateDir],
        ["socket", report.paths.socketPath],
        ["manifest", report.paths.manifestPath],
      ]).trimEnd();
  }
};

export const renderStatusJson = (report: CliStatusReport): string =>
  formatJson(statusReportJson(report)).trimEnd();

export const renderStatus = (report: CliStatusReport, mode: "human" | "json"): string =>
  mode === "json" ? renderStatusJson(report) : renderStatusHuman(report);
