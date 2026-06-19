import { Schema } from "effect";
import { ConfigValidationIssue, RedactedServerConfig } from "../../../contracts/config";
import { API_VERSION } from "../../../contracts/constants";

/** GET /v1/config/effective response. */
export class EffectiveConfigResponse extends Schema.Class<EffectiveConfigResponse>(
  "EffectiveConfigResponse",
)({
  version: Schema.Literal(API_VERSION),
  configPath: Schema.String,
  config: RedactedServerConfig,
}) {}

/** POST /v1/config/validate response. */
export class ConfigValidateResponse extends Schema.Class<ConfigValidateResponse>(
  "ConfigValidateResponse",
)({
  version: Schema.Literal(API_VERSION),
  configPath: Schema.String,
  valid: Schema.Boolean,
  issues: Schema.Array(ConfigValidationIssue),
  config: Schema.optionalKey(RedactedServerConfig),
}) {}

export const InvalidConfigResponse = ConfigValidateResponse.annotate({ httpApiStatus: 422 });
