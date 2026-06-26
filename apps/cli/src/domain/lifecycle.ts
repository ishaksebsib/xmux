import type { CliResolvedServerPaths, CliRunningServer, CliServerDiscovery } from "./discovery";

export type CliInactiveLifecycleReason =
  | "no-manifest"
  | "invalid-manifest"
  | "wrong-scope"
  | "stale-manifest-removed";

export interface CliInactiveLifecycleState {
  readonly reason: CliInactiveLifecycleReason;
  readonly paths: CliResolvedServerPaths;
  readonly manifestReason?: string;
}

export type CliStopReport =
  | {
      readonly _tag: "AlreadyStopped";
      readonly inactive: CliInactiveLifecycleState & { readonly reason: "no-manifest" };
    }
  | {
      readonly _tag: "InvalidManifest";
      readonly inactive: CliInactiveLifecycleState & { readonly reason: "invalid-manifest" };
    }
  | {
      readonly _tag: "WrongScope";
      readonly inactive: CliInactiveLifecycleState & { readonly reason: "wrong-scope" };
    }
  | {
      readonly _tag: "StaleManifestCleaned";
      readonly inactive: CliInactiveLifecycleState & { readonly reason: "stale-manifest-removed" };
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
    }
  | {
      readonly _tag: "Started";
      readonly server: CliRunningServer;
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
      readonly shutdown: CliShutdownState;
    }
  | {
      readonly _tag: "Started";
      readonly server: CliRunningServer;
      readonly previous: CliInactiveLifecycleState;
    };

export const inactiveLifecycleState = (
  discovery: Exclude<CliServerDiscovery, CliRunningServer>,
): CliInactiveLifecycleState => {
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

export const stopReportFromInactiveDiscovery = (
  discovery: Exclude<CliServerDiscovery, CliRunningServer>,
): CliStopReport => {
  switch (discovery._tag) {
    case "Stopped":
      return {
        _tag: "AlreadyStopped",
        inactive: { reason: "no-manifest", paths: discovery.paths },
      };
    case "InvalidManifest":
      return {
        _tag: "InvalidManifest",
        inactive:
          discovery.reason === undefined
            ? { reason: "invalid-manifest", paths: discovery.paths }
            : {
                reason: "invalid-manifest",
                paths: discovery.paths,
                manifestReason: discovery.reason,
              },
      };
    case "WrongScope":
      return {
        _tag: "WrongScope",
        inactive: { reason: "wrong-scope", paths: discovery.paths },
      };
    case "StaleManifestCleaned":
      return {
        _tag: "StaleManifestCleaned",
        inactive: { reason: "stale-manifest-removed", paths: discovery.paths },
      };
  }
};

export const stoppedReport = (
  server: CliRunningServer,
  shutdown: CliShutdownState,
): CliStopReport => ({
  _tag: "Stopped",
  server,
  shutdown,
});

export const alreadyRunningReport = (server: CliRunningServer): CliStartReport => ({
  _tag: "AlreadyRunning",
  server,
});

export const startedReport = (
  server: CliRunningServer,
  previous: CliInactiveLifecycleState,
): CliStartReport => ({
  _tag: "Started",
  server,
  previous,
});

export const restartedReport = (
  previous: CliRunningServer,
  server: CliRunningServer,
  shutdown: CliShutdownState,
): CliRestartReport => ({
  _tag: "Restarted",
  previous,
  server,
  shutdown,
});

export const restartStartedReport = (
  server: CliRunningServer,
  previous: CliInactiveLifecycleState,
): CliRestartReport => ({
  _tag: "Started",
  server,
  previous,
});
