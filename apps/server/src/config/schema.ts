import { Schema } from "effect";
import {
  DeliveryMode,
  DiscordModeConfig,
  HarnessModelRefConfig,
  HarnessThinkingLevel,
  ServerLogLevel,
  TelegramModeConfig,
} from "../contracts/config";

const NonEmptyString = Schema.String.check(Schema.isNonEmpty());
const PositiveInteger = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0));

/** Resolved secrets are internal only; do not expose this shape on control routes. */
export class ResolvedSecret extends Schema.Class<ResolvedSecret>("ResolvedSecret")({
  source: Schema.Literals(["env", "value"]),
  env: Schema.optionalKey(Schema.String),
  value: NonEmptyString,
}) {}

export class EffectiveServerSettings extends Schema.Class<EffectiveServerSettings>(
  "EffectiveServerSettings",
)({
  logLevel: ServerLogLevel,
}) {}

export class EffectiveTelegramConfig extends Schema.Class<EffectiveTelegramConfig>(
  "EffectiveTelegramConfig",
)({
  enabled: Schema.Boolean,
  token: Schema.optionalKey(ResolvedSecret),
  mode: TelegramModeConfig,
}) {}

export class EffectiveDiscordConfig extends Schema.Class<EffectiveDiscordConfig>(
  "EffectiveDiscordConfig",
)({
  enabled: Schema.Boolean,
  token: Schema.optionalKey(ResolvedSecret),
  applicationId: Schema.optionalKey(Schema.String),
  guildId: Schema.optionalKey(Schema.String),
  publicKey: Schema.optionalKey(Schema.String),
  mode: DiscordModeConfig,
}) {}

export class EffectiveChatsConfig extends Schema.Class<EffectiveChatsConfig>(
  "EffectiveChatsConfig",
)({
  telegram: EffectiveTelegramConfig,
  discord: EffectiveDiscordConfig,
}) {}

export class EffectiveOpenCodeConfig extends Schema.Class<EffectiveOpenCodeConfig>(
  "EffectiveOpenCodeConfig",
)({
  enabled: Schema.Boolean,
  mode: Schema.Literals(["embedded", "external"]),
  baseUrl: Schema.optionalKey(Schema.String),
  port: Schema.optionalKey(PositiveInteger),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export class EffectivePiConfig extends Schema.Class<EffectivePiConfig>("EffectivePiConfig")({
  enabled: Schema.Boolean,
  agentDir: Schema.optionalKey(Schema.String),
  sessionDir: Schema.optionalKey(Schema.String),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
  excludeTools: Schema.optionalKey(Schema.Array(Schema.String)),
  noTools: Schema.optionalKey(Schema.Literals(["all", "builtin"])),
}) {}

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
