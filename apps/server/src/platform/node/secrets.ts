import { Effect, Layer } from "effect";
import { SecretResolver } from "../../config/resolve-secrets";
import { ConfigSecretError } from "../../errors";
import { HostRuntime } from "../../services/host";

/** Node secret resolver backed by process environment through HostRuntime. */
export const NodeSecretResolver = Layer.effect(SecretResolver)(
  Effect.gen(function* () {
    const host = yield* HostRuntime;

    return {
      resolveEnv: ({ configPath, env }: { readonly configPath: string; readonly env: string }) =>
        Effect.gen(function* () {
          const value = host.getEnv(env);
          if (value !== undefined && value.length > 0) return value;
          return yield* ConfigSecretError.make({
            path: configPath,
            env,
            message: `Missing required environment secret: ${env}`,
          });
        }),
    };
  }),
);
