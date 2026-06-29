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

const initialSnapshot = ServerOrchestratorStatusSnapshot.make({
  state: "not_started",
  activation: "unknown",
  chats: [],
  harnesses: [],
});

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
    readonly markDegraded: (
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
      const state = yield* Ref.make<ServerOrchestratorStatusSnapshot>(initialSnapshot);

      const get = Effect.fn("OrchestratorStatusRegistry.get")(function* () {
        return yield* Ref.get(state);
      });

      const markDisabled = Effect.fn("OrchestratorStatusRegistry.markDisabled")(function* (
        activation: OrchestratorActivation,
      ) {
        const configured = configuredFromActivation(activation);
        yield* Ref.set(
          state,
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
        yield* Ref.set(
          state,
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
        const adapters = snapshotAdapters(runtime);
        yield* Ref.set(
          state,
          ServerOrchestratorStatusSnapshot.make({
            state: "running",
            activation: activationState(activation),
            chats: adapters.chats,
            harnesses: adapters.harnesses,
          }),
        );
      });

      const markDegraded = Effect.fn("OrchestratorStatusRegistry.markDegraded")(function* (
        activation: OrchestratorActivation,
        runtime: XmuxRuntimeStatusSnapshot,
        reason: SafeStatusReason,
      ) {
        const adapters = snapshotAdapters(runtime);
        yield* Ref.set(
          state,
          ServerOrchestratorStatusSnapshot.make({
            state: "degraded",
            activation: activationState(activation),
            chats: adapters.chats,
            harnesses: adapters.harnesses,
            reason,
          }),
        );
      });

      const markFailed = Effect.fn("OrchestratorStatusRegistry.markFailed")(function* (
        activation: OrchestratorActivation | undefined,
        reason: SafeStatusReason,
      ) {
        const configured =
          activation === undefined
            ? { chats: [], harnesses: [] }
            : configuredFromActivation(activation);
        yield* Ref.set(
          state,
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
        const current = yield* Ref.get(state);
        yield* Ref.set(
          state,
          ServerOrchestratorStatusSnapshot.make({ ...current, state: "stopping" }),
        );
      });

      const markStopped = Effect.fn("OrchestratorStatusRegistry.markStopped")(function* () {
        const current = yield* Ref.get(state);
        yield* Ref.set(
          state,
          ServerOrchestratorStatusSnapshot.make({ ...current, state: "stopped" }),
        );
      });

      return {
        get,
        markDisabled,
        markStarting,
        markRunning,
        markDegraded,
        markFailed,
        markStopping,
        markStopped,
      };
    }),
  );
}
