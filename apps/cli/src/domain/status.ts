import {
  SafeStatusReason as ServerSafeStatusReason,
  ServerChatAdapterRuntimeState,
  ServerHarnessAdapterRuntimeState,
  ServerOrchestratorActivationState,
  ServerOrchestratorState,
  safeStatusReasonFromString,
} from "@xmux/server/status";
import { Schema } from "effect";
import type {
  CliChatAdapterStatus as CliChatAdapterStatusResponse,
  CliHarnessAdapterStatus as CliHarnessAdapterStatusResponse,
  CliStatusResponse,
} from "../control/client";
import { CliResolvedServerPaths, CliRunningServer, type CliServerDiscovery } from "./discovery";

export class CliServerStatusEndpoint extends Schema.Class<CliServerStatusEndpoint>(
  "CliServerStatusEndpoint",
)({
  kind: Schema.Literal("unix-socket"),
  path: Schema.String,
}) {}

export const CliOrchestratorState = ServerOrchestratorState;
export type CliOrchestratorState = typeof CliOrchestratorState.Type;

export const CliOrchestratorActivation = ServerOrchestratorActivationState;
export type CliOrchestratorActivation = typeof CliOrchestratorActivation.Type;

export const CliSafeStatusReason = ServerSafeStatusReason;
export const cliSafeStatusReasonFromString = safeStatusReasonFromString;
export type CliSafeStatusReason = typeof CliSafeStatusReason.Type;

export const CliChatAdapterRuntimeState = ServerChatAdapterRuntimeState;
export type CliChatAdapterRuntimeState = typeof CliChatAdapterRuntimeState.Type;

export const CliHarnessAdapterRuntimeState = ServerHarnessAdapterRuntimeState;
export type CliHarnessAdapterRuntimeState = typeof CliHarnessAdapterRuntimeState.Type;

export class CliChatAdapterStatus extends Schema.Class<CliChatAdapterStatus>(
  "CliChatAdapterStatus",
)({
  id: Schema.String,
  state: CliChatAdapterRuntimeState,
  reason: Schema.optionalKey(CliSafeStatusReason),
}) {}

export class CliHarnessAdapterStatus extends Schema.Class<CliHarnessAdapterStatus>(
  "CliHarnessAdapterStatus",
)({
  id: Schema.String,
  state: CliHarnessAdapterRuntimeState,
  reason: Schema.optionalKey(CliSafeStatusReason),
}) {}

export class CliOrchestratorStatus extends Schema.Class<CliOrchestratorStatus>(
  "CliOrchestratorStatus",
)({
  state: CliOrchestratorState,
  activation: CliOrchestratorActivation,
  chats: Schema.Array(CliChatAdapterStatus),
  harnesses: Schema.Array(CliHarnessAdapterStatus),
  reason: Schema.optionalKey(CliSafeStatusReason),
}) {}

export class CliInactiveChatAdapterStatus extends Schema.Class<CliInactiveChatAdapterStatus>(
  "CliInactiveChatAdapterStatus",
)({
  id: Schema.String,
  state: Schema.Literal("configured"),
  runtime: Schema.Literal("unavailable"),
}) {}

export class CliInactiveHarnessAdapterStatus extends Schema.Class<CliInactiveHarnessAdapterStatus>(
  "CliInactiveHarnessAdapterStatus",
)({
  id: Schema.String,
  state: Schema.Literal("configured_lazy"),
  runtime: Schema.Literal("unavailable"),
}) {}

export const CliInactiveConfigStatus = Schema.Literals(["valid", "invalid"]);
export type CliInactiveConfigStatus = typeof CliInactiveConfigStatus.Type;

export class CliInactiveConfigSummary extends Schema.Class<CliInactiveConfigSummary>(
  "CliInactiveConfigSummary",
)({
  status: CliInactiveConfigStatus,
  chats: Schema.Array(CliInactiveChatAdapterStatus),
  harnesses: Schema.Array(CliInactiveHarnessAdapterStatus),
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
  orchestrator: CliOrchestratorStatus,
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

export class CliInactiveStatusReport extends Schema.Class<CliInactiveStatusReport>(
  "CliInactiveStatusReport",
)({
  _tag: Schema.Literals(["Stopped", "InvalidManifest", "WrongScope", "StaleManifestCleaned"]),
  paths: CliResolvedServerPaths,
  reason: Schema.String,
  configSummary: CliInactiveConfigSummary,
}) {}

export const CliStatusReport = Schema.Union([CliRunningStatusReport, CliInactiveStatusReport]);
export type CliStatusReport = typeof CliStatusReport.Type;

const chatAdapterStatusFromResponse = (
  adapter: CliChatAdapterStatusResponse,
): CliChatAdapterStatus =>
  new CliChatAdapterStatus(
    adapter.reason === undefined
      ? { id: adapter.id, state: adapter.state }
      : {
          id: adapter.id,
          state: adapter.state,
          reason: cliSafeStatusReasonFromString(adapter.reason),
        },
  );

const harnessAdapterStatusFromResponse = (
  adapter: CliHarnessAdapterStatusResponse,
): CliHarnessAdapterStatus =>
  new CliHarnessAdapterStatus(
    adapter.reason === undefined
      ? { id: adapter.id, state: adapter.state }
      : {
          id: adapter.id,
          state: adapter.state,
          reason: cliSafeStatusReasonFromString(adapter.reason),
        },
  );

const unknownOrchestratorStatus = new CliOrchestratorStatus({
  state: "not_started",
  activation: "unknown",
  chats: [],
  harnesses: [],
});

export const serverStatusPayloadFromResponse = (
  status: CliStatusResponse,
): CliServerStatusPayload =>
  new CliServerStatusPayload({
    version: status.version,
    protocolVersion: status.protocolVersion,
    pid: status.pid,
    startedAt: status.startedAt,
    uptimeMs: status.uptimeMs,
    state: status.state,
    configPath: status.configPath,
    stateDir: status.stateDir,
    scopeId: status.scopeId,
    endpoint: new CliServerStatusEndpoint({
      kind: status.endpoint.kind,
      path: status.endpoint.path,
    }),
    orchestrator:
      status.orchestrator === undefined
        ? unknownOrchestratorStatus
        : new CliOrchestratorStatus(
            status.orchestrator.reason === undefined
              ? {
                  state: status.orchestrator.state,
                  activation: status.orchestrator.activation,
                  chats: status.orchestrator.chats.map(chatAdapterStatusFromResponse),
                  harnesses: status.orchestrator.harnesses.map(harnessAdapterStatusFromResponse),
                }
              : {
                  state: status.orchestrator.state,
                  activation: status.orchestrator.activation,
                  chats: status.orchestrator.chats.map(chatAdapterStatusFromResponse),
                  harnesses: status.orchestrator.harnesses.map(harnessAdapterStatusFromResponse),
                  reason: cliSafeStatusReasonFromString(status.orchestrator.reason),
                },
          ),
  });

export const statusReportFromInactiveDiscovery = (input: {
  readonly discovery: Exclude<CliServerDiscovery, CliRunningServer>;
  readonly configSummary: CliInactiveConfigSummary;
}): CliInactiveStatusReport => {
  const inactive =
    input.discovery._tag === "Stopped"
      ? { reason: "no-manifest" }
      : input.discovery._tag === "InvalidManifest"
        ? { reason: input.discovery.reason ?? "invalid-manifest" }
        : input.discovery._tag === "WrongScope"
          ? { reason: "wrong-scope" }
          : { reason: "stale-manifest-removed" };

  return new CliInactiveStatusReport({
    _tag: input.discovery._tag,
    paths: input.discovery.paths,
    reason: inactive.reason,
    configSummary: input.configSummary,
  });
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
