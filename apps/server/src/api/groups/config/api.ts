import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { ConfigValidateResponse, EffectiveConfigResponse, InvalidConfigResponse } from "./schemas";

/** Configuration inspection and validation endpoints. */
export const configApi = HttpApiGroup.make("config")
  .add(
    HttpApiEndpoint.get("effective", "/v1/config/effective", {
      success: EffectiveConfigResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("validate", "/v1/config/validate", {
      success: ConfigValidateResponse,
      error: InvalidConfigResponse,
    }),
  );
