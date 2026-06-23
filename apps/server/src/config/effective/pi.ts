import { Schema } from "effect";
import { HarnessModelRefConfig, HarnessThinkingLevel } from "../../contracts/config";
import { ResolvedPath } from "../../contracts/primitives";

export class EffectivePiConfig extends Schema.Class<EffectivePiConfig>("EffectivePiConfig")({
  agentDir: Schema.optionalKey(ResolvedPath),
  sessionDir: Schema.optionalKey(ResolvedPath),
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}
