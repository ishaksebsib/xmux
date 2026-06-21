import { Effect, Layer } from "effect";
import { SecretResolver } from "../../config/resolve-secrets";
import { ConfigSecretError } from "../../errors";
import { HostRuntime } from "../host";

/** Node secret resolver backed by process environment through HostRuntime. */
export const nodeSecretResolverLayer = Layer.effect(SecretResolver)(
  Effect.gen(function* () {
    const host = yield* HostRuntime;

    const resolveEnv = Effect.fn("SecretResolver.resolveEnv")(function* ({
      configPath,
      env,
    }: {
      readonly configPath: string;
      readonly env: string;
    }) {
      const value = host.getEnv(env);
      if (value !== undefined && value.length > 0) return value;
      return yield* ConfigSecretError.make({
        path: configPath,
        env,
        message: `Missing required environment secret: ${env}`,
      });
    });

    return { resolveEnv };
  }),
);
