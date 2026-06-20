import { Schema } from "effect";
import { TelegramModeConfig } from "../../contracts/config";
import { ResolvedSecret } from "../resolve-secrets";

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
