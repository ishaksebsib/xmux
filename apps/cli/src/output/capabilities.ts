import { Context, Effect, Layer, Option } from "effect";

export interface CliOutputCapabilities {
  readonly color: boolean;
  readonly unicode: boolean;
}

export const plainCliOutputCapabilities: CliOutputCapabilities = {
  color: false,
  unicode: true,
};

export class CliOutputStyle extends Context.Service<CliOutputStyle, CliOutputCapabilities>()(
  "@xmux/cli/CliOutputStyle",
) {}

export const plainCliOutputStyleLayer = Layer.succeed(CliOutputStyle, plainCliOutputCapabilities);

export const getCliOutputCapabilities: Effect.Effect<CliOutputCapabilities> = Effect.map(
  Effect.serviceOption(CliOutputStyle),
  Option.getOrElse(() => plainCliOutputCapabilities),
);
