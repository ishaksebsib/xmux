import { Schema } from "effect";
import {
  DisabledIntegrationConfig,
  HarnessModelRefConfig,
  HarnessThinkingLevel,
  OpenCodeRuntimeConfig,
} from "../../contracts/config";

export class EnabledEffectiveOpenCodeConfig extends Schema.Class<EnabledEffectiveOpenCodeConfig>(
  "EnabledEffectiveOpenCodeConfig",
)({
  enabled: Schema.Literal(true),
  runtime: OpenCodeRuntimeConfig,
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export const EffectiveOpenCodeConfig = Schema.Union([
  DisabledIntegrationConfig,
  EnabledEffectiveOpenCodeConfig,
]);
export type EffectiveOpenCodeConfig = typeof EffectiveOpenCodeConfig.Type;
