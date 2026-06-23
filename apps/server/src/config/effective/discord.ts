import { Schema } from "effect";
import { ChatAccessConfig } from "../../contracts/config";
import { DiscordApplicationId, DiscordGuildId } from "../../contracts/primitives";
import { ResolvedSecret } from "../resolve-secrets";

export class EffectiveDiscordConfig extends Schema.Class<EffectiveDiscordConfig>(
  "EffectiveDiscordConfig",
)({
  token: ResolvedSecret,
  applicationId: DiscordApplicationId,
  guildId: DiscordGuildId,
  access: ChatAccessConfig,
}) {}
