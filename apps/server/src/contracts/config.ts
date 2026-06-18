import { Schema } from "effect";
import { CONTROL_RESPONSE_VERSION } from "./control";

const NonEmptyString = Schema.String.check(Schema.isNonEmpty());
const PositiveInteger = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0));

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

export const ServerLogLevel = Schema.Literals(["trace", "debug", "info", "warn", "error"]);
export type ServerLogLevel = typeof ServerLogLevel.Type;

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

/** User-facing server config knobs. */
export class ServerFileServerConfig extends Schema.Class<ServerFileServerConfig>(
  "ServerFileServerConfig",
)({
  logLevel: Schema.optionalKey(ServerLogLevel),
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
  mode: Schema.optionalKey(Schema.Literals(["embedded", "external"])),
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
  noTools: Schema.optionalKey(Schema.Literals(["all", "builtin"])),
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
  resolved: Schema.Boolean,
  redacted: Schema.Literal(true),
}) {}

export class RedactedTelegramConfig extends Schema.Class<RedactedTelegramConfig>(
  "RedactedTelegramConfig",
)({
  enabled: Schema.Boolean,
  token: Schema.optionalKey(RedactedSecretRef),
  mode: Schema.optionalKey(TelegramModeConfig),
}) {}

export class RedactedDiscordConfig extends Schema.Class<RedactedDiscordConfig>(
  "RedactedDiscordConfig",
)({
  enabled: Schema.Boolean,
  token: Schema.optionalKey(RedactedSecretRef),
  applicationId: Schema.optionalKey(Schema.String),
  guildId: Schema.optionalKey(Schema.String),
  publicKey: Schema.optionalKey(Schema.String),
  mode: Schema.optionalKey(DiscordModeConfig),
}) {}

export class RedactedChatsConfig extends Schema.Class<RedactedChatsConfig>("RedactedChatsConfig")({
  telegram: RedactedTelegramConfig,
  discord: RedactedDiscordConfig,
}) {}

export class RedactedOpenCodeConfig extends Schema.Class<RedactedOpenCodeConfig>(
  "RedactedOpenCodeConfig",
)({
  enabled: Schema.Boolean,
  mode: Schema.Literals(["embedded", "external"]),
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
  noTools: Schema.optionalKey(Schema.Literals(["all", "builtin"])),
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
  server: ServerFileServerConfig,
  chats: RedactedChatsConfig,
  harnesses: RedactedHarnessesConfig,
  middleware: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/** GET /v1/config/effective response. */
export class EffectiveConfigResponse extends Schema.Class<EffectiveConfigResponse>(
  "EffectiveConfigResponse",
)({
  version: Schema.Literal(CONTROL_RESPONSE_VERSION),
  configPath: Schema.String,
  config: RedactedServerConfig,
}) {}

/** Validation issues are safe to render directly in CLI output. */
export class ConfigValidationIssue extends Schema.Class<ConfigValidationIssue>(
  "ConfigValidationIssue",
)({
  code: Schema.String,
  message: Schema.String,
  path: Schema.optionalKey(Schema.String),
}) {}

/** POST /v1/config/validate response. */
export class ConfigValidateResponse extends Schema.Class<ConfigValidateResponse>(
  "ConfigValidateResponse",
)({
  version: Schema.Literal(CONTROL_RESPONSE_VERSION),
  configPath: Schema.String,
  valid: Schema.Boolean,
  issues: Schema.Array(ConfigValidationIssue),
  config: Schema.optionalKey(RedactedServerConfig),
}) {}
