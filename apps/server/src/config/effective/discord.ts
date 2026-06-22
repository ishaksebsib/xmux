import { Schema } from "effect";
import { DiscordModeConfig } from "../../contracts/config";
import { DiscordApplicationId, DiscordGuildId, DiscordPublicKey } from "../../contracts/primitives";
import { ResolvedSecret } from "../resolve-secrets";

export class EffectiveDiscordGatewayMode extends Schema.Class<EffectiveDiscordGatewayMode>(
  "EffectiveDiscordGatewayMode",
)({
  type: Schema.Literal("gateway"),
}) {}

export class EffectiveDiscordWebhookMode extends Schema.Class<EffectiveDiscordWebhookMode>(
  "EffectiveDiscordWebhookMode",
)({
  type: Schema.Literal("webhook"),
}) {}

export class EffectiveDiscordDisabled extends Schema.TaggedClass<EffectiveDiscordDisabled>()(
  "DiscordDisabled",
  {
    enabled: Schema.Literal(false),
    mode: DiscordModeConfig,
    token: Schema.optionalKey(Schema.Undefined),
    applicationId: Schema.optionalKey(DiscordApplicationId),
    guildId: Schema.optionalKey(DiscordGuildId),
    publicKey: Schema.optionalKey(DiscordPublicKey),
  },
) {}

export class EffectiveDiscordGatewayEnabled extends Schema.TaggedClass<EffectiveDiscordGatewayEnabled>()(
  "DiscordGatewayEnabled",
  {
    enabled: Schema.Literal(true),
    token: ResolvedSecret,
    applicationId: DiscordApplicationId,
    mode: EffectiveDiscordGatewayMode,
    guildId: Schema.optionalKey(DiscordGuildId),
    publicKey: Schema.optionalKey(DiscordPublicKey),
  },
) {}

export class EffectiveDiscordWebhookEnabled extends Schema.TaggedClass<EffectiveDiscordWebhookEnabled>()(
  "DiscordWebhookEnabled",
  {
    enabled: Schema.Literal(true),
    token: ResolvedSecret,
    applicationId: DiscordApplicationId,
    publicKey: DiscordPublicKey,
    mode: EffectiveDiscordWebhookMode,
    guildId: Schema.optionalKey(DiscordGuildId),
  },
) {}

export const EffectiveDiscordConfig = Schema.Union([
  EffectiveDiscordDisabled,
  EffectiveDiscordGatewayEnabled,
  EffectiveDiscordWebhookEnabled,
]);
export type EffectiveDiscordConfig = typeof EffectiveDiscordConfig.Type;
