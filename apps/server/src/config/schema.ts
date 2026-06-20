import { Schema } from "effect";
import { DeliveryMode, ServerSettingsConfig } from "../contracts/config";
import { EffectiveDiscordConfig } from "./adapters/discord";
import { EffectiveOpenCodeConfig } from "./adapters/opencode";
import { EffectivePiConfig } from "./adapters/pi";
import { EffectiveTelegramConfig } from "./adapters/telegram";

export * from "./adapters/discord";
export * from "./adapters/opencode";
export * from "./adapters/pi";
export * from "./adapters/telegram";
export { EnvResolvedSecret, ResolvedSecret, ValueResolvedSecret } from "./resolve-secrets";
export type { ResolvedSecret as ResolvedSecretType } from "./resolve-secrets";

export const EffectiveServerSettings = ServerSettingsConfig;
export type EffectiveServerSettings = typeof EffectiveServerSettings.Type;

export class EffectiveChatsConfig extends Schema.Class<EffectiveChatsConfig>(
  "EffectiveChatsConfig",
)({
  telegram: EffectiveTelegramConfig,
  discord: EffectiveDiscordConfig,
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
