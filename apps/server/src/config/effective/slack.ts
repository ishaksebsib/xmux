import { Schema } from "effect";
import { ChatAccessConfig, DisabledIntegrationConfig } from "../../contracts/config";
import { ResolvedSecret } from "../resolve-secrets";

export class EnabledEffectiveSlackConfig extends Schema.Class<EnabledEffectiveSlackConfig>(
  "EnabledEffectiveSlackConfig",
)({
  enabled: Schema.Literal(true),
  botToken: ResolvedSecret,
  appToken: ResolvedSecret,
  access: ChatAccessConfig,
}) {}

export const EffectiveSlackConfig = Schema.Union([
  DisabledIntegrationConfig,
  EnabledEffectiveSlackConfig,
]);
export type EffectiveSlackConfig = typeof EffectiveSlackConfig.Type;
