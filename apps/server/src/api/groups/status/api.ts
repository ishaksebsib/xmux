import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { StatusResponse } from "./schemas";

/** Server status endpoints for local CLI discovery. */
export const statusApi = HttpApiGroup.make("status").add(
  HttpApiEndpoint.get("status", "/v1/status", {
    success: StatusResponse,
  }),
);
