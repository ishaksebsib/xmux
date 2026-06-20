import { Schema } from "effect";
import { LogLevel } from "./logging";
import { NonEmptyString, PositiveInteger } from "./primitives";

/** Secret references let config point at credentials without exposing them in status. */
export class EnvSecretRef extends Schema.Class<EnvSecretRef>("EnvSecretRef")({
  env: NonEmptyString,
}) {}

/** Inline secrets are supported for convenience but always redacted at boundaries. */
export class InlineSecretRef extends Schema.Class<InlineSecretRef>("InlineSecretRef")({
  value: NonEmptyString,
}) {}

export const SecretRef = Schema.Union([EnvSecretRef, InlineSecretRef]);
export type SecretRef = typeof SecretRef.Type;

export const DeliveryMode = Schema.Literals(["requester_only", "fanout"]);
export type DeliveryMode = typeof DeliveryMode.Type;

export const HarnessThinkingLevel = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type HarnessThinkingLevel = typeof HarnessThinkingLevel.Type;

export const OpenCodeMode = Schema.Literals(["embedded", "external"]);
export type OpenCodeMode = typeof OpenCodeMode.Type;

export const PiNoToolsMode = Schema.Literals(["all", "builtin"]);
export type PiNoToolsMode = typeof PiNoToolsMode.Type;

/** User-facing server config knobs. */
export class ServerFileServerConfig extends Schema.Class<ServerFileServerConfig>(
  "ServerFileServerConfig",
)({
  logLevel: Schema.optionalKey(LogLevel),
}) {}

/** Normalized server settings used after defaults have been applied. */
export class ServerSettingsConfig extends Schema.Class<ServerSettingsConfig>(
  "ServerSettingsConfig",
)({
  logLevel: LogLevel,
}) {}

export class TelegramModeConfig extends Schema.Class<TelegramModeConfig>("TelegramModeConfig")({
  type: Schema.Literals(["polling", "webhook"]),
}) {}

/** Telegram config is validated before adapter construction exists. */
export class TelegramFileConfig extends Schema.Class<TelegramFileConfig>("TelegramFileConfig")({
  enabled: Schema.optionalKey(Schema.Boolean),
  token: Schema.optionalKey(SecretRef),
  mode: Schema.optionalKey(TelegramModeConfig),
}) {}

export class DiscordModeConfig extends Schema.Class<DiscordModeConfig>("DiscordModeConfig")({
  type: Schema.Literals(["gateway", "webhook"]),
}) {}

/** Discord config keeps gateway/webhook selection separate from future adapters. */
export class DiscordFileConfig extends Schema.Class<DiscordFileConfig>("DiscordFileConfig")({
  enabled: Schema.optionalKey(Schema.Boolean),
  token: Schema.optionalKey(SecretRef),
  applicationId: Schema.optionalKey(NonEmptyString),
  guildId: Schema.optionalKey(NonEmptyString),
  publicKey: Schema.optionalKey(NonEmptyString),
  mode: Schema.optionalKey(DiscordModeConfig),
}) {}

export class ChatsFileConfig extends Schema.Class<ChatsFileConfig>("ChatsFileConfig")({
  telegram: Schema.optionalKey(TelegramFileConfig),
  discord: Schema.optionalKey(DiscordFileConfig),
}) {}

export class HarnessModelRefConfig extends Schema.Class<HarnessModelRefConfig>(
  "HarnessModelRefConfig",
)({
  providerId: Schema.optionalKey(NonEmptyString),
  modelId: NonEmptyString,
  variant: Schema.optionalKey(NonEmptyString),
}) {}

export class OpenCodeFileConfig extends Schema.Class<OpenCodeFileConfig>("OpenCodeFileConfig")({
  enabled: Schema.optionalKey(Schema.Boolean),
  mode: Schema.optionalKey(OpenCodeMode),
  baseUrl: Schema.optionalKey(NonEmptyString),
  port: Schema.optionalKey(PositiveInteger),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export class PiFileConfig extends Schema.Class<PiFileConfig>("PiFileConfig")({
  enabled: Schema.optionalKey(Schema.Boolean),
  agentDir: Schema.optionalKey(NonEmptyString),
  sessionDir: Schema.optionalKey(NonEmptyString),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(NonEmptyString)),
  excludeTools: Schema.optionalKey(Schema.Array(NonEmptyString)),
  noTools: Schema.optionalKey(PiNoToolsMode),
}) {}

export class HarnessesFileConfig extends Schema.Class<HarnessesFileConfig>("HarnessesFileConfig")({
  opencode: Schema.optionalKey(OpenCodeFileConfig),
  pi: Schema.optionalKey(PiFileConfig),
}) {}

/** Raw JSONC config contract. Missing keys are defaulted after decoding. */
export class ServerFileConfig extends Schema.Class<ServerFileConfig>("ServerFileConfig")({
  userName: Schema.optionalKey(NonEmptyString),
  defaultWorkingDirectory: Schema.optionalKey(NonEmptyString),
  deliveryMode: Schema.optionalKey(DeliveryMode),
  server: Schema.optionalKey(ServerFileServerConfig),
  chats: Schema.optionalKey(ChatsFileConfig),
  harnesses: Schema.optionalKey(HarnessesFileConfig),
  // TODO: harden this type, and think about the design more
  middleware: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/** Redacted secret metadata is safe for local status and support output. */
export class RedactedSecretRef extends Schema.Class<RedactedSecretRef>("RedactedSecretRef")({
  source: Schema.Literals(["env", "value"]),
  env: Schema.optionalKey(Schema.String),
  redacted: Schema.Literal(true),
}) {}

export class RedactedTelegramConfig extends Schema.Class<RedactedTelegramConfig>(
  "RedactedTelegramConfig",
)({
  enabled: Schema.Boolean,
  token: Schema.optionalKey(RedactedSecretRef),
  mode: TelegramModeConfig,
}) {}

export class RedactedDiscordConfig extends Schema.Class<RedactedDiscordConfig>(
  "RedactedDiscordConfig",
)({
  enabled: Schema.Boolean,
  token: Schema.optionalKey(RedactedSecretRef),
  applicationId: Schema.optionalKey(Schema.String),
  guildId: Schema.optionalKey(Schema.String),
  publicKey: Schema.optionalKey(Schema.String),
  mode: DiscordModeConfig,
}) {}

export class RedactedChatsConfig extends Schema.Class<RedactedChatsConfig>("RedactedChatsConfig")({
  telegram: RedactedTelegramConfig,
  discord: RedactedDiscordConfig,
}) {}

export class RedactedOpenCodeConfig extends Schema.Class<RedactedOpenCodeConfig>(
  "RedactedOpenCodeConfig",
)({
  enabled: Schema.Boolean,
  mode: OpenCodeMode,
  baseUrl: Schema.optionalKey(Schema.String),
  port: Schema.optionalKey(PositiveInteger),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export class RedactedPiConfig extends Schema.Class<RedactedPiConfig>("RedactedPiConfig")({
  enabled: Schema.Boolean,
  agentDir: Schema.optionalKey(Schema.String),
  sessionDir: Schema.optionalKey(Schema.String),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
  excludeTools: Schema.optionalKey(Schema.Array(Schema.String)),
  noTools: Schema.optionalKey(PiNoToolsMode),
}) {}

export class RedactedHarnessesConfig extends Schema.Class<RedactedHarnessesConfig>(
  "RedactedHarnessesConfig",
)({
  opencode: RedactedOpenCodeConfig,
  pi: RedactedPiConfig,
}) {}

/** Effective config redacts credentials but includes normalized server inputs. */
export class RedactedServerConfig extends Schema.Class<RedactedServerConfig>(
  "RedactedServerConfig",
)({
  userName: Schema.String,
  defaultWorkingDirectory: Schema.String,
  deliveryMode: DeliveryMode,
  server: ServerSettingsConfig,
  chats: RedactedChatsConfig,
  harnesses: RedactedHarnessesConfig,
  middleware: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/** Redacted config snapshot is domain data; API groups wrap it in response envelopes. */
export class RedactedConfigSnapshot extends Schema.Class<RedactedConfigSnapshot>(
  "RedactedConfigSnapshot",
)({
  configPath: Schema.String,
  config: RedactedServerConfig,
}) {}

/** Validation issues are safe to render directly in CLI output. */
export class ConfigValidationIssue extends Schema.Class<ConfigValidationIssue>(
  "ConfigValidationIssue",
)({
  code: NonEmptyString,
  message: NonEmptyString,
  path: Schema.optionalKey(Schema.String),
}) {}

export class ValidConfigValidationResult extends Schema.Class<ValidConfigValidationResult>(
  "ValidConfigValidationResult",
)({
  configPath: NonEmptyString,
  valid: Schema.Literal(true),
  issues: Schema.Tuple([]),
  config: RedactedServerConfig,
}) {}

export class InvalidConfigValidationResult extends Schema.Class<InvalidConfigValidationResult>(
  "InvalidConfigValidationResult",
)({
  configPath: Schema.String,
  valid: Schema.Literal(false),
  issues: Schema.NonEmptyArray(ConfigValidationIssue),
}) {}

/** Config validation result is domain data; API groups choose HTTP status codes. */
export const ConfigValidationResult = Schema.Union([
  ValidConfigValidationResult,
  InvalidConfigValidationResult,
]);
export type ConfigValidationResult = typeof ConfigValidationResult.Type;
