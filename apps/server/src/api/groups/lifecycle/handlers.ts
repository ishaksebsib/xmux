import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ShutdownCoordinator } from "../../../runtime/shutdown-coordinator";
import { StatusRegistry } from "../../../runtime/status-registry";
import { serverApi } from "../../api";
import { ShutdownResponse } from "./schemas";

export const shutdown = Effect.fn("api.lifecycle.shutdown")(function* () {
  const coordinator = yield* ShutdownCoordinator;
  const status = yield* StatusRegistry;

  const result = yield* coordinator.beginShutdown;
  if (result.accepted) {
    yield* status.setState("stopping");
    yield* Effect.addFinalizer(() => coordinator.completeShutdown);
  }

  return ShutdownResponse.make({
    accepted: result.accepted,
    alreadyStopping: result.alreadyStopping,
  });
});

export const lifecycleHandlers = HttpApiBuilder.group(serverApi, "lifecycle", (handlers) =>
  handlers.handle("shutdown", () => shutdown()),
);
