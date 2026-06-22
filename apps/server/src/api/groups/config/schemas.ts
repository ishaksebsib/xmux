import { Schema } from "effect";
import { ConfigValidationIssue, RedactedServerConfig } from "../../../contracts/config";
import { API_VERSION } from "../../../contracts/constants";
import { ConfigPath } from "../../../contracts/primitives";

/** GET /v1/config/effective response. */
export class EffectiveConfigResponse extends Schema.Class<EffectiveConfigResponse>(
  "EffectiveConfigResponse",
)({
  version: Schema.Literal(API_VERSION),
  configPath: ConfigPath,
  config: RedactedServerConfig,
}) {}

export class ValidConfigValidateResponse extends Schema.Class<ValidConfigValidateResponse>(
  "ValidConfigValidateResponse",
)({
  version: Schema.Literal(API_VERSION),
  configPath: ConfigPath,
  valid: Schema.Literal(true),
  issues: Schema.Tuple([]),
  config: RedactedServerConfig,
}) {}

export class InvalidConfigValidateResponse extends Schema.Class<InvalidConfigValidateResponse>(
  "InvalidConfigValidateResponse",
)({
  version: Schema.Literal(API_VERSION),
  configPath: ConfigPath,
  valid: Schema.Literal(false),
  issues: Schema.NonEmptyArray(ConfigValidationIssue),
}) {}

/** POST /v1/config/validate response. */
export const ConfigValidateResponse = Schema.Union([
  ValidConfigValidateResponse,
  InvalidConfigValidateResponse,
]);
export type ConfigValidateResponse = typeof ConfigValidateResponse.Type;
