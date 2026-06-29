import {
  inactiveServerStateFromDiscovery,
  type CliInactiveServerReason,
  type CliInactiveServerState,
  type CliInvalidManifest,
  type CliRunningServer,
  type CliServerDiscovery,
  type CliWrongScopeServer,
} from "./discovery";
import { CliLifecycleBlocked, type CliWaitOperation } from "./errors";
import type { CliOrchestratorStatus } from "./status";

export type CliInactiveLifecycleReason = CliInactiveServerReason;
export type CliInactiveLifecycleState = CliInactiveServerState;

export type CliStopReport =
  | {
      readonly _tag: "AlreadyStopped";
      readonly inactive: CliInactiveLifecycleState;
    }
  | {
      readonly _tag: "InvalidManifest";
      readonly inactive: CliInactiveLifecycleState;
    }
  | {
      readonly _tag: "WrongScope";
      readonly inactive: CliInactiveLifecycleState;
    }
  | {
      readonly _tag: "StaleManifestCleaned";
      readonly inactive: CliInactiveLifecycleState;
    }
  | {
      readonly _tag: "Stopped";
      readonly server: CliRunningServer;
      readonly shutdown: {
        readonly accepted: boolean;
        readonly alreadyStopping: boolean;
      };
    };

export type CliStartReport =
  | {
      readonly _tag: "AlreadyRunning";
      readonly server: CliRunningServer;
      readonly orchestrator: CliOrchestratorStatus;
    }
  | {
      readonly _tag: "Started";
      readonly server: CliRunningServer;
      readonly orchestrator: CliOrchestratorStatus;
      readonly previous: CliInactiveLifecycleState;
    };

export type CliShutdownState = {
  readonly accepted: boolean;
  readonly alreadyStopping: boolean;
};

export type CliRestartReport =
  | {
      readonly _tag: "Restarted";
      readonly previous: CliRunningServer;
      readonly server: CliRunningServer;
      readonly orchestrator: CliOrchestratorStatus;
      readonly shutdown: CliShutdownState;
    }
  | {
      readonly _tag: "Started";
      readonly server: CliRunningServer;
      readonly orchestrator: CliOrchestratorStatus;
      readonly previous: CliInactiveLifecycleState;
    };

export const inactiveLifecycleState = (
  discovery: Exclude<CliServerDiscovery, CliRunningServer>,
): CliInactiveLifecycleState => inactiveServerStateFromDiscovery(discovery);

export const stopReportFromInactiveDiscovery = (
  discovery: Exclude<CliServerDiscovery, CliRunningServer>,
): CliStopReport => {
  switch (discovery._tag) {
    case "Stopped":
      return {
        _tag: "AlreadyStopped",
        inactive: inactiveServerStateFromDiscovery(discovery),
      };
    case "InvalidManifest":
      return {
        _tag: "InvalidManifest",
        inactive: inactiveServerStateFromDiscovery(discovery),
      };
    case "WrongScope":
      return {
        _tag: "WrongScope",
        inactive: inactiveServerStateFromDiscovery(discovery),
      };
    case "StaleManifestCleaned":
      return {
        _tag: "StaleManifestCleaned",
        inactive: inactiveServerStateFromDiscovery(discovery),
      };
  }
};

export const lifecycleBlockedError = (input: {
  readonly operation: Extract<CliWaitOperation, "start" | "restart">;
  readonly discovery: CliInvalidManifest | CliWrongScopeServer;
}): CliLifecycleBlocked => {
  const reason = input.discovery._tag === "InvalidManifest" ? "invalid-manifest" : "wrong-scope";
  const message =
    input.discovery._tag === "InvalidManifest"
      ? `Cannot ${input.operation} xmux server because the server manifest is invalid.`
      : `Cannot ${input.operation} xmux server because the server manifest belongs to another scope.`;

  return new CliLifecycleBlocked({
    message,
    operation: input.operation,
    reason,
    configPath: input.discovery.paths.configPath,
    manifestPath: input.discovery.paths.manifestPath,
    socketPath: input.discovery.paths.socketPath,
  });
};

export const stoppedReport = (
  server: CliRunningServer,
  shutdown: CliShutdownState,
): CliStopReport => ({
  _tag: "Stopped",
  server,
  shutdown,
});

export const alreadyRunningReport = (
  server: CliRunningServer,
  orchestrator: CliOrchestratorStatus,
): CliStartReport => ({
  _tag: "AlreadyRunning",
  server,
  orchestrator,
});

export const startedReport = (
  server: CliRunningServer,
  orchestrator: CliOrchestratorStatus,
  previous: CliInactiveLifecycleState,
): CliStartReport => ({
  _tag: "Started",
  server,
  orchestrator,
  previous,
});

export const restartedReport = (
  previous: CliRunningServer,
  server: CliRunningServer,
  orchestrator: CliOrchestratorStatus,
  shutdown: CliShutdownState,
): CliRestartReport => ({
  _tag: "Restarted",
  previous,
  server,
  orchestrator,
  shutdown,
});

export const restartStartedReport = (
  server: CliRunningServer,
  orchestrator: CliOrchestratorStatus,
  previous: CliInactiveLifecycleState,
): CliRestartReport => ({
  _tag: "Started",
  server,
  orchestrator,
  previous,
});
