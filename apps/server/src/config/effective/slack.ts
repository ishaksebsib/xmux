import { Schema } from "effect";
import { ChatAccessConfig } from "../../contracts/config";
import { ResolvedSecret } from "../resolve-secrets";

export class EffectiveSlackConfig extends Schema.Class<EffectiveSlackConfig>(
  "EffectiveSlackConfig",
)({
  botToken: ResolvedSecret,
  appToken: ResolvedSecret,
  access: ChatAccessConfig,
}) {}
