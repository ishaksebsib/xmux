import { Schema } from "effect";
import { DiscordModeConfig } from "../../contracts/config";
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
    applicationId: Schema.optionalKey(Schema.String),
    guildId: Schema.optionalKey(Schema.String),
    publicKey: Schema.optionalKey(Schema.String),
  },
) {}

export class EffectiveDiscordGatewayEnabled extends Schema.TaggedClass<EffectiveDiscordGatewayEnabled>()(
  "DiscordGatewayEnabled",
  {
    enabled: Schema.Literal(true),
    token: ResolvedSecret,
    applicationId: Schema.String.check(Schema.isNonEmpty()),
    mode: EffectiveDiscordGatewayMode,
    guildId: Schema.optionalKey(Schema.String),
    publicKey: Schema.optionalKey(Schema.String),
  },
) {}

export class EffectiveDiscordWebhookEnabled extends Schema.TaggedClass<EffectiveDiscordWebhookEnabled>()(
  "DiscordWebhookEnabled",
  {
    enabled: Schema.Literal(true),
    token: ResolvedSecret,
    applicationId: Schema.String.check(Schema.isNonEmpty()),
    publicKey: Schema.String.check(Schema.isNonEmpty()),
    mode: EffectiveDiscordWebhookMode,
    guildId: Schema.optionalKey(Schema.String),
  },
) {}

export const EffectiveDiscordConfig = Schema.Union([
  EffectiveDiscordDisabled,
  EffectiveDiscordGatewayEnabled,
  EffectiveDiscordWebhookEnabled,
]);
export type EffectiveDiscordConfig = typeof EffectiveDiscordConfig.Type;
