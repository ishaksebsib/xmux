import { Schema } from "effect";
import {
  HarnessModelRefConfig,
  HarnessThinkingLevel,
  PiNoToolsMode,
} from "../../contracts/config";

export class EffectivePiDisabled extends Schema.TaggedClass<EffectivePiDisabled>()("PiDisabled", {
  enabled: Schema.Literal(false),
  agentDir: Schema.optionalKey(Schema.String),
  sessionDir: Schema.optionalKey(Schema.String),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
  excludeTools: Schema.optionalKey(Schema.Array(Schema.String)),
  noTools: Schema.optionalKey(PiNoToolsMode),
}) {}

export class EffectivePiEnabled extends Schema.TaggedClass<EffectivePiEnabled>()("PiEnabled", {
  enabled: Schema.Literal(true),
  agentDir: Schema.optionalKey(Schema.String),
  sessionDir: Schema.optionalKey(Schema.String),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
  excludeTools: Schema.optionalKey(Schema.Array(Schema.String)),
  noTools: Schema.optionalKey(PiNoToolsMode),
}) {}

export const EffectivePiConfig = Schema.Union([EffectivePiDisabled, EffectivePiEnabled]);
export type EffectivePiConfig = typeof EffectivePiConfig.Type;
