import { Schema } from "effect";
import { ChatAccessConfig, DisabledIntegrationConfig } from "../../contracts/config";
import { ResolvedSecret } from "../resolve-secrets";

export class EnabledEffectiveTelegramConfig extends Schema.Class<EnabledEffectiveTelegramConfig>(
  "EnabledEffectiveTelegramConfig",
)({
  enabled: Schema.Literal(true),
  token: ResolvedSecret,
  access: ChatAccessConfig,
}) {}

export const EffectiveTelegramConfig = Schema.Union([
  DisabledIntegrationConfig,
  EnabledEffectiveTelegramConfig,
]);
export type EffectiveTelegramConfig = typeof EffectiveTelegramConfig.Type;
