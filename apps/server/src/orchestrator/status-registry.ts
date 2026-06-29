import { Context, Effect, Layer, Ref } from "effect";
import type { XmuxRuntimeStatusSnapshot } from "@xmux/orchestrator";
import type { OrchestratorActivation } from "./activation";
import {
  type SafeStatusReason,
  ServerChatAdapterStatus,
  type ServerChatAdapterRuntimeState,
  ServerHarnessAdapterStatus,
  type ServerHarnessAdapterRuntimeState,
  ServerOrchestratorStatusSnapshot,
  type ServerOrchestratorActivationState,
  safeStatusReasonFromUnknown,
  sanitizeStatusReason,
} from "./status-model";

export type RuntimeStatusProvider = () => XmuxRuntimeStatusSnapshot;

const initialSnapshot = ServerOrchestratorStatusSnapshot.make({
  state: "not_started",
  activation: "unknown",
  chats: [],
  harnesses: [],
});

type StoredStatusState =
  | {
      readonly _tag: "Snapshot";
      readonly snapshot: ServerOrchestratorStatusSnapshot;
    }
  | {
      readonly _tag: "Live";
      readonly activation: OrchestratorActivation;
      readonly runtimeStatus: RuntimeStatusProvider;
    };

export const safeOrchestratorStatusReason = safeStatusReasonFromUnknown;

const chatAdapterStatus = (
  id: string,
  state: ServerChatAdapterRuntimeState,
  reason?: SafeStatusReason,
): ServerChatAdapterStatus =>
  ServerChatAdapterStatus.make(reason === undefined ? { id, state } : { id, state, reason });

const harnessAdapterStatus = (
  id: string,
  state: ServerHarnessAdapterRuntimeState,
  reason?: SafeStatusReason,
): ServerHarnessAdapterStatus =>
  ServerHarnessAdapterStatus.make(reason === undefined ? { id, state } : { id, state, reason });

const configuredChats = (ids: ReadonlyArray<string>): readonly ServerChatAdapterStatus[] =>
  ids.map((id) => chatAdapterStatus(id, "configured"));

const configuredHarnesses = (ids: ReadonlyArray<string>): readonly ServerHarnessAdapterStatus[] =>
  ids.map((id) => harnessAdapterStatus(id, "configured_lazy"));

const activationState = (activation: OrchestratorActivation): ServerOrchestratorActivationState => {
  switch (activation._tag) {
    case "Disabled":
      return "disabled";
    case "Enabled":
      return "enabled";
    case "Invalid":
      return "invalid";
  }
};

const snapshotAdapters = (runtime: XmuxRuntimeStatusSnapshot) => ({
  chats: runtime.chats.adapters.map((adapter) =>
    chatAdapterStatus(adapter.id, adapter.state, sanitizeStatusReason(adapter.reason)),
  ),
  harnesses: runtime.harnesses.adapters.map((adapter) =>
    harnessAdapterStatus(adapter.id, adapter.state, sanitizeStatusReason(adapter.reason)),
  ),
});

const configuredFromActivation = (activation: OrchestratorActivation) => ({
  chats: configuredChats(activation.chats),
  harnesses: configuredHarnesses(activation.harnesses),
});

const runningSnapshot = (
  activation: OrchestratorActivation,
  runtime: XmuxRuntimeStatusSnapshot,
): ServerOrchestratorStatusSnapshot => {
  const adapters = snapshotAdapters(runtime);
  return ServerOrchestratorStatusSnapshot.make({
    state: "running",
    activation: activationState(activation),
    chats: adapters.chats,
    harnesses: adapters.harnesses,
  });
};

const currentSnapshot = (state: StoredStatusState): ServerOrchestratorStatusSnapshot => {
  switch (state._tag) {
    case "Snapshot":
      return state.snapshot;
    case "Live":
      return runningSnapshot(state.activation, state.runtimeStatus());
  }
};

export class OrchestratorStatusRegistry extends Context.Service<
  OrchestratorStatusRegistry,
  {
    readonly get: () => Effect.Effect<ServerOrchestratorStatusSnapshot>;
    readonly markDisabled: (activation: OrchestratorActivation) => Effect.Effect<void>;
    readonly markStarting: (activation: OrchestratorActivation) => Effect.Effect<void>;
    readonly markRunning: (
      activation: OrchestratorActivation,
      runtime: XmuxRuntimeStatusSnapshot,
    ) => Effect.Effect<void>;
    readonly attachRuntime: (
      activation: OrchestratorActivation,
      runtimeStatus: RuntimeStatusProvider,
    ) => Effect.Effect<void>;
    readonly markRuntimeFailed: (
      activation: OrchestratorActivation,
      runtime: XmuxRuntimeStatusSnapshot,
      reason: SafeStatusReason,
    ) => Effect.Effect<void>;
    readonly markFailed: (
      activation: OrchestratorActivation | undefined,
      reason: SafeStatusReason,
    ) => Effect.Effect<void>;
    readonly markStopping: () => Effect.Effect<void>;
    readonly markStopped: () => Effect.Effect<void>;
  }
>()("@xmux/server/OrchestratorStatusRegistry") {
  static readonly layer = Layer.effect(
    OrchestratorStatusRegistry,
    Effect.gen(function* () {
      const state = yield* Ref.make<StoredStatusState>({
        _tag: "Snapshot",
        snapshot: initialSnapshot,
      });

      const get = Effect.fn("OrchestratorStatusRegistry.get")(function* () {
        return currentSnapshot(yield* Ref.get(state));
      });

      const setSnapshot = (snapshot: ServerOrchestratorStatusSnapshot): Effect.Effect<void> =>
        Ref.set(state, { _tag: "Snapshot", snapshot });

      const markDisabled = Effect.fn("OrchestratorStatusRegistry.markDisabled")(function* (
        activation: OrchestratorActivation,
      ) {
        const configured = configuredFromActivation(activation);
        yield* setSnapshot(
          ServerOrchestratorStatusSnapshot.make({
            state: "disabled",
            activation: "disabled",
            chats: configured.chats,
            harnesses: configured.harnesses,
          }),
        );
      });

      const markStarting = Effect.fn("OrchestratorStatusRegistry.markStarting")(function* (
        activation: OrchestratorActivation,
      ) {
        const configured = configuredFromActivation(activation);
        yield* setSnapshot(
          ServerOrchestratorStatusSnapshot.make({
            state: "starting",
            activation: activationState(activation),
            chats: configured.chats,
            harnesses: configured.harnesses,
          }),
        );
      });

      const markRunning = Effect.fn("OrchestratorStatusRegistry.markRunning")(function* (
        activation: OrchestratorActivation,
        runtime: XmuxRuntimeStatusSnapshot,
      ) {
        yield* setSnapshot(runningSnapshot(activation, runtime));
      });

      const attachRuntime = Effect.fn("OrchestratorStatusRegistry.attachRuntime")(function* (
        activation: OrchestratorActivation,
        runtimeStatus: RuntimeStatusProvider,
      ) {
        yield* Ref.set(state, { _tag: "Live", activation, runtimeStatus });
      });

      const markRuntimeFailed = Effect.fn("OrchestratorStatusRegistry.markRuntimeFailed")(
        function* (
          activation: OrchestratorActivation,
          runtime: XmuxRuntimeStatusSnapshot,
          reason: SafeStatusReason,
        ) {
          const adapters = snapshotAdapters(runtime);
          yield* setSnapshot(
            ServerOrchestratorStatusSnapshot.make({
              state: "failed",
              activation: activationState(activation),
              chats: adapters.chats,
              harnesses: adapters.harnesses,
              reason,
            }),
          );
        },
      );

      const markFailed = Effect.fn("OrchestratorStatusRegistry.markFailed")(function* (
        activation: OrchestratorActivation | undefined,
        reason: SafeStatusReason,
      ) {
        const configured =
          activation === undefined
            ? { chats: [], harnesses: [] }
            : configuredFromActivation(activation);
        yield* setSnapshot(
          ServerOrchestratorStatusSnapshot.make({
            state: "failed",
            activation: activation === undefined ? "unknown" : activationState(activation),
            chats: configured.chats,
            harnesses: configured.harnesses,
            reason,
          }),
        );
      });

      const markStopping = Effect.fn("OrchestratorStatusRegistry.markStopping")(function* () {
        const current = currentSnapshot(yield* Ref.get(state));
        yield* setSnapshot(
          ServerOrchestratorStatusSnapshot.make({ ...current, state: "stopping" }),
        );
      });

      const markStopped = Effect.fn("OrchestratorStatusRegistry.markStopped")(function* () {
        const current = currentSnapshot(yield* Ref.get(state));
        yield* setSnapshot(ServerOrchestratorStatusSnapshot.make({ ...current, state: "stopped" }));
      });

      return {
        get,
        markDisabled,
        markStarting,
        markRunning,
        attachRuntime,
        markRuntimeFailed,
        markFailed,
        markStopping,
        markStopped,
      };
    }),
  );
}
