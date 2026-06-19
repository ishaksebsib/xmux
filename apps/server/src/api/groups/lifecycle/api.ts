import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { ShutdownAccepted } from "./schemas";

/** Local lifecycle control endpoints. */
export const lifecycleApi = HttpApiGroup.make("lifecycle").add(
  HttpApiEndpoint.post("shutdown", "/v1/shutdown", {
    success: ShutdownAccepted,
  }),
);
