import { Schema } from "effect";
import {
  HarnessModelRefConfig,
  HarnessThinkingLevel,
  OpenCodeRuntimeConfig,
} from "../../contracts/config";

export class EffectiveOpenCodeConfig extends Schema.Class<EffectiveOpenCodeConfig>(
  "EffectiveOpenCodeConfig",
)({
  runtime: OpenCodeRuntimeConfig,
  defaultModel: Schema.optionalKey(HarnessModelRefConfig),
  defaultThinking: Schema.optionalKey(HarnessThinkingLevel),
}) {}
