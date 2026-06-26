import { Schema } from "effect";
import {
  CliInvalidManifest,
  CliResolvedServerPaths,
  CliRunningServer,
  CliStaleManifestCleanedServer,
  CliStoppedServer,
  CliWrongScopeServer,
  type CliServerDiscovery,
} from "./discovery";

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

export const CliStatusReport = Schema.Union([
  CliRunningStatusReport,
  CliStoppedServer,
  CliInvalidManifest,
  CliWrongScopeServer,
  CliStaleManifestCleanedServer,
]);
export type CliStatusReport = typeof CliStatusReport.Type;

export const statusReportFromInactiveDiscovery = (
  discovery: Exclude<CliServerDiscovery, CliRunningServer>,
): Exclude<CliStatusReport, CliRunningStatusReport> => discovery;

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
