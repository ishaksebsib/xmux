import { Schema } from "effect";

export class CliResolvedServerPaths extends Schema.Class<CliResolvedServerPaths>(
  "CliResolvedServerPaths",
)({
  configPath: Schema.String,
  stateDir: Schema.String,
  runtimeDir: Schema.String,
  logDir: Schema.String,
  dbPath: Schema.String,
  manifestPath: Schema.String,
  startupLockPath: Schema.String,
  socketPath: Schema.String,
  scopeId: Schema.String,
}) {}

export const CliInactiveServerReason = Schema.Literals([
  "no-manifest",
  "invalid-manifest",
  "wrong-scope",
  "stale-manifest-removed",
]);
export type CliInactiveServerReason = typeof CliInactiveServerReason.Type;

export class CliServerManifest extends Schema.Class<CliServerManifest>("CliServerManifest")({
  version: Schema.Number,
  protocolVersion: Schema.Number,
  pid: Schema.Number,
  sessionId: Schema.String,
  startedAt: Schema.String,
  configPath: Schema.String,
  stateDir: Schema.String,
  scopeId: Schema.String,
  endpointPath: Schema.String,
  ownerClient: Schema.String,
  ownerVersion: Schema.String,
  ownerExecutablePath: Schema.String,
}) {}

export class CliNoManifest extends Schema.Class<CliNoManifest>("CliNoManifest")({
  _tag: Schema.Literal("NoManifest"),
  paths: CliResolvedServerPaths,
}) {}

export class CliInvalidManifest extends Schema.Class<CliInvalidManifest>("CliInvalidManifest")({
  _tag: Schema.Literal("InvalidManifest"),
  paths: CliResolvedServerPaths,
  reason: Schema.optionalKey(Schema.String),
}) {}

export class CliValidManifest extends Schema.Class<CliValidManifest>("CliValidManifest")({
  _tag: Schema.Literal("ValidManifest"),
  paths: CliResolvedServerPaths,
  manifest: CliServerManifest,
}) {}

export const CliServerManifestDiscovery = Schema.Union([
  CliNoManifest,
  CliInvalidManifest,
  CliValidManifest,
]);
export type CliServerManifestDiscovery = typeof CliServerManifestDiscovery.Type;

export class CliRunningServer extends Schema.Class<CliRunningServer>("CliRunningServer")({
  _tag: Schema.Literal("Running"),
  paths: CliResolvedServerPaths,
  manifestPath: Schema.String,
  socketPath: Schema.String,
  pid: Schema.Number,
  pidAlive: Schema.Boolean,
  sessionId: Schema.String,
}) {}

export class CliStoppedServer extends Schema.Class<CliStoppedServer>("CliStoppedServer")({
  _tag: Schema.Literal("Stopped"),
  paths: CliResolvedServerPaths,
}) {}

export class CliWrongScopeServer extends Schema.Class<CliWrongScopeServer>("CliWrongScopeServer")({
  _tag: Schema.Literal("WrongScope"),
  paths: CliResolvedServerPaths,
}) {}

export class CliStaleManifestCleanedServer extends Schema.Class<CliStaleManifestCleanedServer>(
  "CliStaleManifestCleanedServer",
)({
  _tag: Schema.Literal("StaleManifestCleaned"),
  paths: CliResolvedServerPaths,
}) {}

export const CliServerDiscovery = Schema.Union([
  CliRunningServer,
  CliStoppedServer,
  CliInvalidManifest,
  CliWrongScopeServer,
  CliStaleManifestCleanedServer,
]);
export type CliServerDiscovery = typeof CliServerDiscovery.Type;

export interface CliInactiveServerState {
  readonly reason: CliInactiveServerReason;
  readonly paths: CliResolvedServerPaths;
  readonly manifestReason?: string;
}

export const inactiveServerStateFromDiscovery = (
  discovery: Exclude<CliServerDiscovery, CliRunningServer>,
): CliInactiveServerState => {
  switch (discovery._tag) {
    case "Stopped":
      return { reason: "no-manifest", paths: discovery.paths };
    case "InvalidManifest":
      return discovery.reason === undefined
        ? { reason: "invalid-manifest", paths: discovery.paths }
        : {
            reason: "invalid-manifest",
            paths: discovery.paths,
            manifestReason: discovery.reason,
          };
    case "WrongScope":
      return { reason: "wrong-scope", paths: discovery.paths };
    case "StaleManifestCleaned":
      return { reason: "stale-manifest-removed", paths: discovery.paths };
  }
};
