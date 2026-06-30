import type { CliOutputCapabilities } from "./capabilities";
import { cell, row, statusCell, type UiRow, type UiSection } from "./layout";
import {
  chatAdapterStateSeverity,
  harnessAdapterStateSeverity,
  humanizeIdentifier,
  orchestratorStateSeverity,
} from "./presentation";
import type {
  CliChatAdapterStatus,
  CliHarnessAdapterStatus,
  CliInactiveChatAdapterStatus,
  CliInactiveConfigSummary,
  CliInactiveHarnessAdapterStatus,
  CliOrchestratorStatus,
} from "../domain/status";

type RunningAdapterStatus = CliChatAdapterStatus | CliHarnessAdapterStatus;
type InactiveAdapterStatus = CliInactiveChatAdapterStatus | CliInactiveHarnessAdapterStatus;

const reasonNote = (reason: string | undefined): string | undefined =>
  reason === undefined ? undefined : `reason: ${humanizeIdentifier(reason)}`;

const runningAdapterReasonCell = (adapter: RunningAdapterStatus) => {
  const note = reasonNote(adapter.reason);
  return note === undefined ? undefined : cell(note, "muted");
};

const chatRuntimeLabel = (state: CliChatAdapterStatus["state"]): string => {
  switch (state) {
    case "configured":
      return "runtime configured";
    case "opening":
      return "opening";
    case "starting":
      return "starting";
    case "active":
      return "active";
    case "failed":
      return "failed";
    case "closing":
      return "closing";
    case "stopped":
      return "stopped";
  }
};

const harnessRuntimeLabel = (state: CliHarnessAdapterStatus["state"]): string => {
  switch (state) {
    case "configured_lazy":
      return "lazy/on-demand";
    case "opening":
      return "opening";
    case "opened":
      return "opened";
    case "failed":
      return "failed";
    case "closing":
      return "closing";
    case "closed":
      return "closed";
  }
};

const runningChatRow = (
  capabilities: CliOutputCapabilities,
  adapter: CliChatAdapterStatus,
): UiRow => {
  const maybeReason = runningAdapterReasonCell(adapter);
  const cells = [
    cell(adapter.id, "label"),
    statusCell(capabilities, "configured", "success"),
    statusCell(
      capabilities,
      chatRuntimeLabel(adapter.state),
      chatAdapterStateSeverity(adapter.state),
    ),
  ];

  return maybeReason === undefined ? row(...cells) : row(...cells, maybeReason);
};

const runningHarnessRow = (
  capabilities: CliOutputCapabilities,
  adapter: CliHarnessAdapterStatus,
): UiRow => {
  const maybeReason = runningAdapterReasonCell(adapter);
  const cells = [
    cell(adapter.id, "label"),
    statusCell(capabilities, "configured", "success"),
    statusCell(
      capabilities,
      harnessRuntimeLabel(adapter.state),
      harnessAdapterStateSeverity(adapter.state),
    ),
  ];

  return maybeReason === undefined ? row(...cells) : row(...cells, maybeReason);
};

const inactiveAdapterRow = (
  capabilities: CliOutputCapabilities,
  adapter: InactiveAdapterStatus,
): UiRow =>
  row(
    cell(adapter.id, "label"),
    statusCell(capabilities, "configured", "success"),
    statusCell(capabilities, "runtime unavailable", "muted"),
  );

export const runningOrchestratorRow = (
  capabilities: CliOutputCapabilities,
  orchestrator: CliOrchestratorStatus,
  label = "orchestrator",
): UiRow => {
  const baseCells = [
    cell(label, "label"),
    statusCell(
      capabilities,
      humanizeIdentifier(orchestrator.state),
      orchestratorStateSeverity(orchestrator.state),
    ),
  ];
  const note = reasonNote(orchestrator.reason);
  return note === undefined ? row(...baseCells) : row(...baseCells, cell(note, "muted"));
};

export const inactiveOrchestratorRow = (
  capabilities: CliOutputCapabilities,
  label = "orchestrator",
): UiRow =>
  row(
    cell(label, "label"),
    statusCell(capabilities, "unavailable", "muted"),
    cell("server not running", "muted"),
  );

export const runningAdapterSections = (
  capabilities: CliOutputCapabilities,
  orchestrator: CliOrchestratorStatus,
): ReadonlyArray<UiSection> => [
  {
    title: "CHATS",
    rows: orchestrator.chats.map((adapter) => runningChatRow(capabilities, adapter)),
  },
  {
    title: "HARNESSES",
    rows: orchestrator.harnesses.map((adapter) => runningHarnessRow(capabilities, adapter)),
  },
];

export const inactiveAdapterSections = (
  capabilities: CliOutputCapabilities,
  configSummary: CliInactiveConfigSummary,
): ReadonlyArray<UiSection> => [
  {
    title: "CHATS",
    rows: configSummary.chats.map((adapter) => inactiveAdapterRow(capabilities, adapter)),
  },
  {
    title: "HARNESSES",
    rows: configSummary.harnesses.map((adapter) => inactiveAdapterRow(capabilities, adapter)),
  },
];
