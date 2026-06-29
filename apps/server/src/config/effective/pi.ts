import { Schema } from "effect";
import {
  DisabledIntegrationConfig,
  HarnessModelRefConfig,
  HarnessThinkingLevel,
} from "../../contracts/config";
import { ResolvedPath } from "../../contracts/primitives";

export class EnabledEffectivePiConfig extends Schema.Class<EnabledEffectivePiConfig>(
  "EnabledEffectivePiConfig",
)({
  enabled: Schema.Literal(true),
  agentDir: Schema.optionalKey(ResolvedPath),
  sessionDir: Schema.optionalKey(ResolvedPath),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export const EffectivePiConfig = Schema.Union([
  DisabledIntegrationConfig,
  EnabledEffectivePiConfig,
]);
export type EffectivePiConfig = typeof EffectivePiConfig.Type;
