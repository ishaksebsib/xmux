import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { ApiError } from "../../shared/errors";
import { ConfigValidateResponse, EffectiveConfigResponse } from "./schemas";

/** Configuration inspection and validation endpoints. */
export const configApi = HttpApiGroup.make("config")
  .add(
    HttpApiEndpoint.get("effective", "/v1/config/effective", {
      success: EffectiveConfigResponse,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("validate", "/v1/config/validate", {
      success: ConfigValidateResponse,
    }),
  );
