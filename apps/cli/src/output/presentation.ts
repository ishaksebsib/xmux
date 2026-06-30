import type {
  CliChatAdapterRuntimeState,
  CliHarnessAdapterRuntimeState,
  CliInactiveConfigStatus,
  CliOrchestratorState,
} from "../domain/status";
import type { UiSeverity } from "./theme";

export const humanizeIdentifier = (value: string): string =>
  value.replaceAll("_", " ").replaceAll("-", " ");

export const serverStateSeverity = (state: string): UiSeverity => {
  switch (state) {
    case "ready":
      return "success";
    case "starting":
    case "reloading":
      return "info";
    case "degraded":
    case "stopping":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "info";
  }
};

export const inactiveServerSeverity = (status: string): UiSeverity => {
  switch (status) {
    case "stopped":
    case "stale-manifest-cleaned":
      return "warning";
    case "invalid-manifest":
    case "wrong-scope":
      return "danger";
    default:
      return "info";
  }
};

export const configStatusSeverity = (status: CliInactiveConfigStatus): UiSeverity => {
  switch (status) {
    case "valid":
      return "success";
    case "invalid":
      return "danger";
  }
};

export const orchestratorStateSeverity = (state: CliOrchestratorState): UiSeverity => {
  switch (state) {
    case "running":
      return "success";
    case "starting":
      return "info";
    case "disabled":
    case "not_started":
    case "stopping":
    case "stopped":
      return "warning";
    case "failed":
      return "danger";
  }
};

export const chatAdapterStateSeverity = (state: CliChatAdapterRuntimeState): UiSeverity => {
  switch (state) {
    case "active":
      return "success";
    case "opening":
    case "starting":
      return "info";
    case "configured":
    case "closing":
    case "stopped":
      return "warning";
    case "failed":
      return "danger";
  }
};

export const harnessAdapterStateSeverity = (state: CliHarnessAdapterRuntimeState): UiSeverity => {
  switch (state) {
    case "opened":
      return "success";
    case "opening":
      return "info";
    case "configured_lazy":
    case "closing":
    case "closed":
      return "warning";
    case "failed":
      return "danger";
  }
};

export const logLevelSeverity = (level: string): UiSeverity => {
  switch (level.toLowerCase()) {
    case "error":
    case "fatal":
      return "danger";
    case "warn":
    case "warning":
      return "warning";
    case "info":
      return "success";
    case "debug":
    case "trace":
      return "muted";
    default:
      return "info";
  }
};
