import { Schema } from "effect";
import { HarnessModelRefConfig, HarnessThinkingLevel, OpenCodeMode } from "../../contracts/config";
import { BaseUrl, Port } from "../../contracts/primitives";

export class EffectiveOpenCodeDisabled extends Schema.TaggedClass<EffectiveOpenCodeDisabled>()(
  "OpenCodeDisabled",
  {
    enabled: Schema.Literal(false),
    mode: OpenCodeMode,
    baseUrl: Schema.optionalKey(BaseUrl),
    port: Schema.optionalKey(Port),
    defaultModel: Schema.optionalKey(HarnessModelRefConfig),
    defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  },
) {}

export class EffectiveOpenCodeEmbedded extends Schema.TaggedClass<EffectiveOpenCodeEmbedded>()(
  "OpenCodeEmbedded",
  {
    enabled: Schema.Literal(true),
    mode: Schema.Literal("embedded"),
    port: Schema.optionalKey(Port),
    defaultModel: Schema.optionalKey(HarnessModelRefConfig),
    defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  },
) {}

export class EffectiveOpenCodeExternal extends Schema.TaggedClass<EffectiveOpenCodeExternal>()(
  "OpenCodeExternal",
  {
    enabled: Schema.Literal(true),
    mode: Schema.Literal("external"),
    baseUrl: BaseUrl,
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
