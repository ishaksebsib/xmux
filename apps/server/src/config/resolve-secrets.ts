import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import type { SecretRef } from "../contracts/config";
import { EnvSecretRef, InlineSecretRef } from "../contracts/config";
import { EnvironmentVariableName, SecretValue, type ConfigPath } from "../contracts/primitives";
import { ConfigSecretError } from "../errors";

const RedactedSecretValue = Schema.Redacted(SecretValue);

/** Resolved secrets are internal only; do not expose this shape on control routes. */
export class EnvResolvedSecret extends Schema.Class<EnvResolvedSecret>("EnvResolvedSecret")({
  source: Schema.Literal("env"),
  env: EnvironmentVariableName,
  value: RedactedSecretValue,
}) {}

export class ValueResolvedSecret extends Schema.Class<ValueResolvedSecret>("ValueResolvedSecret")({
  source: Schema.Literal("value"),
  value: RedactedSecretValue,
}) {}

export const ResolvedSecret = Schema.Union([EnvResolvedSecret, ValueResolvedSecret]);
export type ResolvedSecret = typeof ResolvedSecret.Type;

/** SecretResolver is a seam so tests can override secret lookup without env mutation. */
export class SecretResolver extends Context.Service<
  SecretResolver,
  {
    readonly resolveEnv: (input: {
      readonly configPath: ConfigPath;
      readonly env: EnvironmentVariableName;
    }) => Effect.Effect<Redacted.Redacted<SecretValue>, ConfigSecretError>;
  }
>()("@xmux/server/SecretResolver") {
  static readonly layer = Layer.succeed(SecretResolver)({
    resolveEnv: Effect.fn("SecretResolver.resolveEnv")(function* ({ configPath, env }) {
      return yield* Config.schema(RedactedSecretValue, env).pipe(
        Effect.mapError((cause) =>
          ConfigSecretError.make({
            path: configPath,
            env,
            message: `Missing or invalid required environment secret: ${env}`,
            cause,
          }),
        ),
      );
    }),
  });
}

/** Resolve a config secret to an in-memory value while preserving redaction metadata. */
export const resolveSecretRef = Effect.fn("server.resolveSecretRef")(function* (input: {
  readonly configPath: ConfigPath;
  readonly ref: SecretRef;
}) {
  if (input.ref instanceof EnvSecretRef) {
    const resolver = yield* SecretResolver;
    const value = yield* resolver.resolveEnv({ configPath: input.configPath, env: input.ref.env });
    return EnvResolvedSecret.make({ source: "env", env: input.ref.env, value });
  }

  if (input.ref instanceof InlineSecretRef) {
    return ValueResolvedSecret.make({ source: "value", value: Redacted.make(input.ref.value) });
  }

  return yield* ConfigSecretError.make({
    path: input.configPath,
    message: "Unsupported secret reference.",
  });
});
