import { Schema } from "effect";
import {
  ServerSettingsConfig,
  XmuxAttachmentsConfig,
  XmuxCommandsConfig,
  XmuxResponsesConfig,
  XmuxWorkspaceSettingsConfig,
} from "../contracts/config";
import { EffectiveDiscordConfig } from "./effective/discord";
import { EffectiveOpenCodeConfig } from "./effective/opencode";
import { EffectivePiConfig } from "./effective/pi";
import { EffectiveSlackConfig } from "./effective/slack";
import { EffectiveSttConfig } from "./effective/stt";
import { EffectiveTelegramConfig } from "./effective/telegram";

export * from "./effective/discord";
export * from "./effective/opencode";
export * from "./effective/pi";
export * from "./effective/slack";
export * from "./effective/stt";
export * from "./effective/telegram";
export { EnvResolvedSecret, ResolvedSecret, ValueResolvedSecret } from "./resolve-secrets";
export type { ResolvedSecret as ResolvedSecretType } from "./resolve-secrets";

export class EffectiveXmuxConfig extends Schema.Class<EffectiveXmuxConfig>("EffectiveXmuxConfig")({
  workspace: XmuxWorkspaceSettingsConfig,
  responses: XmuxResponsesConfig,
  commands: XmuxCommandsConfig,
  attachments: XmuxAttachmentsConfig,
}) {}

export class EffectiveChatsConfig extends Schema.Class<EffectiveChatsConfig>(
  "EffectiveChatsConfig",
)({
  telegram: Schema.optionalKey(EffectiveTelegramConfig),
  discord: Schema.optionalKey(EffectiveDiscordConfig),
  slack: Schema.optionalKey(EffectiveSlackConfig),
}) {}

export class EffectiveHarnessesConfig extends Schema.Class<EffectiveHarnessesConfig>(
  "EffectiveHarnessesConfig",
)({
  opencode: Schema.optionalKey(EffectiveOpenCodeConfig),
  pi: Schema.optionalKey(EffectivePiConfig),
}) {}

/** Fully normalized runtime config with secrets resolved in memory. */
export class EffectiveServerConfig extends Schema.Class<EffectiveServerConfig>(
  "EffectiveServerConfig",
)({
  xmux: EffectiveXmuxConfig,
  server: ServerSettingsConfig,
  stt: Schema.optionalKey(EffectiveSttConfig),
  chats: EffectiveChatsConfig,
  harnesses: EffectiveHarnessesConfig,
}) {}
