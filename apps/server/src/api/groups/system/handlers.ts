import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { StatusRegistry } from "../../../services/status-registry";
import { serverApi } from "../../api";
import { HealthResponse } from "./schemas";

const isReady = (state: string): boolean => state === "ready";

export const health = Effect.fn("api.system.health")(function* () {
  const status = yield* StatusRegistry;
  const state = yield* status.getState;

  return HealthResponse.make({
    alive: true,
    ready: isReady(state),
    state,
  });
});

export const systemHandlers = HttpApiBuilder.group(serverApi, "system", (handlers) =>
  handlers.handle("health", () => health()),
);
