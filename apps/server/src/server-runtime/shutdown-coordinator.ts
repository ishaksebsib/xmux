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
    readonly beginShutdown: () => Effect.Effect<ShutdownRequestResult>;
    readonly completeShutdown: () => Effect.Effect<void>;
    readonly awaitShutdown: () => Effect.Effect<void>;
    readonly isShutdownRequested: () => Effect.Effect<boolean>;
  }
>()("@xmux/server/ShutdownCoordinator") {
  /** Coordinator layer is one deferred signal plus a ref for idempotent requests. */
  static readonly layer = Layer.effect(
    ShutdownCoordinator,
    Effect.gen(function* () {
      const requested = yield* Ref.make(false);
      const signal = yield* Deferred.make<void>();

      const beginShutdown = Effect.fn("ShutdownCoordinator.beginShutdown")(function* () {
        return yield* Ref.modify(requested, (wasRequested): [ShutdownRequestResult, boolean] => {
          if (wasRequested) {
            return [{ accepted: false, alreadyStopping: true }, true];
          }
          return [{ accepted: true, alreadyStopping: false }, true];
        });
      });

      const completeShutdown = Effect.fn("ShutdownCoordinator.completeShutdown")(function* () {
        yield* Deferred.succeed(signal, undefined);
      });

      const awaitShutdown = Effect.fn("ShutdownCoordinator.awaitShutdown")(function* () {
        yield* Deferred.await(signal);
      });

      const isShutdownRequested = Effect.fn("ShutdownCoordinator.isShutdownRequested")(
        function* () {
          return yield* Ref.get(requested);
        },
      );

      return { beginShutdown, completeShutdown, awaitShutdown, isShutdownRequested };
    }),
  );
}
