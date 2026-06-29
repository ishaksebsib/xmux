import { Context, Effect, Layer, Ref, Schema } from "effect";

/** Runtime states are intentionally coarse so client status handling stays stable. */
export const ServerStatusState = Schema.Literals([
  "starting",
  "ready",
  "degraded",
  "reloading",
  "stopping",
  "failed",
]);
export type ServerStatusState = typeof ServerStatusState.Type;

export class StatusTransitionError extends Schema.TaggedErrorClass<StatusTransitionError>()(
  "StatusTransitionError",
  {
    from: ServerStatusState,
    to: ServerStatusState,
    message: Schema.String,
  },
) {}

const canTransition = (from: ServerStatusState, to: ServerStatusState): boolean => {
  switch (from) {
    case "starting":
      return to === "ready" || to === "degraded" || to === "failed" || to === "stopping";
    case "ready":
      return to === "degraded" || to === "reloading" || to === "stopping" || to === "failed";
    case "degraded":
      return to === "ready" || to === "reloading" || to === "stopping" || to === "failed";
    case "reloading":
      return to === "ready" || to === "degraded" || to === "stopping" || to === "failed";
    case "stopping":
      return to === "failed";
    case "failed":
      return false;
  }
};

/** StatusRegistry keeps coarse runtime state behind one mutable Effect service. */
export class StatusRegistry extends Context.Service<
  StatusRegistry,
  {
    readonly getState: () => Effect.Effect<ServerStatusState>;
    readonly markReady: () => Effect.Effect<void, StatusTransitionError>;
    readonly markDegraded: () => Effect.Effect<void, StatusTransitionError>;
    readonly beginReload: () => Effect.Effect<void, StatusTransitionError>;
    readonly finishReload: () => Effect.Effect<void, StatusTransitionError>;
    readonly beginShutdown: () => Effect.Effect<void, StatusTransitionError>;
    readonly markFailed: () => Effect.Effect<void>;
  }
>()("@xmux/server/StatusRegistry") {
  /** Status layer starts as `starting`; the shell marks readiness after publish. */
  static readonly layer = Layer.effect(
    StatusRegistry,
    Effect.gen(function* () {
      const state = yield* Ref.make<ServerStatusState>("starting");

      const getState = Effect.fn("StatusRegistry.getState")(function* () {
        return yield* Ref.get(state);
      });

      const transitionTo = Effect.fn("StatusRegistry.transitionTo")(function* (
        nextState: ServerStatusState,
      ) {
        const previous = yield* Ref.get(state);
        if (!canTransition(previous, nextState)) {
          return yield* StatusTransitionError.make({
            from: previous,
            to: nextState,
            message: `Invalid server status transition: ${previous} -> ${nextState}`,
          });
        }
        yield* Ref.set(state, nextState);
      });

      const markReady = Effect.fn("StatusRegistry.markReady")(function* () {
        yield* transitionTo("ready");
      });
      const markDegraded = Effect.fn("StatusRegistry.markDegraded")(function* () {
        yield* transitionTo("degraded");
      });
      const beginReload = Effect.fn("StatusRegistry.beginReload")(function* () {
        yield* transitionTo("reloading");
      });
      const finishReload = Effect.fn("StatusRegistry.finishReload")(function* () {
        const previous = yield* Ref.get(state);
        yield* transitionTo(previous === "degraded" ? "degraded" : "ready");
      });
      const beginShutdown = Effect.fn("StatusRegistry.beginShutdown")(function* () {
        yield* transitionTo("stopping");
      });
      const markFailed = Effect.fn("StatusRegistry.markFailed")(function* () {
        yield* Ref.set(state, "failed");
      });

      return {
        getState,
        markReady,
        markDegraded,
        beginReload,
        finishReload,
        beginShutdown,
        markFailed,
      };
    }),
  );
}
