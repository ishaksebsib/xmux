import { Effect, Layer } from "effect";
import { ConfigSecretError } from "../../src/errors";
import { SecretResolver } from "../../src/config/resolve-secrets";

export const makeSecretResolverLayer = (
  values: ReadonlyMap<string, string>,
): Layer.Layer<SecretResolver> =>
  Layer.succeed(SecretResolver)({
    resolveEnv: ({ configPath, env }) =>
      Effect.gen(function* () {
        const value = values.get(env);
        if (value !== undefined && value.length > 0) return value;
        return yield* ConfigSecretError.make({
          path: configPath,
          env,
          message: `Missing required environment secret: ${env}`,
        });
      }),
  });
