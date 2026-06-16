import { Context, Effect, Layer } from "effect";
import type { SecretRef } from "../contracts/config";
import { EnvSecretRef, InlineSecretRef } from "../contracts/config";
import { ConfigSecretError } from "../errors";
import { ResolvedSecret } from "./schema";

/** SecretResolver is a seam so tests avoid mutating the real process env. */
export class SecretResolver extends Context.Service<
  SecretResolver,
  {
    readonly resolveEnv: (input: {
      readonly configPath: string;
      readonly env: string;
    }) => Effect.Effect<string, ConfigSecretError>;
  }
>()("@xmux/server/SecretResolver") {}

/** Production secrets currently come from environment variables only. */
export const SecretResolverLive = Layer.succeed(SecretResolver)({
  resolveEnv: ({ configPath, env }) =>
    Effect.gen(function* () {
      const value = process.env[env];
      if (value !== undefined && value.length > 0) return value;
      return yield* ConfigSecretError.make({
        path: configPath,
        env,
        message: `Missing required environment secret: ${env}`,
      });
    }),
});

/** Test helper keeps config tests deterministic without touching process.env. */
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

/** Resolve a config secret to an in-memory value while preserving redaction metadata. */
export const resolveSecretRef = Effect.fn("server.resolveSecretRef")(function* (input: {
  readonly configPath: string;
  readonly ref: SecretRef;
}) {
  if (input.ref instanceof EnvSecretRef) {
    const resolver = yield* SecretResolver;
    const value = yield* resolver.resolveEnv({ configPath: input.configPath, env: input.ref.env });
    return ResolvedSecret.make({ source: "env", env: input.ref.env, value });
  }

  if (input.ref instanceof InlineSecretRef) {
    return ResolvedSecret.make({ source: "value", value: input.ref.value });
  }

  return yield* ConfigSecretError.make({
    path: input.configPath,
    message: "Unsupported secret reference.",
  });
});
