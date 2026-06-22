import { Schema } from "effect";
import { HarnessModelRefConfig, HarnessThinkingLevel, PiNoToolsMode } from "../../contracts/config";
import { NonEmptyString, ResolvedPath } from "../../contracts/primitives";

export class EffectivePiDisabled extends Schema.TaggedClass<EffectivePiDisabled>()("PiDisabled", {
  enabled: Schema.Literal(false),
  agentDir: Schema.optionalKey(ResolvedPath),
  sessionDir: Schema.optionalKey(ResolvedPath),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(NonEmptyString)),
  excludeTools: Schema.optionalKey(Schema.Array(NonEmptyString)),
  noTools: Schema.optionalKey(PiNoToolsMode),
}) {}

export class EffectivePiEnabled extends Schema.TaggedClass<EffectivePiEnabled>()("PiEnabled", {
  enabled: Schema.Literal(true),
  agentDir: Schema.optionalKey(ResolvedPath),
  sessionDir: Schema.optionalKey(ResolvedPath),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(NonEmptyString)),
  excludeTools: Schema.optionalKey(Schema.Array(NonEmptyString)),
  noTools: Schema.optionalKey(PiNoToolsMode),
}) {}

export const EffectivePiConfig = Schema.Union([EffectivePiDisabled, EffectivePiEnabled]);
export type EffectivePiConfig = typeof EffectivePiConfig.Type;
