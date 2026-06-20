import { Schema } from "effect";
import { DeliveryMode } from "../contracts/config";
import { LogLevel } from "../contracts/logging";
import { EffectiveDiscordConfig } from "./effective/discord";
import { EffectiveOpenCodeConfig } from "./effective/opencode";
import { EffectivePiConfig } from "./effective/pi";
import { EffectiveTelegramConfig } from "./effective/telegram";

export * from "./effective/discord";
export * from "./effective/opencode";
export * from "./effective/pi";
export * from "./effective/telegram";
export { EnvResolvedSecret, ResolvedSecret, ValueResolvedSecret } from "./resolve-secrets";
export type { ResolvedSecret as ResolvedSecretType } from "./resolve-secrets";

export class EffectiveServerSettings extends Schema.Class<EffectiveServerSettings>(
  "EffectiveServerSettings",
)({
  logLevel: LogLevel,
}) {}

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
