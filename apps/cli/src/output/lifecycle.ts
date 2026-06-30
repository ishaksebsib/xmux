import type {
  CliInactiveLifecycleState,
  CliRestartReport,
  CliShutdownState,
  CliStartReport,
  CliStopReport,
} from "../domain/lifecycle";
import type { CliConfigPath } from "../domain/input";
import type { CliRunningServer } from "../domain/discovery";
import type { CliOutputCapabilities } from "./capabilities";
import { plainCliOutputCapabilities } from "./capabilities";
import { cell, renderSections, row, statusCell, type UiRow, type UiSection } from "./layout";
import { runningAdapterSections, runningOrchestratorRow } from "./orchestrator";
import { humanizeIdentifier } from "./presentation";
import type { UiSeverity } from "./theme";

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

export const foregroundRetryCommand = (configPath: CliConfigPath | undefined): string =>
  configPath === undefined
    ? "xmux server run --foreground"
    : `xmux server run --foreground --config ${shellQuote(configPath)}`;

const inactiveReason = (inactive: CliInactiveLifecycleState): string =>
  humanizeIdentifier(inactive.manifestReason ?? inactive.reason);

const previousStateNote = (inactive: CliInactiveLifecycleState): string => {
  switch (inactive.reason) {
    case "no-manifest":
      return "was stopped";
    case "stale-manifest-removed":
      return "was stopped (stale manifest removed)";
    case "invalid-manifest":
      return `was blocked (${inactiveReason(inactive)})`;
    case "wrong-scope":
      return "was blocked (wrong scope)";
  }
};

const serverDetailRows = (server: CliRunningServer): ReadonlyArray<UiRow> => [
  row(cell("pid", "label"), cell(String(server.pid), "value")),
  row(cell("session", "label"), cell(server.sessionId, "code")),
];

const shutdownState = (shutdown: CliShutdownState): string => {
  if (shutdown.accepted) return "accepted";
  if (shutdown.alreadyStopping) return "already stopping";
  return "not accepted";
};

const shutdownSeverity = (shutdown: CliShutdownState): UiSeverity => {
  if (shutdown.accepted) return "success";
  if (shutdown.alreadyStopping) return "warning";
  return "danger";
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

const inactiveStopSeverity = (
  report: Exclude<CliStopReport, { readonly _tag: "Stopped" }>,
): UiSeverity => {
  switch (report._tag) {
    case "AlreadyStopped":
    case "StaleManifestCleaned":
      return "warning";
    case "InvalidManifest":
    case "WrongScope":
      return "danger";
  }
};

const lifecycleSections = (
  xmuxRows: ReadonlyArray<UiRow>,
  adapterSections: ReadonlyArray<UiSection> = [],
): ReadonlyArray<UiSection> => [{ title: "XMUX", rows: xmuxRows }, ...adapterSections];

export const renderStop = (
  report: CliStopReport,
  capabilities: CliOutputCapabilities = plainCliOutputCapabilities,
): string => {
  switch (report._tag) {
    case "AlreadyStopped":
    case "InvalidManifest":
    case "WrongScope":
    case "StaleManifestCleaned":
      return renderSections(
        capabilities,
        lifecycleSections([
          row(
            cell("server", "label"),
            statusCell(
              capabilities,
              humanizeIdentifier(inactiveStatusLabel(report)),
              inactiveStopSeverity(report),
            ),
          ),
          row(cell("reason", "label"), cell(inactiveReason(report.inactive), "muted")),
        ]),
      ).trimEnd();
    case "Stopped":
      return renderSections(
        capabilities,
        lifecycleSections([
          row(cell("server", "label"), statusCell(capabilities, "stopped", "success")),
          row(
            cell("shutdown", "label"),
            statusCell(
              capabilities,
              shutdownState(report.shutdown),
              shutdownSeverity(report.shutdown),
            ),
          ),
          ...serverDetailRows(report.server),
        ]),
      ).trimEnd();
  }
};

export const renderStart = (
  report: CliStartReport,
  capabilities: CliOutputCapabilities = plainCliOutputCapabilities,
): string => {
  switch (report._tag) {
    case "AlreadyRunning":
      return renderSections(
        capabilities,
        lifecycleSections(
          [
            row(cell("server", "label"), statusCell(capabilities, "already running", "success")),
            ...serverDetailRows(report.server),
            runningOrchestratorRow(capabilities, report.orchestrator),
          ],
          runningAdapterSections(capabilities, report.orchestrator),
        ),
      ).trimEnd();
    case "Started":
      return renderSections(
        capabilities,
        lifecycleSections(
          [
            row(
              cell("server", "label"),
              statusCell(capabilities, "started", "success"),
              cell(previousStateNote(report.previous), "muted"),
            ),
            ...serverDetailRows(report.server),
            runningOrchestratorRow(capabilities, report.orchestrator),
          ],
          runningAdapterSections(capabilities, report.orchestrator),
        ),
      ).trimEnd();
  }
};

export const renderRestart = (
  report: CliRestartReport,
  capabilities: CliOutputCapabilities = plainCliOutputCapabilities,
): string => {
  switch (report._tag) {
    case "Restarted":
      return renderSections(
        capabilities,
        lifecycleSections(
          [
            row(cell("server", "label"), statusCell(capabilities, "restarted", "success")),
            row(
              cell("shutdown", "label"),
              statusCell(
                capabilities,
                shutdownState(report.shutdown),
                shutdownSeverity(report.shutdown),
              ),
            ),
            row(cell("previous session", "label"), cell(report.previous.sessionId, "code")),
            ...serverDetailRows(report.server),
            runningOrchestratorRow(capabilities, report.orchestrator),
          ],
          runningAdapterSections(capabilities, report.orchestrator),
        ),
      ).trimEnd();
    case "Started":
      return renderSections(
        capabilities,
        lifecycleSections(
          [
            row(
              cell("server", "label"),
              statusCell(capabilities, "started", "success"),
              cell(previousStateNote(report.previous), "muted"),
            ),
            ...serverDetailRows(report.server),
            runningOrchestratorRow(capabilities, report.orchestrator),
          ],
          runningAdapterSections(capabilities, report.orchestrator),
        ),
      ).trimEnd();
  }
};
