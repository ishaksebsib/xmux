import { Schema } from "effect";
import { HarnessModelRefConfig, HarnessThinkingLevel, OpenCodeMode } from "../../contracts/config";
import { PositiveInteger } from "../../contracts/primitives";

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
