import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ShutdownCoordinator } from "../../../server-runtime/shutdown-coordinator";
import { StatusRegistry } from "../../../server-runtime/state";
import { serverApi } from "../../api";
import { ShutdownResponse } from "./schemas";

export const shutdown = Effect.fn("api.lifecycle.shutdown")(function* () {
  const coordinator = yield* ShutdownCoordinator;
  const status = yield* StatusRegistry;

  const result = yield* coordinator.beginShutdown();
  if (result.accepted) {
    yield* status.beginShutdown().pipe(
      Effect.catchTag("StatusTransitionError", () => Effect.void),
    );
    yield* Effect.addFinalizer(() => coordinator.completeShutdown());
  }

  return ShutdownResponse.make({
    accepted: result.accepted,
    alreadyStopping: result.alreadyStopping,
  });
});

export const lifecycleHandlerLayer = HttpApiBuilder.group(serverApi, "lifecycle", (handlers) =>
  handlers.handle("shutdown", () => shutdown()),
);
