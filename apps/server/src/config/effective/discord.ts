import { Schema } from "effect";
import { ChatAccessConfig, DisabledIntegrationConfig } from "../../contracts/config";
import { DiscordApplicationId, DiscordGuildId } from "../../contracts/primitives";
import { ResolvedSecret } from "../resolve-secrets";

export class EnabledEffectiveDiscordConfig extends Schema.Class<EnabledEffectiveDiscordConfig>(
  "EnabledEffectiveDiscordConfig",
)({
  enabled: Schema.Literal(true),
  token: ResolvedSecret,
  applicationId: DiscordApplicationId,
  guildId: DiscordGuildId,
  access: ChatAccessConfig,
}) {}

export const EffectiveDiscordConfig = Schema.Union([
  DisabledIntegrationConfig,
  EnabledEffectiveDiscordConfig,
]);
export type EffectiveDiscordConfig = typeof EffectiveDiscordConfig.Type;
