import { Context, Effect, Layer, Ref } from "effect";
import type { ServerStatusState } from "./status-state";

/** StatusRegistry keeps coarse runtime state behind one mutable Effect service. */
export class StatusRegistry extends Context.Service<
  StatusRegistry,
  {
    readonly getState: Effect.Effect<ServerStatusState>;
    readonly setState: (state: ServerStatusState) => Effect.Effect<void>;
  }
>()("@xmux/server/StatusRegistry") {}

/** Live status starts as `starting`; the shell marks readiness after publish. */
export const StatusRegistryLive = Layer.effect(StatusRegistry)(
  Effect.gen(function* () {
    const state = yield* Ref.make<ServerStatusState>("starting");

    return {
      getState: Ref.get(state),
      setState: (nextState: ServerStatusState) => Ref.set(state, nextState),
    };
  }),
);
