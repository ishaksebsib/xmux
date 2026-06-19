import { Schema } from "effect";
import {
  DeliveryMode,
  DiscordModeConfig,
  HarnessModelRefConfig,
  HarnessThinkingLevel,
  OpenCodeMode,
  PiNoToolsMode,
  PositiveInteger,
  ServerSettingsConfig,
  TelegramModeConfig,
} from "../contracts/config";

/** Resolved secrets are internal only; do not expose this shape on control routes. */
export class EnvResolvedSecret extends Schema.Class<EnvResolvedSecret>("EnvResolvedSecret")({
  source: Schema.Literal("env"),
  env: Schema.String.check(Schema.isNonEmpty()),
  value: Schema.String.check(Schema.isNonEmpty()),
}) {}

export class ValueResolvedSecret extends Schema.Class<ValueResolvedSecret>("ValueResolvedSecret")({
  source: Schema.Literal("value"),
  value: Schema.String.check(Schema.isNonEmpty()),
}) {}

export const ResolvedSecret = Schema.Union([EnvResolvedSecret, ValueResolvedSecret]);
export type ResolvedSecret = typeof ResolvedSecret.Type;

export const EffectiveServerSettings = ServerSettingsConfig;
export type EffectiveServerSettings = typeof EffectiveServerSettings.Type;

export class EffectiveTelegramDisabled extends Schema.TaggedClass<EffectiveTelegramDisabled>()(
  "TelegramDisabled",
  {
    enabled: Schema.Literal(false),
    mode: TelegramModeConfig,
    token: Schema.optionalKey(Schema.Undefined),
  },
) {}

export class EffectiveTelegramEnabled extends Schema.TaggedClass<EffectiveTelegramEnabled>()(
  "TelegramEnabled",
  {
    enabled: Schema.Literal(true),
    token: ResolvedSecret,
    mode: TelegramModeConfig,
  },
) {}

export const EffectiveTelegramConfig = Schema.Union([
  EffectiveTelegramDisabled,
  EffectiveTelegramEnabled,
]);
export type EffectiveTelegramConfig = typeof EffectiveTelegramConfig.Type;

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

export class EffectiveChatsConfig extends Schema.Class<EffectiveChatsConfig>(
  "EffectiveChatsConfig",
)({
  telegram: EffectiveTelegramConfig,
  discord: EffectiveDiscordConfig,
}) {}

export class EffectiveOpenCodeDisabled extends Schema.TaggedClass<EffectiveOpenCodeDisabled>()(
  "OpenCodeDisabled",
  {
    enabled: Schema.Literal(false),
    mode: OpenCodeMode,
    baseUrl: Schema.optionalKey(Schema.String),
    port: Schema.optionalKey(PositiveInteger),
    defaultModel: Schema.optionalKey(HarnessModelRefConfig),
    defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  },
) {}

export class EffectiveOpenCodeEmbedded extends Schema.TaggedClass<EffectiveOpenCodeEmbedded>()(
  "OpenCodeEmbedded",
  {
    enabled: Schema.Literal(true),
    mode: Schema.Literal("embedded"),
    port: Schema.optionalKey(PositiveInteger),
    defaultModel: Schema.optionalKey(HarnessModelRefConfig),
    defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  },
) {}

export class EffectiveOpenCodeExternal extends Schema.TaggedClass<EffectiveOpenCodeExternal>()(
  "OpenCodeExternal",
  {
    enabled: Schema.Literal(true),
    mode: Schema.Literal("external"),
    baseUrl: Schema.String.check(Schema.isNonEmpty()),
    defaultModel: Schema.optionalKey(HarnessModelRefConfig),
    defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  },
) {}

export const EffectiveOpenCodeConfig = Schema.Union([
  EffectiveOpenCodeDisabled,
  EffectiveOpenCodeEmbedded,
  EffectiveOpenCodeExternal,
]);
export type EffectiveOpenCodeConfig = typeof EffectiveOpenCodeConfig.Type;

export class EffectivePiDisabled extends Schema.TaggedClass<EffectivePiDisabled>()("PiDisabled", {
  enabled: Schema.Literal(false),
  agentDir: Schema.optionalKey(Schema.String),
  sessionDir: Schema.optionalKey(Schema.String),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
  excludeTools: Schema.optionalKey(Schema.Array(Schema.String)),
  noTools: Schema.optionalKey(PiNoToolsMode),
}) {}

export class EffectivePiEnabled extends Schema.TaggedClass<EffectivePiEnabled>()("PiEnabled", {
  enabled: Schema.Literal(true),
  agentDir: Schema.optionalKey(Schema.String),
  sessionDir: Schema.optionalKey(Schema.String),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
  excludeTools: Schema.optionalKey(Schema.Array(Schema.String)),
  noTools: Schema.optionalKey(PiNoToolsMode),
}) {}

export const EffectivePiConfig = Schema.Union([EffectivePiDisabled, EffectivePiEnabled]);
export type EffectivePiConfig = typeof EffectivePiConfig.Type;

export class EffectiveHarnessesConfig extends Schema.Class<EffectiveHarnessesConfig>(
  "EffectiveHarnessesConfig",
)({
  opencode: EffectiveOpenCodeConfig,
  pi: EffectivePiConfig,
}) {}

/** Fully normalized runtime config with secrets resolved in memory. */
export class EffectiveServerConfig extends Schema.Class<EffectiveServerConfig>(
  "EffectiveServerConfig",
)({
  userName: Schema.String,
  defaultWorkingDirectory: Schema.String,
  deliveryMode: DeliveryMode,
  server: EffectiveServerSettings,
  chats: EffectiveChatsConfig,
  harnesses: EffectiveHarnessesConfig,
  middleware: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
