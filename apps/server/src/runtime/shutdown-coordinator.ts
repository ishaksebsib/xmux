import { Context, Deferred, Effect, Layer, Ref } from "effect";

/** Shutdown results make repeated control requests safe and observable. */
export interface ShutdownRequestResult {
  readonly accepted: boolean;
  readonly alreadyStopping: boolean;
}

/** Coordinator separates HTTP acknowledgement from actual server scope shutdown. */
export class ShutdownCoordinator extends Context.Service<
  ShutdownCoordinator,
  {
    readonly beginShutdown: Effect.Effect<ShutdownRequestResult>;
    readonly completeShutdown: Effect.Effect<void>;
    readonly awaitShutdown: Effect.Effect<void>;
    readonly isShutdownRequested: Effect.Effect<boolean>;
  }
>()("@xmux/server/ShutdownCoordinator") {}

/** Live coordinator is one deferred signal plus a ref for idempotent requests. */
export const ShutdownCoordinatorLive = Layer.effect(ShutdownCoordinator)(
  Effect.gen(function* () {
    const requested = yield* Ref.make(false);
    const signal = yield* Deferred.make<void>();

    return {
      beginShutdown: Ref.modify(requested, (wasRequested): [ShutdownRequestResult, boolean] => {
        if (wasRequested) {
          return [{ accepted: false, alreadyStopping: true }, true];
        }
        return [{ accepted: true, alreadyStopping: false }, true];
      }),
      completeShutdown: Deferred.succeed(signal, undefined).pipe(Effect.asVoid),
      awaitShutdown: Deferred.await(signal),
      isShutdownRequested: Ref.get(requested),
    };
  }),
);
