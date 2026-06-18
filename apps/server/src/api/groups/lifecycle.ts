import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { ShutdownResponse } from "../../contracts/control";

/** Local lifecycle control endpoints. */
export const LifecycleApi = HttpApiGroup.make("lifecycle").add(
  HttpApiEndpoint.post("shutdown", "/v1/shutdown", {
    success: ShutdownResponse,
  }),
);
