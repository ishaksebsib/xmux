import type { CliInactiveLifecycleState, CliStartReport, CliStopReport } from "../domain/lifecycle";
import type { CliConfigPath } from "../domain/input";
import type { CliRunningServer } from "../domain/discovery";
import { formatKeyValueLines } from "./format";

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

export const foregroundRetryCommand = (configPath: CliConfigPath | undefined): string =>
  configPath === undefined
    ? "xmux server run --foreground"
    : `xmux server run --foreground --config ${shellQuote(configPath)}`;

const renderInactiveRows = (inactive: CliInactiveLifecycleState) =>
  formatKeyValueLines([
    ["reason", inactive.manifestReason ?? inactive.reason],
    ["config", inactive.paths.configPath],
    ["state dir", inactive.paths.stateDir],
    ["socket", inactive.paths.socketPath],
    ["manifest", inactive.paths.manifestPath],
  ]).trimEnd();

const renderServerRows = (server: CliRunningServer) =>
  formatKeyValueLines([
    ["pid", server.pid],
    ["session", server.sessionId],
    ["config", server.paths.configPath],
    ["state dir", server.paths.stateDir],
    ["socket", server.socketPath],
    ["manifest", server.manifestPath],
  ]).trimEnd();

const shutdownState = (shutdown: {
  readonly accepted: boolean;
  readonly alreadyStopping: boolean;
}): string => {
  if (shutdown.accepted) return "accepted";
  if (shutdown.alreadyStopping) return "already stopping";
  return "not accepted";
};

const inactiveStatusLabel = (
  report: Exclude<CliStopReport, { readonly _tag: "Stopped" }>,
): string => {
  switch (report._tag) {
    case "AlreadyStopped":
      return "already stopped";
    case "InvalidManifest":
      return "invalid-manifest";
    case "WrongScope":
      return "wrong-scope";
    case "StaleManifestCleaned":
      return "stale-manifest-cleaned";
  }
};

export const renderStop = (report: CliStopReport): string => {
  switch (report._tag) {
    case "AlreadyStopped":
    case "InvalidManifest":
    case "WrongScope":
    case "StaleManifestCleaned":
      return `${formatKeyValueLines([["xmux server", inactiveStatusLabel(report)]]).trimEnd()}\n${renderInactiveRows(report.inactive)}`;
    case "Stopped":
      return `${formatKeyValueLines([
        ["xmux server", "stopped"],
        ["shutdown", shutdownState(report.shutdown)],
      ]).trimEnd()}\n${renderServerRows(report.server)}`;
  }
};

export const renderStart = (report: CliStartReport): string => {
  switch (report._tag) {
    case "AlreadyRunning":
      return `${formatKeyValueLines([["xmux server", "already running"]]).trimEnd()}\n${renderServerRows(report.server)}`;
    case "Started":
      return `${formatKeyValueLines([
        ["xmux server", "started"],
        ["previous state", report.previous.reason],
      ]).trimEnd()}\n${renderServerRows(report.server)}`;
  }
};
