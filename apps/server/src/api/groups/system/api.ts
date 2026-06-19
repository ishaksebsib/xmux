import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { HealthResponse } from "./schemas";

/** Process health and readiness endpoints. */
export const systemApi = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("health", "/healthz", {
    success: HealthResponse,
  }),
);
