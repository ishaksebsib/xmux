import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { HealthResponse } from "../../contracts/control";

/** Process health and readiness endpoints. */
export const SystemApi = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("health", "/healthz", {
    success: HealthResponse,
  }),
);
