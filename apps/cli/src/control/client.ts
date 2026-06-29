import { Context, Effect } from "effect";
import type { CliRunningServer } from "../domain/discovery";
import { CliControlRequestError, CliServerUnreachable } from "../domain/errors";
import type { CliTailCount } from "../domain/input";

export type CliJsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<CliJsonValue>
  | { readonly [key: string]: CliJsonValue | undefined };

export type CliServerState =
  | "starting"
  | "ready"
  | "degraded"
  | "reloading"
  | "stopping"
  | "failed";

export type CliOrchestratorState =
  | "not_started"
  | "disabled"
  | "starting"
  | "running"
  | "degraded"
  | "failed"
  | "stopping"
  | "stopped";

export type CliOrchestratorActivation = "disabled" | "enabled" | "invalid" | "unknown";

export type CliChatAdapterRuntimeState =
  | "configured"
  | "opening"
  | "starting"
  | "active"
  | "failed"
  | "closing"
  | "stopped";

export type CliHarnessAdapterRuntimeState =
  | "configured_lazy"
  | "opening"
  | "opened"
  | "failed"
  | "closing"
  | "closed";

export interface CliChatAdapterStatus {
  readonly id: string;
  readonly state: CliChatAdapterRuntimeState;
  readonly reason?: string;
}

export interface CliHarnessAdapterStatus {
  readonly id: string;
  readonly state: CliHarnessAdapterRuntimeState;
  readonly reason?: string;
}

export interface CliOrchestratorStatus {
  readonly state: CliOrchestratorState;
  readonly activation: CliOrchestratorActivation;
  readonly chats: readonly CliChatAdapterStatus[];
  readonly harnesses: readonly CliHarnessAdapterStatus[];
  readonly reason?: string;
}

export interface CliHealthResponse {
  readonly alive: boolean;
  readonly ready: boolean;
  readonly state: CliServerState;
}

export interface CliStatusResponse {
  readonly version: number;
  readonly protocolVersion: number;
  readonly pid: number;
  readonly startedAt: string;
  readonly uptimeMs: number;
  readonly state: CliServerState;
  readonly configPath: string;
  readonly stateDir: string;
  readonly scopeId: string;
  readonly endpoint: {
    readonly kind: "unix-socket";
    readonly path: string;
  };
  readonly orchestrator?: CliOrchestratorStatus;
}

export type CliLogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface CliLogEntry {
  readonly timestamp: string;
  readonly level: CliLogLevel;
  readonly message: CliJsonValue;
  readonly annotations?: Readonly<Record<string, CliJsonValue>>;
  readonly spans?: Readonly<Record<string, number>>;
  readonly cause?: string;
}

export interface CliLogsResponse {
  readonly version: number;
  readonly entries: ReadonlyArray<CliLogEntry>;
}

export interface CliShutdownResponse {
  readonly accepted: boolean;
  readonly alreadyStopping: boolean;
}

export interface ControlClientService {
  readonly health: (
    server: CliRunningServer,
  ) => Effect.Effect<CliHealthResponse, CliServerUnreachable | CliControlRequestError>;
  readonly status: (
    server: CliRunningServer,
  ) => Effect.Effect<CliStatusResponse, CliServerUnreachable | CliControlRequestError>;
  readonly logs: (
    server: CliRunningServer,
    tail: CliTailCount | undefined,
  ) => Effect.Effect<CliLogsResponse, CliServerUnreachable | CliControlRequestError>;
  readonly shutdown: (
    server: CliRunningServer,
  ) => Effect.Effect<CliShutdownResponse, CliServerUnreachable | CliControlRequestError>;
}

export class ControlClient extends Context.Service<ControlClient, ControlClientService>()(
  "@xmux/cli/ControlClient",
) {}
