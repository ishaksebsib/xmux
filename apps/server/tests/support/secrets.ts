import { Effect, Layer, Redacted } from "effect";
import { secretValueFromString } from "../../src/contracts/primitives";
import { ConfigSecretError } from "../../src/errors";
import { SecretResolver } from "../../src/config/resolve-secrets";

export const makeSecretResolverLayer = (
  values: ReadonlyMap<string, string>,
): Layer.Layer<SecretResolver> =>
  Layer.succeed(SecretResolver)({
    resolveEnv: Effect.fn("SecretResolver.test.resolveEnv")(function* ({ configPath, env }) {
      const value = values.get(env);
      if (value !== undefined && value.length > 0) return Redacted.make(secretValueFromString(value));
      return yield* ConfigSecretError.make({
        path: configPath,
        env,
        message: `Missing required environment secret: ${env}`,
      });
    }),
  });
