import { Schema } from "effect";
import { DisabledIntegrationConfig, SttProvider } from "../../contracts/config";
import { BaseUrl, NonEmptyString, PositiveInteger } from "../../contracts/primitives";
import { ResolvedSecret } from "../resolve-secrets";

export class EnabledEffectiveSttConfig extends Schema.Class<EnabledEffectiveSttConfig>(
  "EnabledEffectiveSttConfig",
)({
  enabled: Schema.Literal(true),
  provider: SttProvider,
  apiKey: Schema.optionalKey(ResolvedSecret),
  baseUrl: Schema.optionalKey(BaseUrl),
  endpointPath: Schema.optionalKey(NonEmptyString),
  model: NonEmptyString,
  language: Schema.optionalKey(NonEmptyString),
  maxBytes: PositiveInteger,
  timeoutMs: Schema.optionalKey(PositiveInteger),
}) {}

export const EffectiveSttConfig = Schema.Union([
  DisabledIntegrationConfig,
  EnabledEffectiveSttConfig,
]);
export type EffectiveSttConfig = typeof EffectiveSttConfig.Type;
