import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { StatusRegistry } from "../../../server-runtime/state";
import { serverApi } from "../../api";
import { HealthResponse } from "./schemas";

const isReady = (state: string): boolean => state === "ready" || state === "degraded";

export const health = Effect.fn("api.system.health")(function* () {
  const status = yield* StatusRegistry;
  const state = yield* status.getState();

  return HealthResponse.make({
    alive: true,
    ready: isReady(state),
    state,
  });
});

export const systemHandlerLayer = HttpApiBuilder.group(serverApi, "system", (handlers) =>
  handlers.handle("health", () => health()),
);
