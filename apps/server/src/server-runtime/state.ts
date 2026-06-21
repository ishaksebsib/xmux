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

/** StatusRegistry keeps coarse runtime state behind one mutable Effect service. */
export class StatusRegistry extends Context.Service<
  StatusRegistry,
  {
    readonly getState: () => Effect.Effect<ServerStatusState>;
    readonly setState: (state: ServerStatusState) => Effect.Effect<void>;
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
      const setState = Effect.fn("StatusRegistry.setState")(function* (
        nextState: ServerStatusState,
      ) {
        yield* Ref.set(state, nextState);
      });

      return { getState, setState };
    }),
  );
}
