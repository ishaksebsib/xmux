import { Schema } from "effect";
import { SttProvider } from "../../contracts/config";
import { BaseUrl, NonEmptyString, PositiveInteger } from "../../contracts/primitives";
import { ResolvedSecret } from "../resolve-secrets";

export class EffectiveSttConfig extends Schema.Class<EffectiveSttConfig>("EffectiveSttConfig")({
  provider: SttProvider,
  apiKey: Schema.optionalKey(ResolvedSecret),
  baseUrl: Schema.optionalKey(BaseUrl),
  endpointPath: Schema.optionalKey(NonEmptyString),
  model: NonEmptyString,
  language: Schema.optionalKey(NonEmptyString),
  maxBytes: PositiveInteger,
  timeoutMs: Schema.optionalKey(PositiveInteger),
}) {}
