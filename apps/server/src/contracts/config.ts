import { Schema } from "effect";
import { LogLevel } from "./logging";
import {
  BaseUrl,
  ConfigPath,
  DiscordApplicationId,
  DiscordGuildId,
  EnvironmentVariableName,
  LogByteCount,
  LogRotationFileCount,
  ModelId,
  ModelVariant,
  NonEmptyString,
  Port,
  PositiveInteger,
  ProviderId,
  ResolvedPath,
  SecretValue,
} from "./primitives";

/** Secret references let config point at credentials without exposing them in status. */
export class EnvSecretRef extends Schema.Class<EnvSecretRef>("EnvSecretRef")({
  env: EnvironmentVariableName,
}) {}

/** Inline secrets are supported for convenience but always redacted at boundaries. */
export class InlineSecretRef extends Schema.Class<InlineSecretRef>("InlineSecretRef")({
  value: SecretValue,
}) {}

export const SecretRef = Schema.Union([EnvSecretRef, InlineSecretRef]);
export type SecretRef = typeof SecretRef.Type;

/** Remote chat access must be explicit because chats can control local agent sessions. */
export class AnyoneAccessConfig extends Schema.Class<AnyoneAccessConfig>("AnyoneAccessConfig")({
  type: Schema.Literal("anyone"),
}) {}

export class AllowListAccessConfig extends Schema.Class<AllowListAccessConfig>(
  "AllowListAccessConfig",
)({
  type: Schema.Literal("allow-list"),
  users: Schema.NonEmptyArray(NonEmptyString),
}) {}

export const ChatAccessConfig = Schema.Union([AnyoneAccessConfig, AllowListAccessConfig]);
export type ChatAccessConfig = typeof ChatAccessConfig.Type;

export const ChatAttachmentKindConfig = Schema.Literals([
  "image",
  "audio",
  "video",
  "document",
  "archive",
  "other",
]);
export type ChatAttachmentKindConfig = typeof ChatAttachmentKindConfig.Type;

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

export class XmuxWorkspaceFileConfig extends Schema.Class<XmuxWorkspaceFileConfig>(
  "XmuxWorkspaceFileConfig",
)({
  defaultDir: Schema.optionalKey(NonEmptyString),
}) {}

export class XmuxWorkspaceSettingsConfig extends Schema.Class<XmuxWorkspaceSettingsConfig>(
  "XmuxWorkspaceSettingsConfig",
)({
  defaultDir: ResolvedPath,
}) {}

export class XmuxThinkingResponseFileConfig extends Schema.Class<XmuxThinkingResponseFileConfig>(
  "XmuxThinkingResponseFileConfig",
)({
  hide: Schema.optionalKey(Schema.Boolean),
  maxChars: Schema.optionalKey(PositiveInteger),
}) {}

export class XmuxThinkingResponseConfig extends Schema.Class<XmuxThinkingResponseConfig>(
  "XmuxThinkingResponseConfig",
)({
  hide: Schema.Boolean,
  maxChars: PositiveInteger,
}) {}

export class XmuxToolResponseFileConfig extends Schema.Class<XmuxToolResponseFileConfig>(
  "XmuxToolResponseFileConfig",
)({
  hide: Schema.optionalKey(Schema.Boolean),
  maxInputStringChars: Schema.optionalKey(PositiveInteger),
  maxInputObjectEntries: Schema.optionalKey(PositiveInteger),
  maxTextOutputChars: Schema.optionalKey(PositiveInteger),
  maxJsonOutputChars: Schema.optionalKey(PositiveInteger),
}) {}

export class XmuxToolResponseConfig extends Schema.Class<XmuxToolResponseConfig>(
  "XmuxToolResponseConfig",
)({
  hide: Schema.Boolean,
  maxInputStringChars: PositiveInteger,
  maxInputObjectEntries: PositiveInteger,
  maxTextOutputChars: PositiveInteger,
  maxJsonOutputChars: PositiveInteger,
}) {}

export class XmuxResponsesFileConfig extends Schema.Class<XmuxResponsesFileConfig>(
  "XmuxResponsesFileConfig",
)({
  thinking: Schema.optionalKey(XmuxThinkingResponseFileConfig),
  tools: Schema.optionalKey(XmuxToolResponseFileConfig),
}) {}

export class XmuxResponsesConfig extends Schema.Class<XmuxResponsesConfig>("XmuxResponsesConfig")({
  thinking: XmuxThinkingResponseConfig,
  tools: XmuxToolResponseConfig,
}) {}

export class ResumeCommandFileConfig extends Schema.Class<ResumeCommandFileConfig>(
  "ResumeCommandFileConfig",
)({
  maxSessionsPerHarness: Schema.optionalKey(PositiveInteger),
}) {}

export class ResumeCommandConfig extends Schema.Class<ResumeCommandConfig>("ResumeCommandConfig")({
  maxSessionsPerHarness: PositiveInteger,
}) {}

export class ModelCommandFileConfig extends Schema.Class<ModelCommandFileConfig>(
  "ModelCommandFileConfig",
)({
  maxModelsPerProvider: Schema.optionalKey(PositiveInteger),
}) {}

export class ModelCommandConfig extends Schema.Class<ModelCommandConfig>("ModelCommandConfig")({
  maxModelsPerProvider: PositiveInteger,
}) {}

export class LsCommandFileConfig extends Schema.Class<LsCommandFileConfig>("LsCommandFileConfig")({
  showHidden: Schema.optionalKey(Schema.Boolean),
  maxEntries: Schema.optionalKey(PositiveInteger),
}) {}

export class LsCommandConfig extends Schema.Class<LsCommandConfig>("LsCommandConfig")({
  showHidden: Schema.Boolean,
  maxEntries: PositiveInteger,
}) {}

export class XmuxCommandsFileConfig extends Schema.Class<XmuxCommandsFileConfig>(
  "XmuxCommandsFileConfig",
)({
  resume: Schema.optionalKey(ResumeCommandFileConfig),
  model: Schema.optionalKey(ModelCommandFileConfig),
  ls: Schema.optionalKey(LsCommandFileConfig),
}) {}

export class XmuxCommandsConfig extends Schema.Class<XmuxCommandsConfig>("XmuxCommandsConfig")({
  resume: ResumeCommandConfig,
  model: ModelCommandConfig,
  ls: LsCommandConfig,
}) {}

export class XmuxAttachmentsFileConfig extends Schema.Class<XmuxAttachmentsFileConfig>(
  "XmuxAttachmentsFileConfig",
)({
  enabled: Schema.optionalKey(Schema.Boolean),
  maxBytes: Schema.optionalKey(PositiveInteger),
  kinds: Schema.optionalKey(Schema.Array(ChatAttachmentKindConfig)),
}) {}

export class XmuxAttachmentsConfig extends Schema.Class<XmuxAttachmentsConfig>(
  "XmuxAttachmentsConfig",
)({
  enabled: Schema.Boolean,
  maxBytes: PositiveInteger,
  kinds: Schema.Array(ChatAttachmentKindConfig),
}) {}

/** Product-level xmux behavior; missing keys are normalized to safe defaults. */
export class XmuxFileConfig extends Schema.Class<XmuxFileConfig>("XmuxFileConfig")({
  workspace: Schema.optionalKey(XmuxWorkspaceFileConfig),
  responses: Schema.optionalKey(XmuxResponsesFileConfig),
  commands: Schema.optionalKey(XmuxCommandsFileConfig),
  attachments: Schema.optionalKey(XmuxAttachmentsFileConfig),
}) {}

export class XmuxSettingsConfig extends Schema.Class<XmuxSettingsConfig>("XmuxSettingsConfig")({
  workspace: XmuxWorkspaceSettingsConfig,
  responses: XmuxResponsesConfig,
  commands: XmuxCommandsConfig,
  attachments: XmuxAttachmentsConfig,
}) {}

export class ServerLogRotationFileConfig extends Schema.Class<ServerLogRotationFileConfig>(
  "ServerLogRotationFileConfig",
)({
  maxBytes: Schema.optionalKey(LogByteCount),
  maxFiles: Schema.optionalKey(LogRotationFileCount),
}) {}

export class ServerLogRotationConfig extends Schema.Class<ServerLogRotationConfig>(
  "ServerLogRotationConfig",
)({
  maxBytes: LogByteCount,
  maxFiles: LogRotationFileCount,
}) {}

export class ServerLogsFileConfig extends Schema.Class<ServerLogsFileConfig>(
  "ServerLogsFileConfig",
)({
  level: Schema.optionalKey(LogLevel),
  rotation: Schema.optionalKey(ServerLogRotationFileConfig),
}) {}

export class ServerLogsConfig extends Schema.Class<ServerLogsConfig>("ServerLogsConfig")({
  level: LogLevel,
  rotation: ServerLogRotationConfig,
}) {}

/** User-facing local server config knobs. */
export class ServerFileServerConfig extends Schema.Class<ServerFileServerConfig>(
  "ServerFileServerConfig",
)({
  logs: Schema.optionalKey(ServerLogsFileConfig),
}) {}

/** Normalized local server settings used after defaults have been applied. */
export class ServerSettingsConfig extends Schema.Class<ServerSettingsConfig>(
  "ServerSettingsConfig",
)({
  logs: ServerLogsConfig,
}) {}

export const SttProvider = Schema.Literal("openai-compatible");
export type SttProvider = typeof SttProvider.Type;

export class SttFileConfig extends Schema.Class<SttFileConfig>("SttFileConfig")({
  provider: Schema.optionalKey(SttProvider),
  apiKey: Schema.optionalKey(SecretRef),
  baseUrl: Schema.optionalKey(BaseUrl),
  endpointPath: Schema.optionalKey(NonEmptyString),
  model: Schema.optionalKey(NonEmptyString),
  language: Schema.optionalKey(NonEmptyString),
  maxBytes: Schema.optionalKey(PositiveInteger),
  timeoutMs: Schema.optionalKey(PositiveInteger),
}) {}

export class HarnessModelRefConfig extends Schema.Class<HarnessModelRefConfig>(
  "HarnessModelRefConfig",
)({
  providerId: Schema.optionalKey(ProviderId),
  modelId: ModelId,
  variant: Schema.optionalKey(ModelVariant),
}) {}

/** Telegram config exists only when the Telegram chat adapter should start. */
export class TelegramFileConfig extends Schema.Class<TelegramFileConfig>("TelegramFileConfig")({
  token: Schema.optionalKey(SecretRef),
  access: Schema.optionalKey(ChatAccessConfig),
}) {}

/** Discord config exists only when the Discord chat adapter should start. */
export class DiscordFileConfig extends Schema.Class<DiscordFileConfig>("DiscordFileConfig")({
  token: Schema.optionalKey(SecretRef),
  applicationId: Schema.optionalKey(DiscordApplicationId),
  guildId: Schema.optionalKey(DiscordGuildId),
  access: Schema.optionalKey(ChatAccessConfig),
}) {}

/** Slack config exists only when the Slack chat adapter should start. */
export class SlackFileConfig extends Schema.Class<SlackFileConfig>("SlackFileConfig")({
  botToken: Schema.optionalKey(SecretRef),
  appToken: Schema.optionalKey(SecretRef),
  access: Schema.optionalKey(ChatAccessConfig),
}) {}

export class ChatsFileConfig extends Schema.Class<ChatsFileConfig>("ChatsFileConfig")({
  telegram: Schema.optionalKey(TelegramFileConfig),
  discord: Schema.optionalKey(DiscordFileConfig),
  slack: Schema.optionalKey(SlackFileConfig),
}) {}

export class OpenCodeEmbeddedRuntimeConfig extends Schema.Class<OpenCodeEmbeddedRuntimeConfig>(
  "OpenCodeEmbeddedRuntimeConfig",
)({
  type: Schema.Literal("embedded"),
  port: Schema.optionalKey(Port),
}) {}

export class OpenCodeExternalRuntimeConfig extends Schema.Class<OpenCodeExternalRuntimeConfig>(
  "OpenCodeExternalRuntimeConfig",
)({
  type: Schema.Literal("external"),
  baseUrl: BaseUrl,
}) {}

export const OpenCodeRuntimeConfig = Schema.Union([
  OpenCodeEmbeddedRuntimeConfig,
  OpenCodeExternalRuntimeConfig,
]);
export type OpenCodeRuntimeConfig = typeof OpenCodeRuntimeConfig.Type;

export class OpenCodeFileConfig extends Schema.Class<OpenCodeFileConfig>("OpenCodeFileConfig")({
  runtime: Schema.optionalKey(OpenCodeRuntimeConfig),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export class PiFileConfig extends Schema.Class<PiFileConfig>("PiFileConfig")({
  agentDir: Schema.optionalKey(NonEmptyString),
  sessionDir: Schema.optionalKey(NonEmptyString),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export class HarnessesFileConfig extends Schema.Class<HarnessesFileConfig>("HarnessesFileConfig")({
  opencode: Schema.optionalKey(OpenCodeFileConfig),
  pi: Schema.optionalKey(PiFileConfig),
}) {}

/** Raw JSONC config contract. Missing keys are defaulted after decoding. */
export class ServerFileConfig extends Schema.Class<ServerFileConfig>("ServerFileConfig")({
  xmux: Schema.optionalKey(XmuxFileConfig),
  server: Schema.optionalKey(ServerFileServerConfig),
  stt: Schema.optionalKey(SttFileConfig),
  chats: Schema.optionalKey(ChatsFileConfig),
  harnesses: Schema.optionalKey(HarnessesFileConfig),
}) {}

/** Redacted secret metadata is safe for local status and support output. */
export class RedactedEnvSecretRef extends Schema.Class<RedactedEnvSecretRef>(
  "RedactedEnvSecretRef",
)({
  source: Schema.Literal("env"),
  env: EnvironmentVariableName,
  redacted: Schema.Literal(true),
}) {}

export class RedactedInlineSecretRef extends Schema.Class<RedactedInlineSecretRef>(
  "RedactedInlineSecretRef",
)({
  source: Schema.Literal("value"),
  redacted: Schema.Literal(true),
}) {}

export const RedactedSecretRef = Schema.Union([RedactedEnvSecretRef, RedactedInlineSecretRef]);
export type RedactedSecretRef = typeof RedactedSecretRef.Type;

export class RedactedSttConfig extends Schema.Class<RedactedSttConfig>("RedactedSttConfig")({
  provider: SttProvider,
  apiKey: Schema.optionalKey(RedactedSecretRef),
  baseUrl: Schema.optionalKey(BaseUrl),
  endpointPath: Schema.optionalKey(NonEmptyString),
  model: NonEmptyString,
  language: Schema.optionalKey(NonEmptyString),
  maxBytes: PositiveInteger,
  timeoutMs: Schema.optionalKey(PositiveInteger),
}) {}

export class RedactedTelegramConfig extends Schema.Class<RedactedTelegramConfig>(
  "RedactedTelegramConfig",
)({
  token: RedactedSecretRef,
  access: ChatAccessConfig,
}) {}

export class RedactedDiscordConfig extends Schema.Class<RedactedDiscordConfig>(
  "RedactedDiscordConfig",
)({
  token: RedactedSecretRef,
  applicationId: DiscordApplicationId,
  guildId: DiscordGuildId,
  access: ChatAccessConfig,
}) {}

export class RedactedSlackConfig extends Schema.Class<RedactedSlackConfig>("RedactedSlackConfig")({
  botToken: RedactedSecretRef,
  appToken: RedactedSecretRef,
  access: ChatAccessConfig,
}) {}

export class RedactedChatsConfig extends Schema.Class<RedactedChatsConfig>("RedactedChatsConfig")({
  telegram: Schema.optionalKey(RedactedTelegramConfig),
  discord: Schema.optionalKey(RedactedDiscordConfig),
  slack: Schema.optionalKey(RedactedSlackConfig),
}) {}

export class RedactedOpenCodeConfig extends Schema.Class<RedactedOpenCodeConfig>(
  "RedactedOpenCodeConfig",
)({
  runtime: OpenCodeRuntimeConfig,
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export class RedactedPiConfig extends Schema.Class<RedactedPiConfig>("RedactedPiConfig")({
  agentDir: Schema.optionalKey(ResolvedPath),
  sessionDir: Schema.optionalKey(ResolvedPath),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}

export class RedactedHarnessesConfig extends Schema.Class<RedactedHarnessesConfig>(
  "RedactedHarnessesConfig",
)({
  opencode: Schema.optionalKey(RedactedOpenCodeConfig),
  pi: Schema.optionalKey(RedactedPiConfig),
}) {}

/** Effective config redacts credentials but includes normalized product inputs. */
export class RedactedServerConfig extends Schema.Class<RedactedServerConfig>(
  "RedactedServerConfig",
)({
  xmux: XmuxSettingsConfig,
  server: ServerSettingsConfig,
  stt: Schema.optionalKey(RedactedSttConfig),
  chats: RedactedChatsConfig,
  harnesses: RedactedHarnessesConfig,
}) {}

/** Redacted config snapshot is domain data; API groups wrap it in response envelopes. */
export class RedactedConfigSnapshot extends Schema.Class<RedactedConfigSnapshot>(
  "RedactedConfigSnapshot",
)({
  configPath: ConfigPath,
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
  configPath: ConfigPath,
  valid: Schema.Literal(true),
  issues: Schema.Tuple([]),
  config: RedactedServerConfig,
}) {}

export class InvalidConfigValidationResult extends Schema.Class<InvalidConfigValidationResult>(
  "InvalidConfigValidationResult",
)({
  configPath: ConfigPath,
  valid: Schema.Literal(false),
  issues: Schema.NonEmptyArray(ConfigValidationIssue),
}) {}

/** Config validation result is domain data; API groups choose HTTP status codes. */
export const ConfigValidationResult = Schema.Union([
  ValidConfigValidationResult,
  InvalidConfigValidationResult,
]);
export type ConfigValidationResult = typeof ConfigValidationResult.Type;
