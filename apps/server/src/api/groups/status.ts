import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { StatusResponse } from "../../contracts/control";

/** Server status endpoints for local CLI discovery. */
export const StatusApi = HttpApiGroup.make("status").add(
  HttpApiEndpoint.get("status", "/v1/status", {
    success: StatusResponse,
  }),
);
