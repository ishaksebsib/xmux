import { Schema } from "effect";
import { CliResolvedServerPaths, CliRunningServer, type CliServerDiscovery } from "./discovery";

export class CliServerStatusEndpoint extends Schema.Class<CliServerStatusEndpoint>(
  "CliServerStatusEndpoint",
)({
  kind: Schema.Literal("unix-socket"),
  path: Schema.String,
}) {}

export class CliServerStatusPayload extends Schema.Class<CliServerStatusPayload>(
  "CliServerStatusPayload",
)({
  version: Schema.Number,
  protocolVersion: Schema.Number,
  pid: Schema.Number,
  startedAt: Schema.String,
  uptimeMs: Schema.Number,
  state: Schema.String,
  configPath: Schema.String,
  stateDir: Schema.String,
  scopeId: Schema.String,
  endpoint: CliServerStatusEndpoint,
}) {}

export class CliRunningStatusReport extends Schema.Class<CliRunningStatusReport>(
  "CliRunningStatusReport",
)({
  _tag: Schema.Literal("Running"),
  paths: CliResolvedServerPaths,
  manifestPath: Schema.String,
  socketPath: Schema.String,
  pid: Schema.Number,
  pidAlive: Schema.Boolean,
  sessionId: Schema.String,
  server: CliServerStatusPayload,
}) {}

export class CliStoppedStatusReport extends Schema.Class<CliStoppedStatusReport>(
  "CliStoppedStatusReport",
)({
  _tag: Schema.Literal("Stopped"),
  paths: CliResolvedServerPaths,
}) {}

export class CliInvalidManifestStatusReport extends Schema.Class<CliInvalidManifestStatusReport>(
  "CliInvalidManifestStatusReport",
)({
  _tag: Schema.Literal("InvalidManifest"),
  paths: CliResolvedServerPaths,
  reason: Schema.optionalKey(Schema.String),
}) {}

export class CliWrongScopeStatusReport extends Schema.Class<CliWrongScopeStatusReport>(
  "CliWrongScopeStatusReport",
)({
  _tag: Schema.Literal("WrongScope"),
  paths: CliResolvedServerPaths,
}) {}

export class CliStaleManifestCleanedStatusReport extends Schema.Class<CliStaleManifestCleanedStatusReport>(
  "CliStaleManifestCleanedStatusReport",
)({
  _tag: Schema.Literal("StaleManifestCleaned"),
  paths: CliResolvedServerPaths,
}) {}

export const CliStatusReport = Schema.Union([
  CliRunningStatusReport,
  CliStoppedStatusReport,
  CliInvalidManifestStatusReport,
  CliWrongScopeStatusReport,
  CliStaleManifestCleanedStatusReport,
]);
export type CliStatusReport = typeof CliStatusReport.Type;

export const statusReportFromInactiveDiscovery = (
  discovery: Exclude<CliServerDiscovery, CliRunningServer>,
): Exclude<CliStatusReport, CliRunningStatusReport> => {
  switch (discovery._tag) {
    case "Stopped":
      return new CliStoppedStatusReport({ _tag: "Stopped", paths: discovery.paths });
    case "InvalidManifest":
      return discovery.reason === undefined
        ? new CliInvalidManifestStatusReport({
            _tag: "InvalidManifest",
            paths: discovery.paths,
          })
        : new CliInvalidManifestStatusReport({
            _tag: "InvalidManifest",
            paths: discovery.paths,
            reason: discovery.reason,
          });
    case "WrongScope":
      return new CliWrongScopeStatusReport({ _tag: "WrongScope", paths: discovery.paths });
    case "StaleManifestCleaned":
      return new CliStaleManifestCleanedStatusReport({
        _tag: "StaleManifestCleaned",
        paths: discovery.paths,
      });
  }
};

export const runningStatusReport = (
  discovery: CliRunningServer,
  server: CliServerStatusPayload,
): CliRunningStatusReport =>
  new CliRunningStatusReport({
    _tag: "Running",
    paths: discovery.paths,
    manifestPath: discovery.manifestPath,
    socketPath: discovery.socketPath,
    pid: discovery.pid,
    pidAlive: discovery.pidAlive,
    sessionId: discovery.sessionId,
    server,
  });
